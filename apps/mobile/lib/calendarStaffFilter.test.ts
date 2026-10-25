import { staffOrUnassignedFilter } from './calendarStaffFilter';

function check(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}
const a = '11111111-1111-1111-1111-111111111111';
check(staffOrUnassignedFilter(a) === `staff_id.eq.${a},staff_id.is.null`, 'specialist + fara specialist');
check(staffOrUnassignedFilter('x),staff_id.not.is.null') === null, 'reject non-uuid');
console.log('calendarStaffFilter.test: ok');
