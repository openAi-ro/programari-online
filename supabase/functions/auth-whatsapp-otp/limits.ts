import type { NotifyLang } from '../_shared/notify.ts';

/** Limitele pentru codurile WhatsApp (verificate atomic în auth_whatsapp_otp_reserve, v78). */
export const OTP_LIMITS = {
  cooldownSeconds: 60,
  phonePerDay: 5,
  ipPerHour: 10,
  ipPerDay: 30,
} as const;

export type OtpLimitError = 'cooldown' | 'phone_daily_limit' | 'ip_hourly_limit' | 'ip_daily_limit';

export type OtpReserveVerdict =
  | { ok: true; id: string }
  | { ok: false; error: OtpLimitError; retryAfterS: number };

const LIMIT_ERRORS: readonly OtpLimitError[] = ['cooldown', 'phone_daily_limit', 'ip_hourly_limit', 'ip_daily_limit'];

/** Răspunsul RPC-ului; orice formă neașteptată = null (apelantul refuză, nu trimite cod). */
export function parseReserveVerdict(data: unknown): OtpReserveVerdict | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (d.ok === true && typeof d.id === 'string' && d.id) return { ok: true, id: d.id };
  if (d.ok === false && LIMIT_ERRORS.includes(d.error as OtpLimitError)) {
    const s = Number(d.retry_after_s);
    return { ok: false, error: d.error as OtpLimitError, retryAfterS: Number.isFinite(s) && s > 0 ? Math.ceil(s) : 60 };
  }
  return null;
}

function waitLabel(seconds: number, lang: NotifyLang): string {
  if (seconds < 120) return lang === 'en' ? `${seconds} seconds` : `${seconds} de secunde`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 120) return lang === 'en' ? `${minutes} minutes` : `${minutes} de minute`;
  const hours = Math.ceil(minutes / 60);
  return lang === 'en' ? `${hours} hours` : `${hours} ore`;
}

/** Mesajul pentru utilizator când o limită e atinsă. */
export function otpLimitHint(error: OtpLimitError, retryAfterS: number, lang: NotifyLang): string {
  const wait = waitLabel(retryAfterS, lang);
  if (error === 'cooldown') {
    return lang === 'en' ? `Wait ${wait} before requesting a new code.` : `Așteaptă ${wait} înainte de a cere un cod nou.`;
  }
  if (error === 'phone_daily_limit') {
    return lang === 'en'
      ? `Too many codes for this number. Try again in ${wait}.`
      : `Prea multe coduri pentru acest număr. Încearcă din nou peste ${wait}.`;
  }
  return lang === 'en'
    ? `Too many code requests from this network. Try again in ${wait}.`
    : `Prea multe cereri de cod din această rețea. Încearcă din nou peste ${wait}.`;
}
