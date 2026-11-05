import { trKey } from './i18n';

/** Cod de card cadou fără cratime/spații, majuscule (forma stocată în DB). */
export function normalizeGiftCode(code: string): string {
  return (code ?? '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

/** Forma afișată clientului: ABCD-1234-EFGH-5678. */
export function formatGiftCode(code: string): string {
  const raw = normalizeGiftCode(code);
  return raw.replace(/(.{4})(?=.)/g, '$1-');
}

export type GiftCardKind = 'amount' | 'service';
export type GiftCardStatus = 'active' | 'redeemed' | 'cancelled';
export type GiftCardDisplayStatus = GiftCardStatus | 'expired';

export function isValidGiftAmount(amount: number): boolean {
  return Number.isFinite(amount) && amount > 0;
}

export function isValidGiftKind(kind: string): kind is GiftCardKind {
  return kind === 'amount' || kind === 'service';
}

/** expires_at NULL = nu expiră (carduri vechi). */
export function isGiftExpired(expiresAt: string | null | undefined, now: Date = new Date()): boolean {
  if (!expiresAt) return false;
  const t = new Date(expiresAt).getTime();
  if (!Number.isFinite(t)) return false;
  return t <= now.getTime();
}

/** Starea afișată: folosit / anulat / expirat / nefolosit. */
export function giftCardDisplayStatus(card: {
  status: string;
  expires_at?: string | null;
}, now: Date = new Date()): GiftCardDisplayStatus {
  if (card.status === 'redeemed') return 'redeemed';
  if (card.status === 'cancelled') return 'cancelled';
  if (card.status === 'active' && isGiftExpired(card.expires_at, now)) return 'expired';
  return 'active';
}

/** Mapare mesaje RPC cadouri → text tradus (ca mapBookingRpcError). */
export function mapGiftRpcError(message: string): string {
  const raw = (message ?? '').toLowerCase();
  if (raw.includes('gift_amount_invalid')) return trKey('pkg.giftAmount');
  if (raw.includes('gift_service_required') || raw.includes('gift_service_not_found')) {
    return trKey('pkg.giftPickService');
  }
  if (raw.includes('gift_kind_invalid')) return trKey('pkg.giftKind');
  if (raw.includes('gift_expired')) return trKey('pkg.giftExpiredError');
  if (raw.includes('gift_not_unused')) return trKey('pkg.giftNotUnused');
  if (raw.includes('gift_not_found')) return trKey('pkg.giftNotFound');
  if (raw.includes('not_allowed') || raw.includes('not_authenticated')) {
    return trKey('pkg.giftNotAllowed');
  }
  return message;
}
