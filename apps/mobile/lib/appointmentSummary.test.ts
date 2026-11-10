/**
 * Run: npx tsx lib/appointmentSummary.test.ts
 * from apps/mobile
 */
import { serviceSummary } from './appointmentSummary';
import { applyLanguage } from './language';

let failed = 0;
function eq(actual: string, expected: string, name: string) {
  if (actual !== expected) {
    failed += 1;
    console.error(`FAIL ${name}: ${JSON.stringify(actual)} ≠ ${JSON.stringify(expected)}`);
  }
}

applyLanguage('ro');
eq(
  serviceSummary({ service_name: 'Tuns', service_duration_minutes: 30, service_price: '50.00' }),
  'Tuns · 30 min · 50 lei',
  'serviciu, durată și preț din programare'
);
eq(
  serviceSummary({ service_name: 'Tuns + Vopsit', service_duration_minutes: 90, service_price: 200 }),
  'Tuns + Vopsit · 1 h 30 min · 200 lei',
  'mai multe servicii: totalul salvat'
);
eq(serviceSummary({ service_name: 'Tuns', service_duration_minutes: null, service_price: null }), 'Tuns', 'fără durată și preț');
eq(serviceSummary({ service_name: null, service_duration_minutes: null, service_price: null }), '', 'nimic de afișat');

console.log(`appointmentSummary: ${failed === 0 ? 'ok' : `${failed} failed`}`);
if (failed > 0) process.exit(1);
