import * as FileSystem from 'expo-file-system/legacy';

/** Decode base64 → ArrayBuffer (fără dependințe extra). */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  // React Native are atob global (Hermes / Expo).
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export type LocalImageBytes = {
  buffer: ArrayBuffer;
  contentType: 'image/jpeg' | 'image/png';
  ext: 'jpg' | 'png';
};

/**
 * Citește o poză locală (file:// sau content://) pentru upload Supabase.
 * `fetch(uri)` pe Android returnează deseori textul "File not found" (14 bytes) —
 * de aceea copiem în cache și citim cu expo-file-system.
 */
export async function readLocalImageBytes(localUri: string): Promise<LocalImageBytes> {
  const clean = localUri.split('?')[0] ?? localUri;
  const rawExt = clean.split('.').pop()?.toLowerCase();
  const ext: 'jpg' | 'png' = rawExt === 'png' ? 'png' : 'jpg';
  const contentType = ext === 'png' ? 'image/png' : 'image/jpeg';

  const cacheRoot = FileSystem.cacheDirectory;
  if (!cacheRoot) {
    throw new Error('Cache-ul local nu e disponibil pe acest dispozitiv.');
  }

  const dest = `${cacheRoot}upload-${Date.now()}.${ext}`;
  try {
    await FileSystem.copyAsync({ from: localUri, to: dest });
  } catch {
    // Unele URI-uri din ImagePicker deja sunt file:// citibile direct.
    try {
      const base64Direct = await FileSystem.readAsStringAsync(localUri, {
        encoding: 'base64',
      });
      const buffer = base64ToArrayBuffer(base64Direct);
      if (buffer.byteLength < 100) {
        throw new Error('Poza e goală sau inaccesibilă. Alege din nou din galerie.');
      }
      return { buffer, contentType, ext };
    } catch (e) {
      throw new Error(
        e instanceof Error
          ? e.message
          : 'Nu am putut citi poza de pe telefon. Verifică permisiunea la galerie.'
      );
    }
  }

  try {
    const base64 = await FileSystem.readAsStringAsync(dest, {
      encoding: 'base64',
    });
    const buffer = base64ToArrayBuffer(base64);
    if (buffer.byteLength < 100) {
      throw new Error('Poza citită e goală. Încearcă altă imagine sau camera.');
    }
    return { buffer, contentType, ext };
  } finally {
    try {
      await FileSystem.deleteAsync(dest, { idempotent: true });
    } catch {
      /* ignore */
    }
  }
}
