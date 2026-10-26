/**
 * Run: npx tsx lib/walkinClientSearch.test.ts
 * from apps/mobile
 */
import { searchWalkinClients, type WalkinClientCandidate } from './walkinClientSearch';

let passed = 0;
let failed = 0;
function assert(cond: boolean, name: string, detail?: string) {
  if (cond) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; console.error(`  FAIL  ${name}${detail ? ` - ${detail}` : ''}`); }
}

console.log('walkinClientSearch tests\n');

const rows: WalkinClientCandidate[] = [
  { clientUserId: '1', displayName: 'Ana Popescu', phone: '+40722123456', email: 'ana@ex.ro', visitCount: 5 },
  { clientUserId: '2', displayName: 'Mihai Ionescu', phone: '+40733111222', email: null, visitCount: 1 },
  { clientUserId: '3', displayName: null, phone: null, email: 'fara.nume@ex.ro', visitCount: 0 },
];

assert(searchWalkinClients(rows, '').length === 0, 'cautare goala = fara sugestii');
assert(searchWalkinClients(rows, '07').length === 0, 'sub 3 caractere = fara sugestii');
{
  const hit = searchWalkinClients(rows, '0722');
  assert(hit.length === 1 && hit[0].clientUserId === '1', 'gaseste dupa prefix telefon local', JSON.stringify(hit));
}
{
  const hit = searchWalkinClients(rows, '+40733');
  assert(hit.length === 1 && hit[0].clientUserId === '2', 'gaseste dupa telefon E.164');
}
{
  const hit = searchWalkinClients(rows, 'popescu');
  assert(hit.length === 1 && hit[0].clientUserId === '1', 'gaseste dupa nume, case-insensitive');
}
{
  const hit = searchWalkinClients(rows, 'fara.nume');
  assert(hit.length === 1 && hit[0].clientUserId === '3', 'gaseste dupa email');
}
assert(searchWalkinClients(rows, 'xyz').length === 0, 'fara potrivire = gol');
{
  const many = Array.from({ length: 20 }, (_, i) => ({
    clientUserId: String(i), displayName: `Client ${i}`, phone: `+407220000${String(i).padStart(2, '0')}`, email: null, visitCount: i,
  }));
  assert(searchWalkinClients(many, '0722').length === 6, 'limiteaza la 6 sugestii');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
