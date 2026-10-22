import {
  MAX_SPECIALTY_LENGTH,
  MAX_STAFF_PHONE_LENGTH,
  cleanOptionalText,
  isValidStaffEmail,
  normalizeStaffEmail,
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

  const row = staffPrivateRow({ staffId: 'a', phone: ' 0722 000 000 ', phonePublic: true, email: '' });
  assert(row.staff_id === 'a' && row.phone === '0722 000 000' && row.phone_public, 'telefon public');
  const noPhone = staffPrivateRow({ staffId: 'a', phone: '  ', phonePublic: true, email: null });
  assert(noPhone.phone === null && noPhone.phone_public === false, 'fara telefon -> nu e public');
  const priv = staffPrivateRow({ staffId: 'a', phone: '0722', phonePublic: false, email: undefined });
  assert(priv.phone === '0722' && priv.phone_public === false, 'telefon privat');
  const long = staffPrivateRow({ staffId: 'a', phone: '0'.repeat(30), phonePublic: false, email: '' });
  assert(long.phone?.length === MAX_STAFF_PHONE_LENGTH, 'taiat la 20');

  assert(row.email === null && noPhone.email === null && priv.email === null, 'email gol -> null');
  const withEmail = staffPrivateRow({ staffId: 'a', phone: '', phonePublic: false, email: '  Ana.Pop@Gmail.COM ' });
  assert(withEmail.email === 'ana.pop@gmail.com', 'email trim + litere mici');
  assert(normalizeStaffEmail('   ') === null, 'email doar spatii -> null');
  assert(isValidStaffEmail('') && isValidStaffEmail(null) && isValidStaffEmail('  '), 'email gol e valid (optional)');
  assert(isValidStaffEmail(' Ana@Salon.ro '), 'email valid');
  assert(!isValidStaffEmail('ana') && !isValidStaffEmail('ana@salon') && !isValidStaffEmail('ana pop@salon.ro') && !isValidStaffEmail('@salon.ro'), 'email invalid');
  assert(!isValidStaffEmail('a@b.' + 'c'.repeat(260)), 'email prea lung');
  console.log('staffDetails: 17 passed, 0 failed');
}

main();