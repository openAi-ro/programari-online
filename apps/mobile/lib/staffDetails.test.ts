import {
  MAX_SPECIALTY_LENGTH,
  MAX_STAFF_PHONE_LENGTH,
  cleanOptionalText,
  staffPrivateRow,
} from './staffDetails';

function assert(cond: boolean, label: string) {
  if (!cond) throw new Error(`FAIL: ${label}`);
}

function main() {
  assert(cleanOptionalText('', 60) === null, 'gol -> null');
  assert(cleanOptionalText('   ', 60) === null, 'spatii -> null');
  assert(cleanOptionalText(null, 60) === null, 'null -> null');
  assert(cleanOptionalText(undefined, 60) === null, 'undefined -> null');
  assert(cleanOptionalText('  Fade   si  barba ', 60) === 'Fade si barba', 'trim + spatii interioare');
  assert(cleanOptionalText('x'.repeat(80), MAX_SPECIALTY_LENGTH)?.length === 60, 'taiat la 60');

  const row = staffPrivateRow({ staffId: 'a', phone: ' 0722 000 000 ', phonePublic: true });
  assert(row.staff_id === 'a' && row.phone === '0722 000 000' && row.phone_public, 'telefon public');
  const noPhone = staffPrivateRow({ staffId: 'a', phone: '  ', phonePublic: true });
  assert(noPhone.phone === null && noPhone.phone_public === false, 'fara telefon -> nu e public');
  const priv = staffPrivateRow({ staffId: 'a', phone: '0722', phonePublic: false });
  assert(priv.phone === '0722' && priv.phone_public === false, 'telefon privat');
  const long = staffPrivateRow({ staffId: 'a', phone: '0'.repeat(30), phonePublic: false });
  assert(long.phone?.length === MAX_STAFF_PHONE_LENGTH, 'taiat la 20');
  console.log('staffDetails: 10 passed, 0 failed');
}

main();