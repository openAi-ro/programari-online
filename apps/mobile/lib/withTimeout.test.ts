/**
 * Run: npx tsx lib/withTimeout.test.ts
 * from apps/mobile
 */
import { withTimeout } from './withTimeout';

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

async function main() {
  assert((await withTimeout(Promise.resolve(42), 1000, 'too_slow')) === 42, 'rezolvă la timp');

  let code = '';
  try {
    await withTimeout(new Promise(() => {}), 50, 'too_slow');
  } catch (e) {
    code = e instanceof Error ? e.message : '';
  }
  assert(code === 'too_slow', 'respinge la timeout', `got ${code}`);

  let kept = '';
  try {
    await withTimeout(Promise.reject(new Error('orig')), 1000, 'too_slow');
  } catch (e) {
    kept = e instanceof Error ? e.message : '';
  }
  assert(kept === 'orig', 'păstrează eroarea originală', `got ${kept}`);

  console.log(`withTimeout: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main();
