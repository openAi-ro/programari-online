/** Ștergerea fișierelor unui cont din Storage (paginat, cu subfoldere), înainte de ștergerea contului. */

type StorageError = { message: string } | null;
type StorageEntry = { name: string; id: string | null };

/** Partea din API-ul supabase-js Storage (un bucket) de care avem nevoie. */
export interface BucketApi {
  list(
    path: string,
    options: { limit: number; offset: number; sortBy: { column: string; order: string } }
  ): Promise<{ data: StorageEntry[] | null; error: StorageError }>;
  remove(paths: string[]): Promise<{ data?: unknown; error: StorageError }>;
}

export type FolderTarget = { bucket: string; prefix: string };

/** Bucket-uri publice: avatarul e sub <userId>/, restul sub <businessId>/. */
export const BUSINESS_PUBLIC_BUCKETS = ['business-logos', 'business-media', 'business-videos', 'staff-photos'] as const;

export function accountPublicFolders(userId: string, businessIds: string[]): FolderTarget[] {
  return [
    { bucket: 'profile-avatars', prefix: userId },
    ...businessIds.flatMap((id) => BUSINESS_PUBLIC_BUCKETS.map((bucket) => ({ bucket, prefix: id }))),
  ];
}

export class StorageCleanupError extends Error {}

const PAGE = 100;

/** Toate fișierele de sub prefix, inclusiv din subfoldere (în listare, folderele au id null). */
export async function listFilesRecursive(api: BucketApi, prefix: string): Promise<string[]> {
  const files: string[] = [];
  const folders = [prefix.replace(/\/+$/, '')];
  while (folders.length) {
    const folder = folders.pop()!;
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await api.list(folder, {
        limit: PAGE,
        offset,
        sortBy: { column: 'name', order: 'asc' },
      });
      if (error) throw new StorageCleanupError(`list ${folder}: ${error.message}`);
      const page = data ?? [];
      for (const entry of page) {
        const path = folder ? `${folder}/${entry.name}` : entry.name;
        if (entry.id === null) folders.push(path);
        else files.push(path);
      }
      if (page.length < PAGE) break;
    }
  }
  return files;
}

/** Șterge căile în loturi de câte 100; orice eroare oprește tot. */
export async function removePaths(api: BucketApi, paths: string[]): Promise<number> {
  for (let i = 0; i < paths.length; i += PAGE) {
    const { error } = await api.remove(paths.slice(i, i + PAGE));
    if (error) throw new StorageCleanupError(`remove: ${error.message}`);
  }
  return paths.length;
}

/**
 * Listează întâi toate folderele (dacă o listare eșuează nu se șterge nimic), apoi le șterge.
 * Aruncă StorageCleanupError la prima eroare, ca apelantul să nu șteargă contul.
 */
export async function removeFolders(
  bucketApi: (bucket: string) => BucketApi,
  targets: FolderTarget[]
): Promise<number> {
  const plan: { bucket: string; paths: string[] }[] = [];
  for (const t of targets) {
    if (!t.prefix) continue;
    plan.push({ bucket: t.bucket, paths: await listFilesRecursive(bucketApi(t.bucket), t.prefix) });
  }
  let removed = 0;
  for (const p of plan) removed += await removePaths(bucketApi(p.bucket), p.paths);
  return removed;
}
