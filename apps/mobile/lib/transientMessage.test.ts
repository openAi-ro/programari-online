/**
 * Run: npx tsx lib/transientMessage.test.ts
 * from apps/mobile
 */
import {
  SUCCESS_MESSAGE_TIMEOUT_MS,
  scheduleMessageDismiss,
} from './transientMessage';

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

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  assert(
    SUCCESS_MESSAGE_TIMEOUT_MS >= 3000 && SUCCESS_MESSAGE_TIMEOUT_MS <= 6000,
    'durata bannerului de succes e între 3s și 6s',
    String(SUCCESS_MESSAGE_TIMEOUT_MS),
  );

  // Dispare singur după termen.
  let dismissed = 0;
  scheduleMessageDismiss(() => {
    dismissed += 1;
  }, 20);
  assert(dismissed === 0, 'nu dispare înainte de termen');
  await wait(60);
  assert(dismissed === 1, 'dispare singur după termen', String(dismissed));

  // Curățarea (cleanup la unmount / mesaj nou) anulează dispariția programată.
  let cancelled = 0;
  const cancel = scheduleMessageDismiss(() => {
    cancelled += 1;
  }, 20);
  cancel();
  await wait(60);
  assert(cancelled === 0, 'cleanup-ul anulează dispariția', String(cancelled));

  console.log(`transientMessage: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main();
