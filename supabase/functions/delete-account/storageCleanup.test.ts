import { assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { accountPublicFolders, type BucketApi, listFilesRecursive, removeFolders, StorageCleanupError } from './storageCleanup.ts';

/** Bucket fals în memorie, cu semantica list() din Supabase Storage (un nivel, foldere cu id null). */
function fakeBucket(files: string[], opts: { failList?: string; failRemove?: boolean } = {}) {
  const store = new Set(files);
  const removed: string[][] = [];
  const api: BucketApi = {
    list(path, { limit, offset }) {
      if (opts.failList === path) return Promise.resolve({ data: null, error: { message: 'boom' } });
      const pre = path ? `${path}/` : '';
      const names = new Map<string, boolean>();
      for (const f of store) {
        if (!f.startsWith(pre)) continue;
        const rest = f.slice(pre.length);
        const [head, ...tail] = rest.split('/');
        names.set(head, names.get(head) || tail.length > 0);
      }
      const entries = [...names.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, isFolder]) => ({ name, id: isFolder ? null : `id-${name}` }));
      return Promise.resolve({ data: entries.slice(offset, offset + limit), error: null });
    },
    remove(paths) {
      if (opts.failRemove) return Promise.resolve({ error: { message: 'nope' } });
      removed.push(paths);
      paths.forEach((p) => store.delete(p));
      return Promise.resolve({ error: null });
    },
  };
  return { api, store, removed };
}

Deno.test('listare cu subfoldere și paginare (>100 fișiere)', async () => {
  const many = Array.from({ length: 250 }, (_, i) => `u1/f${String(i).padStart(3, '0')}.jpg`);
  const b = fakeBucket([...many, 'u1/a/b/deep.png', 'u1/a/x.png', 'u2/other.png']);
  const files = await listFilesRecursive(b.api, 'u1');
  assertEquals(files.length, 252);
  assertEquals(files.includes('u1/a/b/deep.png'), true);
  assertEquals(files.includes('u2/other.png'), false);
});

Deno.test('ștergere în loturi de 100, fără să atingă alte foldere', async () => {
  const many = Array.from({ length: 205 }, (_, i) => `biz/p${i}.jpg`);
  const b = fakeBucket([...many, 'biz/sub/v.mp4', 'altbiz/keep.jpg']);
  const n = await removeFolders(() => b.api, [{ bucket: 'x', prefix: 'biz' }]);
  assertEquals(n, 206);
  assertEquals([...b.store], ['altbiz/keep.jpg']);
  assertEquals(b.removed.map((r) => r.length), [100, 100, 6]);
});

Deno.test('o listare eșuată nu șterge nimic', async () => {
  const ok = fakeBucket(['u1/a.png']);
  const bad = fakeBucket(['biz/a.jpg', 'biz/sub/b.jpg'], { failList: 'biz/sub' });
  await assertRejects(
    () => removeFolders((name) => (name === 'ok' ? ok.api : bad.api), [
      { bucket: 'ok', prefix: 'u1' },
      { bucket: 'bad', prefix: 'biz' },
    ]),
    StorageCleanupError
  );
  assertEquals(ok.store.size, 1);
  assertEquals(bad.store.size, 2);
});

Deno.test('eroarea la ștergere se propagă', async () => {
  const b = fakeBucket(['u1/a.png'], { failRemove: true });
  await assertRejects(() => removeFolders(() => b.api, [{ bucket: 'x', prefix: 'u1' }]), StorageCleanupError);
});

Deno.test('folderele contului: avatar pe user, restul pe fiecare business', () => {
  const t = accountPublicFolders('U', ['B1']);
  assertEquals(t, [
    { bucket: 'profile-avatars', prefix: 'U' },
    { bucket: 'business-logos', prefix: 'B1' },
    { bucket: 'business-media', prefix: 'B1' },
    { bucket: 'business-videos', prefix: 'B1' },
    { bucket: 'staff-photos', prefix: 'B1' },
  ]);
  assertEquals(accountPublicFolders('U', []).length, 1);
});
