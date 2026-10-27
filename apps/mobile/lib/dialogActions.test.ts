/**
 * Run: npx tsx lib/dialogActions.test.ts
 * from apps/mobile
 */
import { dismissAction, planDialog, type DialogAction } from './dialogActions';

let passed = 0;
let failed = 0;
function assert(cond: boolean, name: string) {
  if (cond) passed += 1;
  else { failed += 1; console.error(`FAIL ${name}`); }
}

const gallery: DialogAction = { text: 'Gallery' };
const camera: DialogAction = { text: 'Camera', nativeOnly: true };
const del: DialogAction = { text: 'Delete', style: 'destructive' };
const cancel: DialogAction = { text: 'Cancel', style: 'cancel' };

let p = planDialog([gallery, camera, cancel], false);
assert(p.kind === 'show' && p.actions.length === 3, 'native keeps camera');

p = planDialog([gallery, camera, cancel], true);
assert(p.kind === 'run' && p.action === gallery, 'web: only gallery left -> run it directly');

p = planDialog([gallery, camera, del, cancel], true);
assert(p.kind === 'show' && p.actions.map((a) => a.text).join() === 'Gallery,Delete,Cancel', 'web: gallery + delete shown, camera hidden');

p = planDialog([cancel, { text: 'Delete account', style: 'destructive' }], true);
assert(p.kind === 'show' && p.actions.length === 2, 'web confirm with one choice is still shown (nothing was hidden)');

p = planDialog([camera, cancel], true);
assert(p.kind === 'none', 'web: nothing left -> no dialog');

assert(dismissAction([gallery, cancel]) === cancel, 'dismiss maps to cancel');
assert(dismissAction([gallery]) === undefined, 'no cancel -> dismiss does nothing');

console.log(`dialogActions: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
