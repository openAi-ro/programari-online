/**
 * Test local pentru logica reminder −30 min (fără Edge Function deployată).
 *
 * Rulează:
 *   node scripts/test-reminder-local.mjs
 *
 * Pentru test pe Supabase live (email real):
 *   1. Deploy send-reminders + set RESEND_API_KEY
 *   2. SQL din scripts/test-reminder-prepare.sql
 *   3. Apelează function din Dashboard sau curl
 */

function messageReminder(businessName, timeLocal, timezone) {
  const text = `Salut! Ai o programare la ${businessName} în 30 de minute (${timeLocal}, ${timezone}).`;
  return { subject: 'Reminder programare — 30 minute', text };
}

function inReminderWindow(startAt, now = new Date()) {
  const start = new Date(startAt).getTime();
  const min = now.getTime() + 25 * 60 * 1000;
  const max = now.getTime() + 35 * 60 * 1000;
  return start >= min && start <= max;
}

function formatTimeLocal(iso, timezone) {
  try {
    return new Intl.DateTimeFormat('ro-RO', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

console.log('\n=== TEST REMINDER −30 MIN (local) ===\n');

const now = new Date();
const cases = [
  { label: 'start peste 30 min (trebuie TRIMIS)', start: new Date(now.getTime() + 30 * 60 * 1000) },
  { label: 'start peste 20 min (PREA DEVREME)', start: new Date(now.getTime() + 20 * 60 * 1000) },
  { label: 'start peste 40 min (PREA TÂRZIU)', start: new Date(now.getTime() + 40 * 60 * 1000) },
  { label: 'start peste 28 min (în fereastră)', start: new Date(now.getTime() + 28 * 60 * 1000) },
];

let pass = 0;
let fail = 0;

for (const c of cases) {
  const shouldSend = inReminderWindow(c.start.toISOString(), now);
  const expected =
    c.label.includes('TRIMIS') || c.label.includes('fereastră') ? true : false;
  const ok = shouldSend === expected;
  if (ok) pass++;
  else fail++;
  console.log(ok ? '  ✓' : '  ✗', c.label);
  console.log('     start_at:', c.start.toISOString());
  console.log('     în fereastra 25–35 min?', shouldSend);
  if (shouldSend) {
    const msg = messageReminder(
      'Salon Demo',
      formatTimeLocal(c.start.toISOString(), 'Europe/Bucharest'),
      'Europe/Bucharest'
    );
    console.log('     EMAIL subject:', msg.subject);
    console.log('     EMAIL body:   ', msg.text);
    console.log('     [EMAIL_STUB] — fără RESEND_API_KEY pe server, mesajul e doar logat');
  }
  console.log('');
}

console.log('=== REZULTAT:', pass, 'passed,', fail, 'failed ===\n');

console.log('Ca să trimiți email REAL pe Supabase:');
console.log('  1. Deploy: supabase functions deploy send-reminders');
console.log('  2. Secrets: RESEND_API_KEY + EMAIL_FROM');
console.log('  3. Rulează scripts/test-reminder-prepare.sql în SQL Editor');
console.log('  4. Invoke function send-reminders (GET/POST)');
console.log('  5. Verifică emailul clientului + reminder_sent=true pe appointment\n');

process.exit(fail > 0 ? 1 : 0);
