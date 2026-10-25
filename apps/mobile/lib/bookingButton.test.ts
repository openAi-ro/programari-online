/**
 * Run: npx tsx lib/bookingButton.test.ts
 * from apps/mobile
 */
import { buttonSnippet, embedUrl, iframeSnippet, isEmbedParam } from './bookingButton';

let passed = 0;
let failed = 0;
function assert(cond: boolean, name: string, detail?: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error(`FAIL ${name}${detail ? `: ${detail}` : ''}`);
  }
}

const url = 'https://programari.expo.app/b/abc123';
assert(embedUrl(url, 'ro') === `${url}?embed=1&lang=ro`, 'link iframe: embed + romana');
assert(embedUrl(url, 'en') === `${url}?embed=1&lang=en`, 'link iframe: embed + engleza');
assert(embedUrl(`${url}?x=1`, 'ro') === `${url}?x=1&embed=1&lang=ro`, 'link iframe: pastreaza query existent');
assert(isEmbedParam('1') && isEmbedParam(['1']) && !isEmbedParam(undefined) && !isEmbedParam('0'), 'parametrul embed');

const btn = buttonSnippet(url, 'ro');
assert(btn.startsWith(`<a href="${url}"`) && btn.includes('target="_blank"') && btn.includes('rel="noopener"'), 'buton: link in tab nou', btn);
assert(btn.includes('>Programează-te online</a>'), 'buton: textul in romana');
assert(buttonSnippet(url, 'en').includes('>Book online</a>'), 'buton: textul in engleza');
assert(iframeSnippet(url, 'Ana', 'en').includes('title="Online booking – Ana"') && iframeSnippet(url, 'Ana', 'en').includes('lang=en'), 'iframe: engleza');

const frame = iframeSnippet(url, 'Salon "Ana" & Co', 'ro');
assert(frame.includes(`src="${url}?embed=1&amp;lang=ro"`), 'iframe: & escapat in src', frame);
assert(frame.includes('title="Programare online – Salon &quot;Ana&quot; &amp; Co"'), 'iframe: titlu escapat', frame);
assert(!/<script/i.test(iframeSnippet(url, '<script>x</script>', 'ro')), 'iframe: fara injectare HTML din nume');

console.log(`bookingButton: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
