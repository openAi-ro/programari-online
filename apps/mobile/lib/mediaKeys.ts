/** Pure helpers for media storage keys and chat attachment rules (testable in node). */

export type PublicMediaBucket =
  | 'profile-avatars'
  | 'business-logos'
  | 'business-media'
  | 'business-videos'
  | 'staff-photos';

/**
 * Key inside the bucket (`<folder>/<file>`) for a stored public URL, or null when the
 * URL is not ours. Works for Worker URLs (`.../m/<bucket>/...`) and the older
 * Supabase storage URLs (`.../object/public/<bucket>/...`).
 */
export function mediaKeyFromUrl(bucket: PublicMediaBucket, publicUrl: string): string | null {
  const marker = `/${bucket}/`;
  const idx = publicUrl.indexOf(marker);
  if (idx < 0) return null;
  const raw = publicUrl.slice(idx + marker.length).split('?')[0];
  if (!raw) return null;
  let key: string;
  try {
    key = decodeURIComponent(raw);
  } catch {
    key = raw;
  }
  return /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(key) && !key.includes('..')
    ? key
    : null;
}

export type ChatAttachmentKind = 'image' | 'video';

/** One-line preview of a chat message: its text, or a label for a bare photo/video. */
export function chatMessagePreview(
  message: { body: string; attachment_kind?: ChatAttachmentKind | null },
  labels: { image: string; video: string }
): string {
  const text = message.body.replace(/\s+/g, ' ').trim();
  if (!message.attachment_kind) return text;
  const label = message.attachment_kind === 'video' ? labels.video : labels.image;
  return text ? `${label} · ${text}` : label;
}

export const CHAT_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const CHAT_VIDEO_MAX_BYTES = 50 * 1024 * 1024;
export const CHAT_VIDEO_MAX_SECONDS = 30;

const CHAT_MIME: Record<string, { kind: ChatAttachmentKind; ext: string }> = {
  'image/jpeg': { kind: 'image', ext: 'jpg' },
  'image/png': { kind: 'image', ext: 'png' },
  'image/webp': { kind: 'image', ext: 'webp' },
  'video/mp4': { kind: 'video', ext: 'mp4' },
  'video/quicktime': { kind: 'video', ext: 'mov' },
  'video/webm': { kind: 'video', ext: 'webm' },
};

/**
 * Normalises what the picker reported into an upload plan, or an error code.
 * Duration is in milliseconds (see pickerDurationToMs).
 */
export function planChatAttachment(input: {
  pickerType: 'image' | 'video' | 'livePhoto' | 'pairedVideo' | string | null | undefined;
  mimeType: string | null | undefined;
  sizeBytes: number | null | undefined;
  durationMs: number | null | undefined;
}):
  | { ok: true; kind: ChatAttachmentKind; mime: string; ext: string }
  | { ok: false; error: 'type' | 'too_big' | 'too_long' } {
  const kindHint: ChatAttachmentKind = input.pickerType === 'video' ? 'video' : 'image';
  let mime = (input.mimeType ?? '').toLowerCase().trim();
  if (!mime) mime = kindHint === 'video' ? 'video/mp4' : 'image/jpeg';
  if (mime === 'video/m4v' || mime === 'video/x-m4v') mime = 'video/mp4';
  if (mime === 'image/jpg') mime = 'image/jpeg';
  const known = CHAT_MIME[mime];
  if (!known) return { ok: false, error: 'type' };
  const max = known.kind === 'video' ? CHAT_VIDEO_MAX_BYTES : CHAT_IMAGE_MAX_BYTES;
  if (input.sizeBytes != null && input.sizeBytes > max) return { ok: false, error: 'too_big' };
  if (
    known.kind === 'video' &&
    input.durationMs != null &&
    input.durationMs > (CHAT_VIDEO_MAX_SECONDS + 0.5) * 1000
  ) {
    return { ok: false, error: 'too_long' };
  }
  return { ok: true, kind: known.kind, mime, ext: known.ext };
}
