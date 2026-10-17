/**
 * Run: npx tsx lib/staffPortfolio.test.ts
 * from apps/mobile
 */
import {
  MAX_PORTFOLIO_PHOTOS,
  addPortfolioUrl,
  normalizePortfolioUrls,
  removePortfolioUrl,
} from './staffPortfolio';

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

assert(normalizePortfolioUrls(null).length === 0, 'null → listă goală');
assert(normalizePortfolioUrls(undefined).length === 0, 'undefined → listă goală');

const clean = normalizePortfolioUrls([' a.jpg ', '', 'b.jpg', 'a.jpg', '  ']);
assert(
  clean.length === 2 && clean[0] === 'a.jpg' && clean[1] === 'b.jpg',
  'curăță spațiile, golurile și duplicatele',
  clean.join(','),
);

const added = addPortfolioUrl(['a.jpg'], ' b.jpg ');
assert(added.length === 2 && added[1] === 'b.jpg', 'adaugă poză nouă', added.join(','));
assert(addPortfolioUrl(['a.jpg'], 'a.jpg').length === 1, 'nu adaugă duplicat');
assert(addPortfolioUrl(['a.jpg'], '  ').length === 1, 'nu adaugă gol');

const full = Array.from({ length: MAX_PORTFOLIO_PHOTOS }, (_, i) => `p${i}.jpg`);
assert(
  addPortfolioUrl(full, 'noua.jpg').length === MAX_PORTFOLIO_PHOTOS,
  'respectă limita de poze',
);

const removed = removePortfolioUrl(['a.jpg', 'b.jpg'], 'a.jpg');
assert(removed.length === 1 && removed[0] === 'b.jpg', 'șterge poza cerută', removed.join(','));
assert(removePortfolioUrl(['a.jpg'], 'x.jpg').length === 1, 'ștergere inexistentă → neschimbat');

console.log(`staffPortfolio: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
