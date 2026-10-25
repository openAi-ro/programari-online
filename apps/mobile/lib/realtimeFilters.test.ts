import { businessIdFilter } from './realtimeFilters';

function check(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}
const a = '11111111-1111-1111-1111-111111111111';
const b = '22222222-2222-2222-2222-222222222222';
check(businessIdFilter([]) === null, 'empty');
check(businessIdFilter([a]) === `business_id=eq.${a}`, 'one');
check(businessIdFilter([a, b]) === `business_id=in.(${a},${b})`, 'many');
check(businessIdFilter(['x),y']) === null, 'reject non-uuid');
console.log('realtimeFilters.test: ok');