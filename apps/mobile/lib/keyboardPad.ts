/** Padding jos pentru footer când tastatura e deschisă. Pur — testabil în node. */
export function computeFooterPaddingBottom(input: {
  /** Padding de bază (safe-area + spațiere). */
  base: number;
  /** Înălțimea tastaturii (0 când e ascunsă). */
  keyboardHeight: number;
  /** Pe iOS ridicarea o face KeyboardAvoidingView (padding), nu adunăm manual. */
  platform: 'ios' | 'android' | 'web';
  keyboardAvoid: boolean;
}): number {
  if (!input.keyboardAvoid) return input.base;
  if (input.platform !== 'android') return input.base;
  return input.base + Math.max(0, input.keyboardHeight);
}
