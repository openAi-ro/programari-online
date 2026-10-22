import {
  initialServiceSelection,
  staffForService,
  staffOffersService,
  staffServicesMap,
  staffServicesPlan,
} from './staffServices';

function assert(cond: boolean, label: string) {
  if (!cond) throw new Error(`FAIL: ${label}`);
}
let n = 0;
const ok = (c: boolean, l: string) => {
  assert(c, l);
  n += 1;
};

const map = staffServicesMap([
  { staff_id: 'ana', service_id: 'vopsit' },
  { staff_id: 'ana', service_id: 'coafat' },
  { staff_id: 'miha', service_id: 'tuns' },
]);
ok(map.ana.length === 2 && map.miha[0] === 'tuns' && !map.ionut, 'harta pe specialist');
ok(staffOffersService(map, 'ionut', 'tuns'), 'fara randuri -> face tot');
ok(staffOffersService(map, 'ana', 'vopsit') && !staffOffersService(map, 'ana', 'tuns'), 'cu randuri -> doar bifate');
ok(staffOffersService(map, 'ana', null), 'fara serviciu ales -> da');
const team = [{ id: 'ionut' }, { id: 'ana' }, { id: 'miha' }];
ok(staffForService(team, map, 'tuns').map((m) => m.id).join(',') === 'ionut,miha', 'tuns: ionut, miha (ordinea echipei)');
ok(staffForService(team, map, 'vopsit').map((m) => m.id).join(',') === 'ionut,ana', 'vopsit: ionut, ana');
ok(staffForService(team, map, undefined).length === 3, 'fara serviciu -> toti');
ok(staffServicesMap(null) && Object.keys(staffServicesMap(undefined)).length === 0, 'fara date -> harta goala');

const all = ['tuns', 'vopsit', 'coafat'];
ok(initialServiceSelection([], all).length === 3, 'editor: fara randuri -> toate bifate');
ok(initialServiceSelection(['tuns', 'sters'], all).join(',') === 'tuns', 'editor: ignora servicii sterse');

const p1 = staffServicesPlan(['tuns'], all, []);
ok(!p1.error && p1.insertIds.join(',') === 'tuns' && p1.deleteIds.length === 0, 'restrange la tuns');
const p2 = staffServicesPlan(all, all, ['tuns']);
ok(!p2.error && p2.insertIds.length === 0 && p2.deleteIds.join(',') === 'tuns', 'toate bifate -> sterge randurile (face tot)');
const p3 = staffServicesPlan(['vopsit', 'tuns'], all, ['tuns', 'coafat']);
ok(p3.insertIds.join(',') === 'vopsit' && p3.deleteIds.join(',') === 'coafat', 'diferenta corecta');
ok(staffServicesPlan([], all, []).error === 'none_selected', 'nimic bifat -> eroare');
ok(staffServicesPlan([], [], []).error === null, 'firma fara servicii -> ok, nimic de scris');
ok(staffServicesPlan(['tuns', 'tuns', 'x'], all, []).insertIds.join(',') === 'tuns', 'fara dubluri si id-uri straine');

// Oricine: reuniunea sloturilor doar peste cei care fac serviciul
import { unionStaffSlots } from './anyStaff';
const slot = (iso: string) => ({ startUtc: iso, endUtc: iso, labelLocal: iso.slice(11, 16) });
const perStaff = staffForService(team, map, 'vopsit').map((m) => ({
  staffId: m.id,
  slots: m.id === 'miha' ? [slot('2026-10-22T06:00:00.000Z')] : [slot('2026-10-22T07:00:00.000Z')],
}));
const u = unionStaffSlots(perStaff);
ok(u.slots.length === 1 && u.staffByStart['2026-10-22T07:00:00.000Z'].join(',') === 'ionut,ana', 'oricine: miha (nu face vopsit) exclus din reuniune');
console.log(`staffServices+anyStaff: ${n} passed, 0 failed`);