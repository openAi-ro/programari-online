/**
 * Run: npx tsx lib/assistant.test.ts
 * from apps/mobile
 */
import {
  answerAssistantMessage,
  buildAssistantKnowledge,
  formatWorkingHoursText,
  type AssistantIntent,
} from './assistant';
import { en } from './locales/en';
import { ro } from './locales/ro';

let passed = 0;
let failed = 0;

function assert(cond: boolean, name: string, detail?: string) {
  if (cond) {
    passed += 1;
  } else {
    failed += 1;
    console.error(`FAIL ${name}${detail ? `: ${detail}` : ''}`);
  }
}

const knowledge = buildAssistantKnowledge({
  businessName: 'Salon Frumos',
  address: 'Str. Florilor 10, Cluj',
  phone: '0712345678',
  cancelNoticeText: 'cel puțin 3 ore',
  depositText: '50 lei',
  services: [
    { name: 'Tuns', duration: '30 min', price: '50 lei' },
    { name: 'Barbă', duration: '20 min', price: '30 lei' },
  ],
  staffNames: ['Andrei', 'Maria'],
});

const price = answerAssistantMessage(knowledge, 'Cât costă tunsul?');
assert(price.intent === 'service_price', 'întrebare de preț → service_price', price.intent);
assert(
  price.params?.name === 'Tuns' && price.params?.price === '50 lei',
  'parametrii conțin serviciul și prețul real',
  JSON.stringify(price.params ?? {}),
);
assert(price.confidence >= 0.6, 'încredere suficientă', String(price.confidence));

const hours = answerAssistantMessage(knowledge, 'Când sunteți deschiși?');
assert(hours.intent === 'hours', 'program → hours', hours.intent);

// Programul concret ajunge în răspuns (audit C-74), grupat pe zile cu același interval.
const everyDay = Object.fromEntries(
  ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [
    d,
    { closed: false, start: '08:00', end: '20:00' },
  ])
) as never;
assert(
  formatWorkingHoursText(everyDay, 'ro') === 'zilnic 08:00–20:00',
  'program zilnic identic → „zilnic"',
  formatWorkingHoursText(everyDay, 'ro')
);
assert(
  formatWorkingHoursText(everyDay, 'en') === 'daily 08:00–20:00',
  'same hours all week → "daily"',
  formatWorkingHoursText(everyDay, 'en')
);
const withSundayClosed = {
  ...(everyDay as Record<string, unknown>),
  sun: { closed: true },
} as never;
assert(
  formatWorkingHoursText(withSundayClosed, 'ro') === 'luni–sâmbătă 08:00–20:00; duminică închis',
  'duminică închisă apare explicit',
  formatWorkingHoursText(withSundayClosed, 'ro')
);
const knowledgeHours = buildAssistantKnowledge({
  businessName: 'Salon Frumos',
  address: '',
  phone: '',
  cancelNoticeText: '',
  depositText: '0',
  hoursText: formatWorkingHoursText(everyDay, 'ro'),
  services: [],
  staffNames: [],
});
const hoursAnswer = answerAssistantMessage(knowledgeHours, 'Ce program aveți?');
assert(hoursAnswer.params?.hours === 'zilnic 08:00–20:00', 'orele concrete în parametri');

const where = answerAssistantMessage(knowledge, 'Unde vă găsesc? Parcare aveți?');
assert(where.intent === 'location', 'adresă/parcare → location', where.intent);
assert(where.params?.address === 'Str. Florilor 10, Cluj', 'adresa reală în parametri');

const book = answerAssistantMessage(knowledge, 'Vreau o programare mâine');
assert(book.intent === 'book', 'vreau programare → book', book.intent);
assert(book.actions.some((a) => a.type === 'book'), 'acțiune spre rezervare');

const humans = answerAssistantMessage(knowledge, 'Pot vorbi cu cineva de la salon?');
assert(humans.intent === 'human', 'cere om → human', humans.intent);
assert(humans.actions.some((a) => a.type === 'chat'), 'acțiune spre chat cu firma');

const staff = answerAssistantMessage(knowledge, 'Cine mă poate tunde? Ce specialiști aveți?');
assert(staff.intent === 'staff', 'specialiști → staff', staff.intent);
assert(
  typeof staff.params?.names === 'string' && staff.params.names.includes('Andrei'),
  'numele specialistului real',
  String(staff.params?.names ?? ''),
);

const unknown = answerAssistantMessage(knowledge, 'asdf qwerty zzz');
assert(unknown.intent === 'fallback', 'text aiurea → fallback', unknown.intent);
assert(unknown.confidence === 0, 'încredere zero', String(unknown.confidence));
assert(unknown.actions.some((a) => a.type === 'chat'), 'fallback predă la om');

const cancel = answerAssistantMessage(knowledge, 'Cum anulez programarea?');
assert(cancel.intent === 'cancel_policy', 'anulare → cancel_policy', cancel.intent);
assert(cancel.params?.notice === 'cel puțin 3 ore', 'regula reală în parametri');

const greet = answerAssistantMessage(knowledge, 'Bună ziua!');
assert(greet.intent === 'greeting', 'salut → greeting', greet.intent);
assert(greet.confidence > 0, 'salutul are încredere pozitivă');

for (const [q, intent] of [
  ['Unde sunteți?', 'location'],
  ['Cum pot anula?', 'cancel_policy'],
  ['Cine lucrează la voi?', 'staff'],
] as const) {
  const a = answerAssistantMessage(knowledge, q);
  assert(a.intent === intent, `${q} -> ${intent}`, a.intent);
}

// Fiecare sugestie (chip) din ecranul asistentului, în ambele limbi, trebuie să ajungă la intenția ei.
const CHIP_INTENTS: Record<'as.suggestPrice' | 'as.suggestHours' | 'as.suggestBook', AssistantIntent> = {
  'as.suggestPrice': 'services_list',
  'as.suggestHours': 'hours',
  'as.suggestBook': 'book',
};
for (const [lang, dict] of [['ro', ro], ['en', en]] as const) {
  for (const [key, intent] of Object.entries(CHIP_INTENTS) as [keyof typeof CHIP_INTENTS, AssistantIntent][]) {
    const label = dict[key];
    const a = answerAssistantMessage(knowledge, label);
    assert(a.intent === intent, `chip ${lang} ${key} "${label}" -> ${intent}`, a.intent);
    assert(a.confidence > 0, `chip ${lang} ${key} are încredere > 0`, String(a.confidence));
  }
}

console.log(`assistant: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
