// @ts-nocheck
/** Run: npx tsx lib/salveazaProfil.test.ts — Setări business: „Salvează profilul” fără casetă (doar butonul, lângă bara de jos). */
import { readFileSync } from 'node:fs';
let passed = 0, failed = 0;
const ok = (c: boolean, n: string) => { if (c) passed++; else { failed++; console.error(`FAIL ${n}`); } };
const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const ui = src('components/ui.tsx');
ok(/footerBare = false,/.test(ui), 'Screen: footerBare e opțional, implicit caseta rămâne pe celelalte ecrane');
ok(/footerBare \? styles\.footerBare : styles\.footer/.test(ui), 'Screen: stilul fără casetă');
const bare = ui.match(/footerBare: \{[^}]*\}/)?.[0] ?? '';
ok(bare.length > 0 && !/backgroundColor|borderTop|shadow|elevation/.test(bare), 'footerBare: fără fundal, bordură sau umbră');
ok(/base: footerBare \? spacing\.sm : Math\.max\(insets\.bottom, spacing\.sm\) \+ spacing\.sm/.test(ui), 'footerBare: bara de tab-uri își ia singură zona sigură');
const set = src('app/(app)/settings.tsx');
ok(/footerBare=\{inBusinessTabs\}/.test(set), 'Setări: doar în tab-urile business; clientul rămâne neschimbat');
const tab = src('components/BusinessTabBar.tsx');
ok(/paddingBottom: Math\.max\(insets\.bottom, spacing\.sm\)/.test(tab), 'bara business include zona sigură (butonul nu ajunge sub ea)');
// WhatsApp compact (TypeSafe setari/wa_caseta: B 0.96): comutatorul rămâne, testul e pliat, fără logo mare.
ok(!/<SectionTitle>WhatsApp<\/SectionTitle>/.test(set) && !/styles\.waEmpty|styles\.waLogo/.test(set), 'WhatsApp: fără titlu separat și fără caseta mare „nelegat”');
ok(/update\(\{ notify_whatsapp: next \}\)/.test(set), 'WhatsApp: comutatorul salvează în continuare notify_whatsapp');
ok(/whatsappEnabled && waTestOpen \?/.test(set) && /onPress=\{handleTestWhatsApp\}/.test(set), 'WhatsApp: testul există, dar doar la cerere');
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
