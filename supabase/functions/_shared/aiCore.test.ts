/**
 * Run from apps/mobile:  npx tsx ../../supabase/functions/_shared/aiCore.test.ts
 * Plain asserts (same style as apps/mobile/lib/*.test.ts) so it runs without Deno.
 */
import {
  AI_RATE_LIMITS,
  buildAgentKnowledge,
  buildLlmMessages,
  jwtClaims,
  classifyWithLlmDetailed,
  redactPersonalData,
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
  assert(clientIpFrom(h({ 'x-forwarded-for': '6.6.6.6, 1.2.3.4' })) === '1.2.3.4', 'IP: ultima intrare x-forwarded-for (prima e falsificabilă)');
  assert(clientIpFrom(h({ 'x-forwarded-for': '6.6.6.6', 'cf-connecting-ip': '5.6.7.8' })) === '5.6.7.8', 'IP: cf-connecting-ip are prioritate');
  assert(clientIpFrom(h({ 'cf-connecting-ip': 'evil', 'x-forwarded-for': '1.2.3.4' })) === '1.2.3.4', 'IP: cf invalid ignorat');
  assert(clientIpFrom(h({ 'x-forwarded-for': '1.2.3.4, ' })) === '1.2.3.4', 'IP: intrări goale ignorate');
  assert(clientIpFrom(h({ 'x-forwarded-for': '2001:db8::1' })) === '2001:db8::1', 'IP: IPv6');
  assert(clientIpFrom(h({ 'x-forwarded-for': '<script>' })) === null, 'IP: valoare invalidă -> null');
  assert(clientIpFrom(h({})) === null, 'fără IP');
  assert(/peste 37 secunde/.test(rateLimitMessage('caller_minute', 37)), 'mesaj 429 pe minut');
  assert(/astăzi/.test(rateLimitMessage('caller_day', 3600)) && /business/.test(rateLimitMessage('business_day', 10)), 'mesaje 429 pe zi');

  // Redaction: nothing personal goes to the model.
  const r = (t: string, n: string[] = []) => redactPersonalData(t, n);
  assert(r('Scrieți-mi la ana.pop@gmail.com') === 'Scrieți-mi la [email]', 'redact email', r('Scrieți-mi la ana.pop@gmail.com'));
  assert(!/\d{3}/.test(r('Sunați-mă la 0712 345 678 sau +40 722-111-222')), 'redact telefoane', r('Sunați-mă la 0712 345 678 sau +40 722-111-222'));
  assert(r('CNP 1900101123456') === 'CNP [număr]', 'redact CNP');
  assert(r('Programarea 82edafb9-1234-4abc-8def-0123456789ab') === 'Programarea [id]', 'redact uuid');
  assert(r('codul meu e cfv695xzeo') === 'codul meu e [cod]', 'redact cod', r('codul meu e cfv695xzeo'));
  assert(/\[adresă\]/.test(r('Locuiesc pe Strada Florilor 10, Cluj')) && !/Florilor/.test(r('Locuiesc pe Strada Florilor 10, Cluj')), 'redact adresă', r('Locuiesc pe Strada Florilor 10, Cluj'));
  assert(r('Bună, mă numesc Ana Popescu, pot veni mâine?') === 'Bună, mă numesc [nume], pot veni mâine?', 'redact „mă numesc”', r('Bună, mă numesc Ana Popescu, pot veni mâine?'));
  assert(!/Ioana/.test(r('Vreau la Ioana mâine', ['Ioana Marin'])), 'redact nume angajat');
  assert(!/Marin/.test(r('Merge la doamna Marin?', ['Ioana Marin'])), 'redact nume de familie');
  assert(r('Cât costă tunsul? 50 lei la 10:30 pe 21.10.2026') === 'Cât costă tunsul? 50 lei la 10:30 pe 21.10.2026', 'păstrează preț, oră, dată', r('Cât costă tunsul? 50 lei la 10:30 pe 21.10.2026'));
  assert(r('Pot veni cu copilul?') === 'Pot veni cu copilul?', 'întrebare fără date personale neschimbată');
  assert(r('Sunt interesată de tuns') === 'Sunt interesată de tuns', '„sunt” + cuvânt obișnuit rămâne');
  assert(r('Bună ziua, sunt Ana Pop') === 'Bună ziua, sunt [nume]', 'redact „sunt Ana Pop”', r('Bună ziua, sunt Ana Pop'));
  assert(r('IBAN RO49AAAA1B31007593840000') === 'IBAN [iban]', 'redact IBAN', r('IBAN RO49AAAA1B31007593840000'));
  assert(r('vezi https://exemplu.ro/x?id=5') === 'vezi [link]', 'redact link');

  const kPriv = buildAgentKnowledge({
    businessName: 'Salon Frumos', address: 'Str. Florilor 10, Cluj', phone: '0712345678',
    cancelNoticeMinutes: 60, depositRon: 0,
    services: [{ name: 'Tuns', durationMinutes: 30, priceRon: 50 }],
    staffNames: ['Ioana Marin'], workingHours: { mon: [['09:00', '17:00']] },
    customFaq: 'Acceptăm copii. Pentru urgențe sunați Ioana la 0733 444 555.',
  });
  const msgs = buildLlmMessages(kPriv, 'Sunt Mihai, 0711222333, mihai@x.ro: pot veni cu copilul?');
  const sent = JSON.stringify(msgs);
  assert(!/0712345678|Florilor|Ioana|Marin|0733|444 555|Mihai|0711222333|mihai@x\.ro/.test(sent), 'prompt fără date personale', sent);
  assert(/Tuns/.test(sent) && /Acceptăm copii/.test(sent) && /09:00/.test(sent), 'prompt cu info publice (servicii, FAQ, program)');
  assert(/pot veni cu copilul\?/.test(msgs[1].content), 'întrebarea rămâne');

  // Model lipsă / erori HTTP -> reguli, fără excepție.
  let seenAuth = '';
  let seenBody = '';
  const status404: LlmFetch = async (_u, init) => { seenAuth = init.headers.Authorization; seenBody = init.body; return { ok: false, status: 404, json: async () => ({ error: 'model not found' }) }; };
  const d404 = await classifyWithLlmDetailed({ apiKey: 'k1', model: 'missing', baseUrl: 'https://x/v1/' }, kPriv, 'pot veni cu copilul?', status404);
  assert(d404.verdict === null && d404.status === 'error' && d404.httpStatus === 404, '404 -> error, fără excepție');
  assert(seenAuth === 'Bearer k1', 'header Authorization corect', seenAuth.replace(/k1/, '<key>'));
  assert(!/Ioana|0712345678/.test(seenBody), 'corpul cererii fără date personale');
  const c404 = await runAgentCore({ knowledge: kPriv, message: 'Pot veni cu copilul?', llm: { apiKey: 'k1', model: 'missing', baseUrl: 'https://x/v1' }, fetchImpl: status404 });
  assert(c404.source !== 'llm' && c404.llmStatus === 'error', 'nucleu: 404 -> reguli', JSON.stringify({ s: c404.source, l: c404.llmStatus }));
  const status400: LlmFetch = async () => ({ ok: false, status: 400, json: async () => ({}) });
  assert((await classifyWithLlmDetailed({ apiKey: 'k', model: 'm', baseUrl: 'https://x' }, kPriv, 'x', status400)).status === 'error', '400 -> error');
  const throwing: LlmFetch = async () => { throw new Error('network'); };
  assert((await runAgentCore({ knowledge: kPriv, message: 'Pot veni cu copilul?', llm: { apiKey: 'k', model: 'm', baseUrl: 'https://x' }, fetchImpl: throwing })).llmStatus === 'error', 'rețea căzută -> reguli');
  // Timeout: fetch care respectă AbortSignal.
  const hanging: LlmFetch = (_u, init) => new Promise((_res, rej) => init.signal?.addEventListener('abort', () => rej(new Error('aborted'))));
  const t0 = Date.now();
  const hung = await classifyWithLlmDetailed({ apiKey: 'k', model: 'm', baseUrl: 'https://x', timeoutMs: 50 }, kPriv, 'x', hanging);
  assert(hung.status === 'error' && Date.now() - t0 < 1000, 'timeout -> error');
  const sure = await runAgentCore({ knowledge: kPriv, message: 'Cât costă tunsul?', llm: { apiKey: 'k', model: 'm', baseUrl: 'https://x' }, fetchImpl: throwing });
  assert(sure.llmStatus === 'not_needed' && sure.source === 'rules', 'reguli sigure -> fără LLM');

  // jwtClaims
  const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const tok = `${enc({ alg: 'HS256' })}.${enc({ role: 'anon', ref: 'abc', iss: 'supabase' })}.sig`;
  assert(jwtClaims(tok)?.role === 'anon' && jwtClaims(tok)?.ref === 'abc', 'jwtClaims: role + ref');
  assert(jwtClaims('sb_publishable_xyz') === null && jwtClaims('a.b.c') === null, 'jwtClaims: non-JWT -> null');

  console.log(`aiCore: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main();
