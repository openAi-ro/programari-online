// @ts-nocheck — test rulat cu tsx (node); repo-ul n-are @types/node.
/**
 * Run: npx tsx lib/signOutScope.test.ts
 * from apps/mobile
 *
 * `supabase.auth.signOut()` fără argument închide sesiunile contului pe TOATE dispozitivele.
 * Celelalte dispozitive păstrează tokenul încă până la 1 h: salvările în DB merg, dar funcțiile
 * care anunță clientul răspund 401, deci emailurile nu pleacă (test încrucișat 10.11.2026).
 * Logout-ul din aplicație trebuie să fie doar pe dispozitivul curent.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const roots = ['app', 'lib', 'components'];
const offenders: string[] = [];
let calls = 0;

function walk(dir: string) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      walk(path);
    } else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('.test.ts')) {
      const src = readFileSync(path, 'utf8');
      for (const m of src.matchAll(/auth\.signOut\(([^)]*)\)/g)) {
        calls += 1;
        if (!/scope:\s*'local'/.test(m[1] ?? '')) offenders.push(`${path}: ${m[0]}`);
      }
    }
  }
}

for (const root of roots) walk(root);

if (calls === 0) {
  console.error('FAIL niciun apel signOut găsit (testul nu mai vede codul)');
  process.exit(1);
}
if (offenders.length > 0) {
  console.error(`FAIL signOut fără scope local:\n${offenders.join('\n')}`);
  process.exit(1);
}
console.log(`signOutScope: ok (${calls} apeluri, toate locale)`);
