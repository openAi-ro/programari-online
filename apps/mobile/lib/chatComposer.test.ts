import { COMPOSER_MIN_HEIGHT, composerInputHeight, composerMaxHeight } from './chatComposer';

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean) {
  if (ok) passed++;
  else {
    failed++;
    console.error('FAIL', name);
  }
}

check('one line stays at the button height', composerInputHeight(20, 844) === COMPOSER_MIN_HEIGHT);
check('five lines grow the box', composerInputHeight(5 * 20 + 28, 844) === 128);
check('twelve lines is the cap on a phone', composerMaxHeight(844) === 268);
check('fifteen lines stop at the cap and scroll inside', composerInputHeight(15 * 20 + 28, 844) === 268);
check('short window caps at 40% of the screen', composerMaxHeight(300) === 120);
check('tiny window never goes below the button height', composerMaxHeight(80) === COMPOSER_MIN_HEIGHT);

console.log(`chatComposer: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);