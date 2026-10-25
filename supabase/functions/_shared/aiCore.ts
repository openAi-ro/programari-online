/**
 * AI agent core — single source of truth shared by every channel (app, WhatsApp).
 *
 * Infrastructure only, by decision:
 * - classifies intent (deterministic rules first, optional OpenAI-compatible LLM),
 * - extracts entities (real service names, date hints) from the message,
 * - returns structured FACTS taken only from business data (never invented),
 * - proposes tools from a fixed registry (writes always need human confirmation),
 * - never renders user-facing text and never executes an action.
 *
 * Pure TypeScript: no Deno/Node APIs, so it is unit-testable anywhere.
 */

export type AgentChannel = 'app' | 'whatsapp' | 'internal';

export type AgentIntent =
  | 'greeting'
  | 'service_price'
  | 'services_list'
  | 'hours'
  | 'location'
  | 'staff'
  | 'book'
  | 'cancel_policy'
  | 'deposit'
  | 'human'
  | 'fallback';

export const AGENT_INTENTS: readonly AgentIntent[] = [
  'greeting',
  'service_price',
  'services_list',
  'hours',
  'location',
  'staff',
  'book',
  'cancel_policy',
  'deposit',
  'human',
  'fallback',
];

export type AgentServiceFact = {
  name: string;
  durationMinutes: number;
  priceRon: number;
};

export type AgentKnowledge = {
  businessName: string;
  address: string;
  phone: string;
  cancelNoticeMinutes: number;
  depositRon: number;
  services: AgentServiceFact[];
  staffNames: string[];
  /** Raw WorkingHours JSON of the business (or of the first staff member). */
  workingHours: unknown;
  customFaq: string;
};

export type AgentEntities = {
  /** Exact name of a real service mentioned in the message, else null. */
  serviceName: string | null;
  /** Relative day hint, else null. Kept relative: the channel resolves dates. */
  dateHint: 'today' | 'tomorrow' | 'day_after_tomorrow' | null;
};

export type AgentToolName =
  | 'get_free_slots'
  | 'create_booking'
  | 'reschedule_booking'
  | 'cancel_booking'
  | 'join_waitlist'
  | 'get_business_report'
  | 'open_human_chat';

export type AgentToolProposal = {
  tool: AgentToolName;
  risk: 'read' | 'write';
  /** Writes are never executed by the core; a human must confirm first. */
  requiresConfirmation: boolean;
  args: Record<string, string>;
  /** Entity names still missing before this tool could run. */
  missing: string[];
};

export type AgentResult = {
  intent: AgentIntent;
  /** 1 = exact rule/fact, 0.6 = partial, 0 = hand off to a human. */
  confidence: number;
  source: 'rules' | 'llm' | 'none';
  entities: AgentEntities;
  /** Structured facts for the matched intent. Numbers come only from knowledge. */
  facts: Record<string, unknown>;
  proposedTools: AgentToolProposal[];
  /** True when a human should take over (unknown, low confidence, human asked). */
  handoff: boolean;
  /**
   * What happened with the optional LLM: not_needed (rules were sure), off (not
   * configured), used, unsure (model said fallback/low confidence), error
   * (HTTP error such as 404/400 for a missing model, timeout, bad JSON).
   */
  llmStatus?: LlmStatus;
};

export type LlmStatus = 'not_needed' | 'off' | 'used' | 'unsure' | 'error';

export const HANDOFF_THRESHOLD = 0.6;

const DIACRITICS: Record<string, string> = {
  ă: 'a',
  â: 'a',
  î: 'i',
  ș: 's',
  ş: 's',
  ț: 't',
  ţ: 't',
};

export function normalizeAgentText(text: string): string {
  return (text ?? '')
    .toLowerCase()
    .split('')
    .map((c) => DIACRITICS[c] ?? c)
    .join('');
}

function includesAny(text: string, words: readonly string[]): boolean {
  return words.some((w) => text.includes(w));
}

export function buildAgentKnowledge(input: {
  businessName: string;
  address: string;
  phone: string;
  cancelNoticeMinutes: number;
  depositRon: number;
  services: AgentServiceFact[];
  staffNames: string[];
  workingHours: unknown;
  customFaq: string;
}): AgentKnowledge {
  return {
    businessName: (input.businessName ?? '').trim(),
    address: (input.address ?? '').trim(),
    phone: (input.phone ?? '').trim(),
    cancelNoticeMinutes: Math.max(0, Math.trunc(input.cancelNoticeMinutes || 0)),
    depositRon: Math.max(0, Number(input.depositRon) || 0),
    services: (input.services ?? [])
      .map((s) => ({
        name: (s.name ?? '').trim(),
        durationMinutes: Math.max(0, Math.trunc(s.durationMinutes || 0)),
        priceRon: Math.max(0, Number(s.priceRon) || 0),
      }))
      .filter((s) => s.name.length > 0),
    staffNames: (input.staffNames ?? []).map((n) => (n ?? '').trim()).filter((n) => n.length > 0),
    workingHours: input.workingHours ?? null,
    customFaq: (input.customFaq ?? '').trim(),
  };
}

function extractEntities(knowledge: AgentKnowledge, text: string): AgentEntities {
  const mentioned =
    knowledge.services.find((s) => {
      const name = normalizeAgentText(s.name);
      return name.length >= 3 && text.includes(name);
    }) ?? null;

  let dateHint: AgentEntities['dateHint'] = null;
  if (includesAny(text, ['poimaine'])) dateHint = 'day_after_tomorrow';
  else if (includesAny(text, ['maine'])) dateHint = 'tomorrow';
  else if (includesAny(text, ['azi', 'astazi'])) dateHint = 'today';

  return { serviceName: mentioned?.name ?? null, dateHint };
}

function serviceFact(knowledge: AgentKnowledge, name: string | null): AgentServiceFact | null {
  if (!name) return null;
  return knowledge.services.find((s) => s.name === name) ?? null;
}

/** Tool registry: the only actions the core may ever propose. */
export function proposeTools(
  intent: AgentIntent,
  entities: AgentEntities
): AgentToolProposal[] {
  const tools: AgentToolProposal[] = [];
  if (intent === 'book' || intent === 'service_price' || intent === 'services_list') {
    const missing: string[] = [];
    if (!entities.serviceName) missing.push('service');
    if (!entities.dateHint) missing.push('date');
    tools.push({
      tool: 'get_free_slots',
      risk: 'read',
      requiresConfirmation: false,
      args: {
        ...(entities.serviceName ? { service: entities.serviceName } : {}),
        ...(entities.dateHint ? { dateHint: entities.dateHint } : {}),
      },
      missing,
    });
  }
  if (intent === 'book') {
    const missing: string[] = [];
    if (!entities.serviceName) missing.push('service');
    if (!entities.dateHint) missing.push('date');
    missing.push('slot');
    tools.push({
      tool: 'create_booking',
      risk: 'write',
      requiresConfirmation: true,
      args: {
        ...(entities.serviceName ? { service: entities.serviceName } : {}),
        ...(entities.dateHint ? { dateHint: entities.dateHint } : {}),
      },
      missing,
    });
  }
  if (intent === 'cancel_policy') {
    tools.push({
      tool: 'cancel_booking',
      risk: 'write',
      requiresConfirmation: true,
      args: {},
      missing: ['appointment'],
    });
    tools.push({
      tool: 'reschedule_booking',
      risk: 'write',
      requiresConfirmation: true,
      args: {},
      missing: ['appointment', 'slot'],
    });
  }
  if (intent === 'human' || intent === 'fallback') {
    tools.push({
      tool: 'open_human_chat',
      risk: 'read',
      requiresConfirmation: false,
      args: {},
      missing: [],
    });
  }
  return tools;
}

function factsFor(
  knowledge: AgentKnowledge,
  intent: AgentIntent,
  entities: AgentEntities
): Record<string, unknown> {
  switch (intent) {
    case 'service_price': {
      const svc = serviceFact(knowledge, entities.serviceName);
      return svc
        ? { service: { name: svc.name, priceRon: svc.priceRon, durationMinutes: svc.durationMinutes } }
        : { services: knowledge.services };
    }
    case 'services_list':
      return { services: knowledge.services };
    case 'hours':
      return { workingHours: knowledge.workingHours };
    case 'location':
      return { address: knowledge.address };
    case 'staff':
      return { staffNames: knowledge.staffNames };
    case 'cancel_policy':
      return { cancelNoticeMinutes: knowledge.cancelNoticeMinutes };
    case 'deposit':
      return { depositRon: knowledge.depositRon };
    case 'human':
      return { phone: knowledge.phone };
    case 'book':
      return { services: knowledge.services, staffNames: knowledge.staffNames };
    default:
      return {};
  }
}

function makeResult(
  knowledge: AgentKnowledge,
  intent: AgentIntent,
  confidence: number,
  source: AgentResult['source'],
  entities: AgentEntities
): AgentResult {
  return {
    intent,
    confidence,
    source,
    entities,
    facts: factsFor(knowledge, intent, entities),
    proposedTools: proposeTools(intent, entities),
    handoff: intent === 'human' || intent === 'fallback' || confidence < HANDOFF_THRESHOLD,
  };
}

/** Deterministic classifier: same keyword semantics as the in-app assistant. */
export function classifyWithRules(
  knowledge: AgentKnowledge,
  message: string
): AgentResult {
  const text = normalizeAgentText(message);
  const entities = extractEntities(knowledge, text);

  if (/(^|\W)(buna|salut|hei|hello|hi|ziua buna|seara buna)(\W|$)/.test(text)) {
    return makeResult(knowledge, 'greeting', 1, 'rules', entities);
  }
  if (
    includesAny(text, [
      'vorbesc cu cineva', 'vorbesc cu un om', 'operator', 'persoana',
      'cineva de la salon', 'suna', 'sunati', 'ma sun', 'telefon', 'apel', 'contact',
    ])
  ) {
    return makeResult(knowledge, 'human', 1, 'rules', entities);
  }
  if (
    includesAny(text, [
      'anulez', 'anula', 'anularea', 'anulare', 'mut', 'mutarea',
      'reprogramez', 'reprogramare', 'amana', 'amanare',
    ])
  ) {
    return makeResult(knowledge, 'cancel_policy', 1, 'rules', entities);
  }
  if (includesAny(text, ['avans', 'plata', 'platesc', 'card', 'depozit', 'garantie'])) {
    return makeResult(knowledge, 'deposit', 1, 'rules', entities);
  }
  if (
    includesAny(text, [
      'programare', 'programeaza', 'rezerv', 'vreau', 'as vrea', 'ma program',
      'liber', 'disponibil', 'maine', 'azi', 'saptamana',
    ])
  ) {
    return makeResult(knowledge, 'book', 0.9, 'rules', entities);
  }
  if (
    includesAny(text, [
      'specialist', 'specialisti', 'frizer', 'barber', 'stilist', 'cine ma',
      'cine ne', 'echipa', 'cine lucreaza', 'maestru', 'tunde',
    ])
  ) {
    return makeResult(knowledge, 'staff', 1, 'rules', entities);
  }
  if (
    includesAny(text, [
      'unde vorbesti', 'unde vorbiti', 'unde sunteti', 'unde va aflati', 'adresa',
      'locatie', 'gasesti', 'gasesc', 'parcare', 'parchez', 'ajung', 'harta', 'zona',
    ])
  ) {
    return makeResult(knowledge, 'location', 1, 'rules', entities);
  }
  if (
    includesAny(text, [
      'program', 'orar', 'deschis', 'inchis', 'cand lucrati', 'cand sunteti',
      'cand incepeti', 'duminica', 'sambata',
    ])
  ) {
    return makeResult(knowledge, 'hours', 1, 'rules', entities);
  }
  if (entities.serviceName) {
    const asksPrice = includesAny(text, ['pret', 'costa', 'cat e', 'cat costa', 'tarif', 'lei']);
    return makeResult(knowledge, 'service_price', asksPrice ? 1 : 0.6, 'rules', entities);
  }
  if (
    includesAny(text, [
      'pret', 'costa', 'cat e', 'tarif', 'lei', 'servicii', 'serviciu',
      'ce faceti', 'oferte', 'oferiti', 'lista', 'meniu',
    ])
  ) {
    return makeResult(knowledge, 'services_list', 0.9, 'rules', entities);
  }
  return makeResult(knowledge, 'fallback', 0, 'none', entities);
}

// ---------------------------------------------------------------------------
// Personal-data redaction: applied to EVERYTHING sent to an external model.
// Only the question text (redacted) and the business's public info leave.
// ---------------------------------------------------------------------------

const EMAIL_RE = /[\p{L}0-9._%+-]+@[\p{L}0-9.-]+\.[\p{L}]{2,}/giu;
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
/** 9+ digits with optional separators: phones, CNP, card/IBAN fragments. */
const LONG_NUMBER_RE = /\+?\d(?:[\s.\-/()]*\d){8,}/g;
/** Codes/ids mixing letters and digits (booking codes, public codes, references). */
const CODE_RE = /\b(?=[\p{L}0-9]*\d)(?=[\p{L}0-9]*\p{L})[\p{L}0-9]{6,}\b/gu;
const IBAN_RE = /\bRO\d{2}[A-Z]{4}[0-9A-Z]{16}\b/gi;
const URL_RE = /\bhttps?:\/\/\S+/gi;
const ADDRESS_RE =
  /\b(?:str(?:ada)?|bd|b-dul|bulevardul|calea|aleea|sos(?:eaua)?|șos(?:eaua)?|piața|piata|nr|bl|bloc|sc|ap|apartament)\.?\s+[^,;!?\n]{1,40}/giu;
/** „mă numesc Ana”, „numele meu este Ana”, „my name is Ana” (any case). */
const NAME_INTRO_RE =
  /(m[ăa]\s+numesc|numele\s+meu\s+(?:e|este)|my\s+name\s+is)\s+\p{L}[\p{L}'-]*(?:\s+\p{Lu}[\p{L}'-]*)?/giu;
/** „sunt Ana Pop”, „I'm Ana”: only when followed by a Capitalised word (case-sensitive). */
const NAME_SELF_RE = /(?<![\p{L}])([Ss]unt|I am|I'm)\s+\p{Lu}[\p{L}'-]*(?:\s+\p{Lu}[\p{L}'-]*)?/gu;

function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Removes personal data from free text: emails, URLs, IBANs, phone-like numbers,
 * ids/codes, street addresses, self-introductions ("mă numesc Ana") and any of
 * the given names (staff, client). Prices ("50 lei") and dates stay.
 */
export function redactPersonalData(text: string, names: readonly string[] = []): string {
  let out = (text ?? '').slice(0, 2000);
  out = out.replace(EMAIL_RE, '[email]');
  out = out.replace(URL_RE, '[link]');
  out = out.replace(IBAN_RE, '[iban]');
  out = out.replace(UUID_RE, '[id]');
  out = out.replace(LONG_NUMBER_RE, '[număr]');
  out = out.replace(CODE_RE, '[cod]');
  out = out.replace(ADDRESS_RE, '[adresă]');
  out = out.replace(NAME_INTRO_RE, (_m, intro: string) => `${intro} [nume]`);
  out = out.replace(NAME_SELF_RE, (_m, intro: string) => `${intro} [nume]`);
  for (const raw of names) {
    const n = (raw ?? '').trim();
    if (n.length < 2) continue;
    for (const part of [n, ...n.split(/\s+/).filter((p) => p.length >= 3)]) {
      out = out.replace(new RegExp(`(?<![\\p{L}])${escapeRe(part)}(?![\\p{L}])`, 'giu'), '[nume]');
    }
  }
  return out.replace(/(\[nume\]\s*){2,}/g, '[nume] ');
}

function compactHours(workingHours: unknown): string {
  if (!workingHours || typeof workingHours !== 'object') return 'unknown';
  try {
    return JSON.stringify(workingHours).slice(0, 400);
  } catch {
    return 'unknown';
  }
}

/**
 * The exact messages sent to the model: business PUBLIC info (name, services,
 * hours, FAQ — the FAQ also redacted) and the redacted customer question.
 * Never: staff names, phone, address, client names/ids, booking ids.
 */
export function buildLlmMessages(
  knowledge: AgentKnowledge,
  message: string
): { role: 'system' | 'user'; content: string }[] {
  const serviceNames = knowledge.services.map((s) => s.name).join(', ');
  const faq = redactPersonalData(knowledge.customFaq, knowledge.staffNames).slice(0, 1500);
  const system = [
    'You classify a customer message for a booking business.',
    `Business: ${knowledge.businessName}. Services (exact names): ${serviceNames || 'none'}.`,
    `Working hours (JSON): ${compactHours(knowledge.workingHours)}.`,
    faq ? `Business FAQ: ${faq}` : 'Business FAQ: none.',
    `Reply with ONLY a JSON object: {"intent": one of ${AGENT_INTENTS.join('|')}, "confidence": 0..1, "serviceName": exact service name or null, "dateHint": "today"|"tomorrow"|"day_after_tomorrow"|null}.`,
    'Never invent prices, durations, times or services. If unsure, intent=fallback, confidence=0.',
    'Placeholders like [nume], [număr], [email] replace removed personal data.',
  ].join('\n');
  return [
    { role: 'system', content: system },
    { role: 'user', content: redactPersonalData(message, knowledge.staffNames) },
  ];
}

// ---------------------------------------------------------------------------
// Optional LLM classifier (OpenAI-compatible: Groq, OpenRouter, OpenAI, ...).
// The model may only pick an intent and reference real entities. It never
// supplies prices, durations or times: facts always come from knowledge.
// Any failure returns null and the caller keeps the deterministic result.
// ---------------------------------------------------------------------------

export type LlmConfig = {
  apiKey: string;
  model: string;
  /** e.g. https://api.openai.com/v1 — configurable per provider. */
  baseUrl: string;
  timeoutMs?: number;
};

export type LlmFetch = (
  input: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  }
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

type LlmVerdict = { intent: AgentIntent; confidence: number; entities: AgentEntities };

function parseLlmVerdict(knowledge: AgentKnowledge, raw: unknown): LlmVerdict | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as Record<string, unknown>;
  const intent = v.intent;
  if (typeof intent !== 'string' || !(AGENT_INTENTS as readonly string[]).includes(intent)) {
    return null;
  }
  const confidenceRaw = typeof v.confidence === 'number' ? v.confidence : 0;
  const confidence = Math.min(1, Math.max(0, confidenceRaw));

  // A service named by the model is accepted only if it really exists.
  let serviceName: string | null = null;
  if (typeof v.serviceName === 'string') {
    const wanted = normalizeAgentText(v.serviceName);
    serviceName =
      knowledge.services.find((s) => normalizeAgentText(s.name) === wanted)?.name ?? null;
  }
  const dateHint =
    v.dateHint === 'today' || v.dateHint === 'tomorrow' || v.dateHint === 'day_after_tomorrow'
      ? v.dateHint
      : null;

  return { intent: intent as AgentIntent, confidence, entities: { serviceName, dateHint } };
}

export async function classifyWithLlmDetailed(
  config: LlmConfig,
  knowledge: AgentKnowledge,
  message: string,
  fetchImpl: LlmFetch = fetch as unknown as LlmFetch
): Promise<{ verdict: LlmVerdict | null; status: LlmStatus; httpStatus?: number }> {
  if (!config.apiKey || !config.model) return { verdict: null, status: 'off' };
  const base = (config.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs ?? 8000);
  try {
    const res = await fetchImpl(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + config.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0,
        messages: buildLlmMessages(knowledge, message),
      }),
      signal: controller.signal,
    });
    // 404/400 (e.g. model missing), 401, 429, 5xx: keep the rules result.
    if (!res.ok) return { verdict: null, status: 'error', httpStatus: res.status };
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content ?? '';
    const jsonStart = content.indexOf('{');
    const jsonEnd = content.lastIndexOf('}');
    if (jsonStart < 0 || jsonEnd <= jsonStart) return { verdict: null, status: 'error', httpStatus: res.status };
    const verdict = parseLlmVerdict(knowledge, JSON.parse(content.slice(jsonStart, jsonEnd + 1)));
    return { verdict, status: verdict ? 'used' : 'error', httpStatus: res.status };
  } catch {
    return { verdict: null, status: 'error' };
  } finally {
    clearTimeout(timer);
  }
}

export async function classifyWithLlm(
  config: LlmConfig,
  knowledge: AgentKnowledge,
  message: string,
  fetchImpl?: LlmFetch
): Promise<LlmVerdict | null> {
  return (await classifyWithLlmDetailed(config, knowledge, message, fetchImpl)).verdict;
}

/**
 * Guard: a structured payload may only carry prices/durations that exist in
 * knowledge. Returns the list of offending values (empty = clean).
 */
export function findInventedNumbers(
  knowledge: AgentKnowledge,
  payload: unknown
): string[] {
  const bad: string[] = [];
  const allowedPrices = new Set(knowledge.services.map((s) => s.priceRon));
  allowedPrices.add(knowledge.depositRon);
  const allowedDurations = new Set(knowledge.services.map((s) => s.durationMinutes));

  function walk(node: unknown, key: string) {
    if (typeof node === 'number') {
      if ((key === 'priceRon' || key === 'price') && !allowedPrices.has(node)) {
        bad.push(`${key}=${node}`);
      }
      if ((key === 'durationMinutes' || key === 'duration') && !allowedDurations.has(node)) {
        bad.push(`${key}=${node}`);
      }
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item, key);
      return;
    }
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) walk(v, k);
    }
  }
  walk(payload, '');
  return bad;
}

/**
 * Core entry point. Rules run first; the LLM is consulted only when the rules
 * are unsure (fallback or partial) and a config is provided. LLM output is
 * re-checked against the same fact/tool builders, so channels always receive
 * knowledge-backed facts.
 */
export async function runAgentCore(input: {
  knowledge: AgentKnowledge;
  message: string;
  llm?: LlmConfig | null;
  fetchImpl?: LlmFetch;
}): Promise<AgentResult> {
  const ruled = classifyWithRules(input.knowledge, input.message);
  // 1 = sure, 0.6 = partial, 0 = unknown. The LLM may improve partial/unknown.
  if (ruled.confidence > HANDOFF_THRESHOLD) return { ...ruled, llmStatus: 'not_needed' };
  if (!input.llm) return { ...ruled, llmStatus: 'off' };

  const { verdict, status } = await classifyWithLlmDetailed(
    input.llm,
    input.knowledge,
    input.message,
    input.fetchImpl
  );
  if (!verdict) return { ...ruled, llmStatus: status };
  if (verdict.intent === 'fallback' || verdict.confidence < HANDOFF_THRESHOLD) {
    return { ...ruled, llmStatus: 'unsure' };
  }
  return {
    ...makeResult(input.knowledge, verdict.intent, verdict.confidence, 'llm', verdict.entities),
    llmStatus: 'used',
  };
}


// ---------------------------------------------------------------------------
// Call limiter (enforced in the Edge Function through public.ai_agent_check_rate,
// before the core runs and therefore before any LLM call).

/** Per caller 20/minute and 200/day; per business 1000/day (UTC days). */
export const AI_RATE_LIMITS = {
  callerPerMinute: 20,
  callerPerDay: 200,
  businessPerDay: 1000,
} as const;

export type RateScope = 'caller_minute' | 'caller_day' | 'business_day';

export type RateVerdict = {
  allowed: boolean;
  scope: RateScope | null;
  retryAfterS: number;
};

/** Normalises the jsonb returned by ai_agent_check_rate. Anything malformed = not verified. */
export function parseRateVerdict(data: unknown): RateVerdict | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (typeof d.allowed !== 'boolean') return null;
  const scope =
    d.scope === 'caller_minute' || d.scope === 'caller_day' || d.scope === 'business_day'
      ? d.scope
      : null;
  const retry = typeof d.retry_after_s === 'number' && Number.isFinite(d.retry_after_s)
    ? Math.max(0, Math.round(d.retry_after_s))
    : 0;
  return { allowed: d.allowed, scope, retryAfterS: retry };
}

/**
 * Stable caller key: signed-in user id, otherwise a hash of the IP. Service-role
 * channels (WhatsApp) may pass their own opaque key (e.g. a hashed phone);
 * without one only the per-business limit applies. Raw IPs are never stored.
 */
export function buildCallerKey(input: {
  userId?: string | null;
  ipHash?: string | null;
  serviceCallerKey?: string | null;
}): string | null {
  const clean = (v: string | null | undefined) => (typeof v === 'string' ? v.trim().slice(0, 128) : '');
  const user = clean(input.userId);
  if (user) return `u:${user}`;
  const service = clean(input.serviceCallerKey);
  if (service) return `s:${service}`;
  const ip = clean(input.ipHash);
  if (ip) return `ip:${ip}`;
  return null;
}

const IP_RE = /^[0-9A-Fa-f:.]{2,45}$/;
const validIp = (v: string | null | undefined): string | null => {
  const t = v?.trim();
  return t && IP_RE.test(t) ? t : null;
};

/**
 * Client IP for rate limiting. cf-connecting-ip is set by Cloudflare (a client-sent value is
 * overwritten), so it wins. Otherwise the LAST x-forwarded-for entry: proxies append the address
 * they saw, while earlier entries are whatever the client sent (spoofable). Same rule as
 * public.request_client_ip() in the database (v82).
 */
export function clientIpFrom(get: (name: string) => string | null): string | null {
  const cf = validIp(get('cf-connecting-ip'));
  if (cf) return cf;
  const last = get('x-forwarded-for')?.split(',').map((e) => e.trim()).filter(Boolean).pop();
  return validIp(last) ?? validIp(get('x-real-ip'));
}

/** Friendly Romanian message for HTTP 429. */
export function rateLimitMessage(scope: RateScope | null, retryAfterS: number): string {
  if (scope === 'caller_minute') {
    const s = Math.max(1, Math.min(60, retryAfterS || 60));
    return `Ai trimis multe mesaje într-un timp scurt. Te rugăm să încerci din nou peste ${s} secunde.`;
  }
  if (scope === 'business_day') {
    return 'Asistentul acestui business a primit foarte multe mesaje astăzi. Încearcă din nou mâine sau contactează direct business-ul.';
  }
  return 'Ai atins limita de mesaje pentru astăzi. Încearcă din nou mâine sau contactează direct business-ul.';
}

/**
 * Claims of a JWT WITHOUT verifying the signature. Only safe behind the Supabase
 * gateway with verify_jwt on (default), which has already verified it. Used to
 * recognise the project's anon key even when SUPABASE_ANON_KEY holds another format.
 */
export function jwtClaims(token: string): { role?: string; ref?: string; sub?: string } | null {
  const parts = (token ?? '').split('.');
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    const c = JSON.parse(json) as Record<string, unknown>;
    return {
      role: typeof c.role === 'string' ? c.role : undefined,
      ref: typeof c.ref === 'string' ? c.ref : undefined,
      sub: typeof c.sub === 'string' ? c.sub : undefined,
    };
  } catch {
    return null;
  }
}
