import { needsMovedAck } from './moveAck';

function assert(cond: boolean, label: string) {
  if (!cond) throw new Error(`FAIL: ${label}`);
}

async function main() {
  let n = 0;
  const ok = (c: boolean, l: string) => {
    assert(c, l);
    n += 1;
  };

  ok(needsMovedAck({ moved_by_business_at: '2026-11-02T10:00:00Z', moved_seen_at: null }), 'mutata nevazuta -> banner');
  ok(!needsMovedAck({ moved_by_business_at: '2026-11-02T10:00:00Z', moved_seen_at: '2026-11-02T11:00:00Z' }), 'vazuta -> fara banner');
  ok(!needsMovedAck({ moved_by_business_at: null, moved_seen_at: null }), 'nemutata -> fara banner');
  ok(!needsMovedAck({}), 'fara coloane (rand vechi) -> fara banner');
  ok(!needsMovedAck({ moved_by_business_at: '', moved_seen_at: null }), 'marcaj gol -> fara banner');

  console.log(`moveAck: ${n} passed, 0 failed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
