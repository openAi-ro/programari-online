import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';

import { trKey } from './i18n';
import { fitWithin, IMAGE_QUALITY, imageTypeOf, imageTypeOfUri, keepEncoded, type UploadImageType } from './imageSizing';

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
  contentType: UploadImageType;
  ext: 'webp' | 'jpg' | 'png';
};

/**
 * Citește o poză locală pentru upload, micșorată la `maxSide` px pe latura lungă.
 * Web: redimensionare pe canvas și encodare WebP 80% (JPEG 80% unde browserul nu știe WebP, ex. Safari).
 * Telefon: aplicația instalată nu are un modul nativ de redimensionare, deci urcăm fișierul dat de
 * expo-image-picker (deja comprimat JPEG prin `quality`); `fetch(uri)` pe Android returnează deseori
 * textul "File not found" (14 bytes), de aceea copiem în cache și citim cu expo-file-system.
 */
export async function readLocalImageBytes(localUri: string, maxSide: number): Promise<LocalImageBytes> {
  if (Platform.OS === 'web') return readWebImage(localUri, maxSide);
  const { contentType, ext } = imageTypeOfUri(localUri);

  const cacheRoot = FileSystem.cacheDirectory;
  if (!cacheRoot) {
    throw new Error(trKey('media.cacheUnavailable'));
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
        throw new Error(trKey('media.imageEmpty'));
      }
      return { buffer, contentType, ext };
    } catch (e) {
      throw new Error(
        e instanceof Error
          ? e.message
          : trKey('media.imageUnreadable')
      );
    }
  }

  try {
    const base64 = await FileSystem.readAsStringAsync(dest, {
      encoding: 'base64',
    });
    const buffer = base64ToArrayBuffer(base64);
    if (buffer.byteLength < 100) {
      throw new Error(trKey('media.imageEmptyRead'));
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

/** Pe web ImagePicker dă un URI blob:/data:; micșorăm pe canvas și encodăm WebP. */
async function readWebImage(localUri: string, maxSide: number): Promise<LocalImageBytes> {
  const source = await (await fetch(localUri)).blob();
  if (source.size < 100) throw new Error(trKey('media.imageEmpty'));
  const original = async (): Promise<LocalImageBytes> => ({ buffer: await source.arrayBuffer(), ...imageTypeOf(source.type) });
  if (typeof document === 'undefined' || typeof URL === 'undefined') return original();

  const objectUrl = URL.createObjectURL(source);
  try {
    const img = await loadImage(objectUrl);
    const size = fitWithin(img.naturalWidth, img.naturalHeight, maxSide);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return original();
    ctx.drawImage(img, 0, 0, size.width, size.height);
    // Browserele fără encoder WebP (Safari) întorc PNG: atunci folosim JPEG.
    let blob = await canvasBlob(canvas, 'image/webp');
    if (!blob || blob.type !== 'image/webp') blob = await canvasBlob(canvas, 'image/jpeg');
    if (!blob || !keepEncoded({ scaled: size.scaled, encodedBytes: blob.size, sourceBytes: source.size })) {
      return original();
    }
    return { buffer: await blob.arrayBuffer(), ...imageTypeOf(blob.type) };
  } catch {
    return original();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function canvasBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, IMAGE_QUALITY));
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image_load_failed'));
    img.src = src;
  });
}
