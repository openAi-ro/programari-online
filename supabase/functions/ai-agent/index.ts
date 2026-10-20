/**
 * Edge Function: ai-agent — the single agent core shared by all channels.
 *
 * Infrastructure only: given a business and a customer message it returns
 * structured facts, extracted entities and proposed tools (see _shared/aiCore).
 * It renders no user-facing text and executes no action. Writes proposed by
 * the core always carry requiresConfirmation=true for the channel to confirm.
 *
 * Auth: app channel accepts the anon key or a user JWT (facts are public
 * business data); whatsapp/internal channels require the service role.
 * Settings: public.business_ai_settings (owner-only). No row or agent_enabled
 * = false -> 403 agent_disabled (opt-in per business).
 * Limits: public.ai_agent_check_rate before the core runs (so before any LLM
 * call): per caller 20/min + 200/day, per business 1000/day -> 429.
 * LLM (optional): AI_API_KEY + AI_MODEL (+ AI_API_BASE_URL) enable an
 * OpenAI-compatible classifier consulted only when the rules are unsure.
 * Without them the core runs deterministic-only.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { handleCors, jsonResponse } from '../_shared/cors.ts';
import {
  AI_RATE_LIMITS,
  buildAgentKnowledge,
  buildCallerKey,
  clientIpFrom,
  parseRateVerdict,
  rateLimitMessage,
  runAgentCore,
  type AgentChannel,
  type LlmConfig,
} from '../_shared/aiCore.ts';

type Body = {
  business_id?: string;
  public_code?: string;
  message?: string;
  channel?: string;
  /** Service-role channels only: opaque per-customer key (e.g. hashed phone). */
  caller_key?: string;
};

type Caller = { kind: 'service' | 'anon' | 'user'; userId: string | null };

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function llmConfigFromEnv(): LlmConfig | null {
  const apiKey = Deno.env.get('AI_API_KEY')?.trim();
  const model = Deno.env.get('AI_MODEL')?.trim();
  if (!apiKey || !model) return null;
  return {
    apiKey,
    model,
    baseUrl: Deno.env.get('AI_API_BASE_URL')?.trim() || 'https://api.openai.com/v1',
    timeoutMs: 8000,
  };
}

async function authorize(req: Request, channel: AgentChannel): Promise<Caller | null> {
  const auth = req.headers.get('authorization') ?? '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!bearer) return null;

  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (serviceKey && bearer === serviceKey) return { kind: 'service', userId: null };
  // Internal channels are service-only from here on.
  if (channel !== 'app') return null;

  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (anonKey && bearer === anonKey) return { kind: 'anon', userId: null };

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  if (!supabaseUrl || !anonKey) return null;
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: auth } },
  });
  const {
    data: { user },
  } = await userClient.auth.getUser();
  return user ? { kind: 'user', userId: user.id } : null;
}

function composeAddress(row: Record<string, unknown>): string {
  return [row.address, row.city, row.county]
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter(Boolean)
    .join(', ');
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== 'POST') return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ ok: false, error: 'server_misconfigured' }, 500);
  }
  const admin = createClient(supabaseUrl, serviceKey);

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return jsonResponse({ ok: false, error: 'invalid_json' }, 400);
  }

  const channel: AgentChannel =
    body.channel === 'whatsapp' || body.channel === 'internal' ? body.channel : 'app';
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message) return jsonResponse({ ok: false, error: 'message_required' }, 400);
  if (message.length > 2000) return jsonResponse({ ok: false, error: 'message_too_long' }, 400);
  if (!body.business_id && !body.public_code) {
    return jsonResponse({ ok: false, error: 'business_required' }, 400);
  }

  const caller = await authorize(req, channel);
  if (!caller) return jsonResponse({ ok: false, error: 'unauthorized' }, 401);

  let bizQuery = admin
    .from('business_profiles')
    .select(
      'id, name, public_code, timezone, working_hours, cancel_notice_minutes, deposit_ron, address, city, county'
    );
  bizQuery = body.business_id
    ? bizQuery.eq('id', body.business_id)
    : bizQuery.eq('public_code', String(body.public_code).trim());
  const { data: biz, error: bizErr } = await bizQuery.maybeSingle();
  if (bizErr) return jsonResponse({ ok: false, error: bizErr.message }, 500);
  if (!biz) return jsonResponse({ ok: false, error: 'business_not_found' }, 404);

  // Private settings (v58). No row, an error or a missing table = agent off.
  const { data: aiCfg, error: cfgErr } = await admin
    .from('business_ai_settings')
    .select('agent_enabled, custom_faq')
    .eq('business_id', biz.id)
    .maybeSingle();
  if (cfgErr) console.warn('business_ai_settings read failed', cfgErr.message);
  if (!aiCfg || aiCfg.agent_enabled !== true) {
    return jsonResponse({ ok: false, error: 'agent_disabled' }, 403);
  }
  const customFaq = typeof aiCfg.custom_faq === 'string' ? aiCfg.custom_faq : '';

  // Call limiter, before the core (and so before any LLM call).
  const ip = caller.kind === 'service' ? null : clientIpFrom((n) => req.headers.get(n));
  const callerKey = buildCallerKey({
    userId: caller.userId,
    ipHash: ip ? await sha256Hex(`ai-agent:${ip}`) : null,
    serviceCallerKey:
      caller.kind === 'service' && typeof body.caller_key === 'string' ? body.caller_key : null,
  });
  const { data: rateData, error: rateErr } = await admin.rpc('ai_agent_check_rate', {
    p_business_id: biz.id,
    p_caller_key: callerKey,
    p_caller_per_minute: AI_RATE_LIMITS.callerPerMinute,
    p_caller_per_day: AI_RATE_LIMITS.callerPerDay,
    p_business_per_day: AI_RATE_LIMITS.businessPerDay,
  });
  const verdict = rateErr ? null : parseRateVerdict(rateData);
  if (rateErr) console.warn('ai_agent_check_rate failed', rateErr.message);
  if (verdict && !verdict.allowed) {
    return jsonResponse(
      {
        ok: false,
        error: 'rate_limited',
        scope: verdict.scope,
        retry_after_s: verdict.retryAfterS,
        message: rateLimitMessage(verdict.scope, verdict.retryAfterS),
      },
      429
    );
  }

  const [svcRes, staffRes] = await Promise.all([
    admin
      .from('services')
      .select('name, duration_minutes, price')
      .eq('business_id', biz.id)
      .eq('active', true)
      .order('sort_order'),
    admin
      .from('staff')
      .select('name, working_hours')
      .eq('business_id', biz.id)
      .eq('active', true)
      .order('sort_order'),
  ]);

  const staffRows = (staffRes.data ?? []) as Record<string, unknown>[];
  const knowledge = buildAgentKnowledge({
    businessName: biz.name as string,
    address: composeAddress(biz as Record<string, unknown>),
    phone: '',
    cancelNoticeMinutes: typeof biz.cancel_notice_minutes === 'number' ? biz.cancel_notice_minutes : 0,
    depositRon: typeof biz.deposit_ron === 'number' ? Number(biz.deposit_ron) : 0,
    services: ((svcRes.data ?? []) as Record<string, unknown>[]).map((s) => ({
      name: s.name as string,
      durationMinutes: typeof s.duration_minutes === 'number' ? s.duration_minutes : 0,
      priceRon: typeof s.price === 'number' ? Number(s.price) : 0,
    })),
    staffNames: staffRows.map((s) => s.name as string),
    workingHours: biz.working_hours ?? staffRows[0]?.working_hours ?? null,
    customFaq,
  });

  const result = await runAgentCore({
    knowledge,
    message,
    // Limiter not verified (RPC error) -> deterministic rules only, never the paid LLM.
    llm: verdict ? llmConfigFromEnv() : null,
  });

  // Structured journal only (no message body).
  const { error: logErr } = await admin.from('ai_agent_log').insert({
    business_id: biz.id,
    channel,
    intent: result.intent,
    confidence: result.confidence,
    source: result.source,
    tools_proposed: result.proposedTools,
    handoff: result.handoff,
  });
  if (logErr) console.warn('ai_agent_log insert failed', logErr.message);

  return jsonResponse({
    ok: true,
    business_id: biz.id,
    channel,
    ...result,
  });
});
