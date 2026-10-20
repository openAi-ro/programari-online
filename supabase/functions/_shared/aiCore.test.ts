/**
 * Run from apps/mobile:  npx tsx ../../supabase/functions/_shared/aiCore.test.ts
 * Plain asserts (same style as apps/mobile/lib/*.test.ts) so it runs without Deno.
 */
import {
  AI_RATE_LIMITS,
  buildAgentKnowledge,
  buildCallerKey,
  clientIpFrom,
  parseRateVerdict,
  rateLimitMessage,
  classifyWithLlm,
  classifyWithRules,
  findInventedNumbers,
  runAgentCore,
  type LlmFetch,
} from './aiCore';

let passed = 0;
let failed = 0;
function assert(cond: boolean, name: string, detail?: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error(`FAIL ${name}${detail ? `: ${detail}` : ''}`);
  }
}

const knowledge = buildAgentKnowledge({
  businessName: 'Salon Frumos',
  address: 'Str. Florilor 10, Cluj',
  phone: '0712345678',
  cancelNoticeMinutes: 180,
  depositRon: 50,
  services: [
    { name: 'Tuns', durationMinutes: 30, priceRon: 50 },
    { name: 'Barbă', durationMinutes: 20, priceRon: 30 },
  ],
  staffNames: ['Andrei', 'Maria'],
  workingHours: { mon: { closed: false, start: '09:00', end: '17:00' } },
  customFaq: '',
});

async function main() {
  const price = classifyWithRules(knowledge, 'Cât costă tunsul?');
  assert(price.intent === 'service_price', 'preț serviciu -> service_price', price.intent);
  const svc = (price.facts as { service?: { name: string; priceRon: number } }).service;
  assert(svc?.name === 'Tuns' && svc?.priceRon === 50, 'fapte reale: nume + preț din date');
  assert(price.handoff === false, 'preț sigur -> fără predare la om');

  const book = classifyWithRules(knowledge, 'Vreau o programare mâine la tuns');
  assert(book.intent === 'book', 'vreau programare -> book', book.intent);
  assert(book.entities.serviceName === 'Tuns', 'entitate serviciu real extrasă');
  assert(book.entities.dateHint === 'tomorrow', 'entitate dată relativă extrasă');
  const create = book.proposedTools.find((t) => t.tool === 'create_booking');
  assert(Boolean(create), 'book propune create_booking');
  assert(create?.requiresConfirmation === true, 'scrierea cere confirmare umană');
  assert(create?.risk === 'write', 'create_booking e marcat scriere');
  const slots = book.proposedTools.find((t) => t.tool === 'get_free_slots');
  assert(slots?.risk === 'read' && slots.missing.length === 0, 'sloturi: citire, serviciu + dată cunoscute');
  assert(create?.missing.includes('slot') === true, 'rezervarea așteaptă slotul concret ales');

  const human = classifyWithRules(knowledge, 'Pot vorbi cu cineva de la salon?');
  assert(human.intent === 'human' && human.handoff === true, 'cere om -> predare la om');
  assert(
    human.proposedTools.some((t) => t.tool === 'open_human_chat'),
    'predarea propune chat cu firma'
  );

  const unknown = classifyWithRules(knowledge, 'asdf qwerty zzz');
  assert(unknown.intent === 'fallback' && unknown.confidence === 0, 'necunoscut -> fallback 0');
  assert(unknown.handoff === true, 'fallback -> predare la om');

  const cancel = classifyWithRules(knowledge, 'Cum anulez programarea?');
  assert(cancel.intent === 'cancel_policy', 'anulare -> cancel_policy', cancel.intent);
  assert(
    (cancel.facts as { cancelNoticeMinutes?: number }).cancelNoticeMinutes === 180,
    'regula de anulare reală în fapte'
  );
  assert(
    cancel.proposedTools.every((t) => !t.requiresConfirmation || t.risk === 'write'),
    'instrumentele de scriere din anulare cer confirmare'
  );

  assert(findInventedNumbers(knowledge, price.facts).length === 0, 'faptele nucleului sunt curate');
  assert(
    findInventedNumbers(knowledge, { service: { priceRon: 999 } }).length === 1,
    'preț inventat -> detectat de gardă'
  );
  assert(
    findInventedNumbers(knowledge, { service: { durationMinutes: 45 } }).length === 1,
    'durată inventată -> detectată de gardă'
  );

  // LLM: without a key it must never be called.
  let calls = 0;
  const countingFetch: LlmFetch = async () => {
    calls += 1;
    return { ok: true, status: 200, json: async () => ({}) };
  };
  const noKey = await classifyWithLlm(
    { apiKey: '', model: 'm', baseUrl: 'https://example.invalid/v1' },
    knowledge,
    'ceva neclar',
    countingFetch
  );
  assert(noKey === null && calls === 0, 'fără cheie API -> LLM neatins');

  // LLM: a real service is accepted, an invented one is dropped.
  const goodFetch: LlmFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [
        {
          message: {
            content:
              '{"intent":"service_price","confidence":0.9,"serviceName":"Barbă","dateHint":null}',
          },
        },
      ],
    }),
  });
  const verdict = await classifyWithLlm(
    { apiKey: 'k', model: 'm', baseUrl: 'https://example.invalid/v1' },
    knowledge,
    'dar barba?',
    goodFetch
  );
  assert(verdict?.intent === 'service_price', 'LLM: intenție validă acceptată');
  assert(verdict?.entities.serviceName === 'Barbă', 'LLM: serviciu real păstrat');

  const lyingFetch: LlmFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [
        {
          message: {
            content:
              '{"intent":"service_price","confidence":0.9,"serviceName":"Masaj Thai","dateHint":null}',
          },
        },
      ],
    }),
  });
  const lie = await classifyWithLlm(
    { apiKey: 'k', model: 'm', baseUrl: 'https://example.invalid/v1' },
    knowledge,
    'masaj?',
    lyingFetch
  );
  assert(lie?.entities.serviceName === null, 'LLM: serviciu inventat -> respins');

  // Core: rules unsure + LLM sure -> LLM result, facts still from knowledge.
  const core = await runAgentCore({
    knowledge,
    message: 'dar barba?',
    llm: { apiKey: 'k', model: 'm', baseUrl: 'https://example.invalid/v1' },
    fetchImpl: goodFetch,
  });
  assert(core.source === 'llm' && core.intent === 'service_price', 'nucleu: LLM folosit la nevoie');
  const coreSvc = (core.facts as { service?: { priceRon: number } }).service;
  assert(coreSvc?.priceRon === 30, 'nucleu: prețul vine din date, nu din model');

  // Core: no LLM configured -> deterministic only.
  const plain = await runAgentCore({ knowledge, message: 'Unde vă găsesc?' });
  assert(plain.intent === 'location' && plain.source === 'rules', 'nucleu fără LLM -> reguli');

  // Limiter helpers.
  assert(AI_RATE_LIMITS.callerPerMinute === 20 && AI_RATE_LIMITS.callerPerDay === 200 && AI_RATE_LIMITS.businessPerDay === 1000, 'limite documentate');
  const ok = parseRateVerdict({ allowed: true, scope: null, retry_after_s: 0 });
  assert(ok?.allowed === true && ok.scope === null, 'verdict permis');
  const blocked = parseRateVerdict({ allowed: false, scope: 'caller_minute', retry_after_s: 37.4 });
  assert(blocked?.allowed === false && blocked.scope === 'caller_minute' && blocked.retryAfterS === 37, 'verdict blocat');
  assert(parseRateVerdict(null) === null && parseRateVerdict({ scope: 'x' }) === null, 'verdict invalid -> null');
  assert(parseRateVerdict({ allowed: false, scope: 'weird', retry_after_s: -5 })?.retryAfterS === 0, 'verdict: scope/retry sanitizate');
  assert(buildCallerKey({ userId: 'u1', ipHash: 'h' }) === 'u:u1', 'cheie: utilizator înaintea IP');
  assert(buildCallerKey({ serviceCallerKey: ' wa-abc ' }) === 's:wa-abc', 'cheie: canal de serviciu');
  assert(buildCallerKey({ ipHash: 'abc' }) === 'ip:abc', 'cheie: hash IP');
  assert(buildCallerKey({}) === null, 'cheie: nimic -> null (doar limita business)');
  assert((buildCallerKey({ userId: 'x'.repeat(500) }) ?? '').length === 130, 'cheie: lungime limitată');
  const h = (m: Record<string, string>) => (n: string) => m[n] ?? null;
  assert(clientIpFrom(h({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1' })) === '1.2.3.4', 'IP din x-forwarded-for');
  assert(clientIpFrom(h({ 'cf-connecting-ip': '5.6.7.8' })) === '5.6.7.8', 'IP din cf-connecting-ip');
  assert(clientIpFrom(h({})) === null, 'fără IP');
  assert(/peste 37 secunde/.test(rateLimitMessage('caller_minute', 37)), 'mesaj 429 pe minut');
  assert(/astăzi/.test(rateLimitMessage('caller_day', 3600)) && /business/.test(rateLimitMessage('business_day', 10)), 'mesaje 429 pe zi');

  console.log(`aiCore: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main();
