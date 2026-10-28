/**
 * Shared client notification channels: email (Brevo) + WhatsApp (Twilio / Meta Cloud).
 * When env keys are missing, stubs log to console and return ok:false + stub:true
 * (nothing was delivered — callers must not treat a stub as sent).
 *
 * WhatsApp business-initiated messages: when a Meta template name is configured for the
 * message type (WHATSAPP_TPL_<KEY>), an approved template is sent with body variables in a
 * fixed order (see WA_TEMPLATE_VARS). Otherwise free-form text is sent (only delivered by
 * Meta inside the 24h customer-service window).
 */
import { normalizePhoneE164, phoneForMetaApi } from './phone.ts';

/** Max wait for Brevo / Meta / Twilio before the send is recorded as failed. */
const PROVIDER_TIMEOUT_MS = 15_000;

/** Recipient language for notification copy. Functions accept `lang` in the body (default 'ro'). */
export type NotifyLang = 'ro' | 'en';

export function parseNotifyLang(v: unknown): NotifyLang {
  return v === 'en' ? 'en' : 'ro';
}

/** Intl locale tag for date/time labels inside notifications. */
export function notifyLocale(lang: NotifyLang): string {
  return lang === 'en' ? 'en-GB' : 'ro-RO';
}

/** Final delivery state we know at send time (webhook may later move it to sent/delivered/read/failed). */
export type SendOutcome = 'accepted' | 'stub' | 'failed' | 'invalid_phone';

export type SendResult = {
  ok: boolean;
  stub?: boolean;
  status?: number;
  channel: 'email' | 'whatsapp';
  error?: string;
  provider?: 'twilio' | 'meta' | 'stub';
  outcome?: SendOutcome;
  /** Meta message id (wamid...) or Twilio SID when accepted. */
  messageId?: string;
  /** Template name used (Meta), when a template was sent. */
  template?: string;
  errorCode?: string;
  errorMessage?: string;
};

/** Message types that can use an approved Meta template (env WHATSAPP_TPL_<KEY>). */
export type WaTemplateKey =
  | 'CONFIRMED'
  | 'REJECTED'
  | 'MOVED'
  | 'REMINDER_24H'
  | 'REMINDER_SOON'
  | 'REMINDER_1H'
  | 'REBOOK'
  | 'WAITLIST'
  | 'OWNER_PENDING'
  | 'TEST';

/**
 * Fixed body-variable order per template ({{1}}, {{2}}, ...). Must match
 * docs/whatsapp-templates.md and the templates approved in Meta.
 */
export const WA_TEMPLATE_VARS: Record<WaTemplateKey, string[]> = {
  CONFIRMED: ['business_name', 'date_time'],
  REJECTED: ['business_name', 'date_time'],
  MOVED: ['business_name', 'new_date_time'],
  REMINDER_24H: ['business_name', 'time'],
  REMINDER_SOON: ['business_name', 'time'],
  REMINDER_1H: ['business_name', 'time'],
  REBOOK: ['business_name', 'service_name'],
  WAITLIST: ['business_name', 'date', 'booking_link'],
  OWNER_PENDING: ['business_name', 'client_contact', 'date_time'],
  TEST: ['app_name'],
};

export type WaTemplateRef = { key: WaTemplateKey; vars: string[] };

/** Template name configured for a key, or null (=> free-form text). */
export function waTemplateName(key: WaTemplateKey): string | null {
  const v = Deno.env.get(`WHATSAPP_TPL_${key}`)?.trim();
  return v ? v : null;
}

/** Meta rejects template params containing newlines/tabs or 4+ consecutive spaces. */
export function sanitizeTemplateParam(v: string): string {
  const t = `${v ?? ''}`.replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim();
  return (t || '-').slice(0, 1000);
}

/** +40712345900 -> +407***900 ; email -> da***@domain */
export function maskRecipient(v: string | null | undefined): string | null {
  if (!v) return null;
  if (v.includes('@')) {
    const [user, dom] = v.split('@');
    return `${user.slice(0, 2)}***@${dom}`;
  }
  const d = normalizePhoneE164(v) ?? v.replace(/[^\d+]/g, '');
  if (d.length <= 6) return '***';
  return `${d.slice(0, 4)}***${d.slice(-3)}`;
}

/** Parse a Meta Graph error body into code + message (safe to store/show). */
export function parseMetaError(body: string): { code?: string; message?: string } {
  try {
    const j = JSON.parse(body) as {
      error?: { code?: number | string; message?: string; error_data?: { details?: string } };
    };
    if (j?.error) {
      const details = j.error.error_data?.details;
      return {
        code: j.error.code != null ? String(j.error.code) : undefined,
        message: [j.error.message, details].filter(Boolean).join(' — ') || undefined,
      };
    }
  } catch {
    /* not json */
  }
  return { message: body ? body.slice(0, 500) : undefined };
}

export async function sendEmail(
  to: string,
  subject: string,
  text: string
): Promise<SendResult> {
  const key = Deno.env.get('BREVO_API_KEY');
  if (!key) {
    console.log('EMAIL_STUB', { to: maskRecipient(to), subject });
    return { ok: false, stub: true, channel: 'email', provider: 'stub', outcome: 'stub', error: 'email_not_configured' };
  }

  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      headers: {
        'api-key': key,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        sender: { name: 'Programari', email: Deno.env.get('EMAIL_FROM') ?? 'programari@promixt.ro' },
        to: [{ email: to }],
        subject,
        textContent: text,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error('Brevo error', res.status, body);
      return { ok: false, status: res.status, channel: 'email', error: body, outcome: 'failed', errorCode: String(res.status), errorMessage: body.slice(0, 500) };
    }
    const j = (await res.json().catch(() => null)) as { messageId?: string } | null;
    return { ok: true, status: res.status, channel: 'email', outcome: 'accepted', messageId: j?.messageId };
  } catch (e) {
    console.error('sendEmail exception', e);
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, channel: 'email', error: msg, outcome: 'failed', errorMessage: msg };
  }
}

export type SendWhatsAppOpts = {
  /** Prefer an approved template (required for OTP / first contact outside 24h). */
  otpCode?: string;
  /** Business-initiated notification: use WHATSAPP_TPL_<key> when configured. */
  template?: WaTemplateRef;
};

/** User hint from Meta/Twilio error payload — safe to show in the app. */
export function whatsappUserHint(result: SendResult, lang: NotifyLang = 'ro'): string {
  const e = `${result.error ?? ''}`.toLowerCase();
  const en = lang === 'en';
  if (e.includes('invalid_phone')) {
    return en
      ? 'Use a valid number (07xxxxxxxx or +40...).'
      : 'Folosește un număr valid (07xxxxxxxx sau +40...).';
  }
  if (e.includes('63015')) {
    return en
      ? 'The number is not enrolled in the Twilio sandbox. Open WhatsApp, text “join …” to the Twilio number, then retry.'
      : 'Numărul nu e înscris în sandbox-ul Twilio. Deschide WhatsApp, scrie „join …” către numărul Twilio, apoi reîncearcă.';
  }
  if (
    e.includes('63016') ||
    e.includes('131047') ||
    e.includes('re-engagement') ||
    e.includes('outside the allowed window')
  ) {
    return en
      ? 'WhatsApp blocks free-form messages. Add an approved OTP template: WHATSAPP_OTP_TEMPLATE (Meta) or TWILIO_WHATSAPP_CONTENT_SID (Twilio).'
      : 'WhatsApp blochează mesajele libere. Adaugă un șablon OTP aprobat: WHATSAPP_OTP_TEMPLATE (Meta) sau TWILIO_WHATSAPP_CONTENT_SID (Twilio).';
  }
  if (e.includes('whatsapp_not_configured')) {
    return en
      ? 'WhatsApp is not configured on the server (WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID missing). Nothing was sent.'
      : 'WhatsApp nu e configurat pe server (lipsesc WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID). Nu s-a trimis nimic.';
  }
  if (e.includes('131030') || e.includes('not in allowed list')) {
    return en
      ? 'Meta test number: this recipient is not in the allowed list. Add it in Meta > WhatsApp > API Setup > To (Manage phone number list).'
      : 'Număr de test Meta: destinatarul nu e în lista permisă. Adaugă-l în Meta > WhatsApp > API Setup > To (Manage phone number list).';
  }
  if (result.errorCode === '100' || e.includes('"code":100') || e.includes('unsupported post request') || e.includes('does not exist, cannot be loaded')) {
    return en
      ? 'Meta rejected the request: WHATSAPP_PHONE_NUMBER_ID is wrong (use the Phone number ID from API Setup, not the WABA ID) or the token has no access to it.'
      : 'Meta a respins cererea: WHATSAPP_PHONE_NUMBER_ID e greșit (folosește Phone number ID din API Setup, nu WABA ID) sau token-ul nu are acces la el.';
  }
  if (e.includes('133010') || e.includes('not a whatsapp user')) {
    return en ? 'This number has no active WhatsApp.' : 'Acest număr nu are WhatsApp activ.';
  }
  if (
    e.includes('131037') ||
    e.includes('display name approval') ||
    e.includes('needs display name')
  ) {
    return en
      ? 'Could not send the code: WhatsApp requires display-name approval for the business number. Approve it in WhatsApp Manager (Meta Business), then retry.'
      : 'Nu am putut trimite codul: WhatsApp cere aprobarea numelui afișat al numărului de business. Approbă-l în WhatsApp Manager (Meta Business), apoi reîncearcă.';
  }
  if (
    result.errorCode === '190' ||
    e.includes('"code":190') ||
    e.includes('errorcod":190') ||
    (e.includes('oauth') && e.includes('expired')) ||
    e.includes('session has expired')
  ) {
    return en
      ? 'The WhatsApp token expired. Refresh WHATSAPP_ACCESS_TOKEN in the Supabase secrets.'
      : 'Token-ul WhatsApp a expirat. Reînnoiește WHATSAPP_ACCESS_TOKEN în secrets Supabase.';
  }
  if (e.includes('132000') || e.includes('number of parameters')) {
    return en
      ? 'The WhatsApp template variables do not match the approved template (count/order). See docs/whatsapp-templates.md.'
      : 'Variabilele nu se potrivesc cu șablonul aprobat (număr/ordine). Vezi docs/whatsapp-templates.md.';
  }
  if (e.includes('132001') || e.includes('template name does not exist')) {
    return en
      ? 'The WhatsApp template does not exist or is not approved. Check WHATSAPP_OTP_TEMPLATE / WHATSAPP_TPL_* and the language.'
      : 'Șablonul WhatsApp nu există sau nu e aprobat. Verifică WHATSAPP_OTP_TEMPLATE / WHATSAPP_TPL_* și limba.';
  }
  if (e.includes('21608') || e.includes('unverified')) {
    return en
      ? 'The Twilio WhatsApp number is not verified / approved for this recipient.'
      : 'Numărul Twilio WhatsApp nu e verificat / aprobat pentru acest destinatar.';
  }
  return en
    ? 'Could not send the WhatsApp message. Check the Meta/Twilio secrets and try again.'
    : 'Nu am putut trimite mesajul WhatsApp. Verifică secrets Meta/Twilio și încearcă din nou.';
}

async function postMetaMessage(
  phoneNumberId: string,
  token: string,
  payload: Record<string, unknown>
): Promise<SendResult> {
  const res = await fetch(
    `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
    {
      method: 'POST',
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    }
  );
  const template = (payload.template as { name?: string } | undefined)?.name;
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    console.error('Meta WhatsApp error', res.status, errBody);
    const pe = parseMetaError(errBody);
    return {
      ok: false,
      status: res.status,
      channel: 'whatsapp',
      provider: 'meta',
      error: errBody,
      outcome: 'failed',
      errorCode: pe.code,
      errorMessage: pe.message,
      template,
    };
  }
  const j = (await res.json().catch(() => null)) as { messages?: { id?: string }[] } | null;
  return {
    ok: true,
    status: res.status,
    channel: 'whatsapp',
    provider: 'meta',
    outcome: 'accepted',
    messageId: j?.messages?.[0]?.id,
    template,
  };
}

function stubResult(provider: string, toE164: string): SendResult {
  console.log('WHATSAPP_STUB', { to: maskRecipient(toE164), provider });
  return {
    ok: false,
    stub: true,
    channel: 'whatsapp',
    provider: 'stub',
    outcome: 'stub',
    error: 'whatsapp_not_configured',
  };
}

async function sendWhatsAppMeta(
  toE164: string,
  text: string,
  opts?: SendWhatsAppOpts
): Promise<SendResult> {
  const token = Deno.env.get('WHATSAPP_ACCESS_TOKEN');
  const phoneNumberId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID');
  if (!token || !phoneNumberId) {
    return stubResult('meta', toE164);
  }

  const to = phoneForMetaApi(toE164);
  const templateName = Deno.env.get('WHATSAPP_OTP_TEMPLATE')?.trim();

  try {
    if (opts?.otpCode && templateName) {
      const lang = Deno.env.get('WHATSAPP_OTP_TEMPLATE_LANG')?.trim() || 'ro';
      const buttonType = (
        Deno.env.get('WHATSAPP_OTP_BUTTON_TYPE') ?? ''
      ).toLowerCase();
      const components: Record<string, unknown>[] = [
        {
          type: 'body',
          parameters: [{ type: 'text', text: opts.otpCode }],
        },
      ];
      if (buttonType === 'url' || buttonType === 'otp') {
        components.push({
          type: 'button',
          sub_type: buttonType,
          index: '0',
          parameters: [
            buttonType === 'otp'
              ? { type: 'otp', text: opts.otpCode }
              : { type: 'text', text: opts.otpCode },
          ],
        });
      }
      return await postMetaMessage(phoneNumberId, token, {
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: templateName,
          language: { code: lang },
          components,
        },
      });
    }

    const tplName = opts?.template ? waTemplateName(opts.template.key) : null;
    if (opts?.template && tplName) {
      const lang = Deno.env.get('WHATSAPP_TPL_LANG')?.trim() || 'ro';
      return await postMetaMessage(phoneNumberId, token, {
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: tplName,
          language: { code: lang },
          components: [
            {
              type: 'body',
              parameters: opts.template.vars.map((v) => ({
                type: 'text',
                text: sanitizeTemplateParam(v),
              })),
            },
          ],
        },
      });
    }

    return await postMetaMessage(phoneNumberId, token, {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: text },
    });
  } catch (e) {
    console.error('sendWhatsAppMeta exception', e);
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      channel: 'whatsapp',
      provider: 'meta',
      error: msg,
      outcome: 'failed',
      errorMessage: msg,
    };
  }
}

async function sendWhatsAppTwilio(
  toE164: string,
  text: string,
  opts?: SendWhatsAppOpts
): Promise<SendResult> {
  const sid = Deno.env.get('TWILIO_ACCOUNT_SID');
  const authToken = Deno.env.get('TWILIO_AUTH_TOKEN');
  const apiKeySid = Deno.env.get('TWILIO_API_KEY_SID');
  const apiKeySecret = Deno.env.get('TWILIO_API_KEY_SECRET');
  const from = Deno.env.get('TWILIO_WHATSAPP_FROM');

  const authUser =
    apiKeySid?.startsWith('SK') && apiKeySecret ? apiKeySid : sid;
  const authPass =
    apiKeySid?.startsWith('SK') && apiKeySecret ? apiKeySecret : authToken;

  if (!sid || !authPass || !from) {
    return stubResult('twilio', toE164);
  }

  try {
    const phone = toE164.startsWith('whatsapp:')
      ? toE164
      : `whatsapp:${toE164}`;
    const body = new URLSearchParams({
      From: from,
      To: phone,
    });
    const contentSid = Deno.env.get('TWILIO_WHATSAPP_CONTENT_SID')?.trim();
    if (opts?.otpCode && contentSid) {
      body.set('ContentSid', contentSid);
      body.set('ContentVariables', JSON.stringify({ '1': opts.otpCode }));
    } else {
      body.set('Body', text);
    }
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method: 'POST',
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
        headers: {
          Authorization: 'Basic ' + btoa(`${authUser}:${authPass}`),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      }
    );
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      console.error('Twilio error', res.status, errBody);
      let code: string | undefined;
      try {
        code = String((JSON.parse(errBody) as { code?: number }).code ?? '') || undefined;
      } catch {
        /* ignore */
      }
      return {
        ok: false,
        status: res.status,
        channel: 'whatsapp',
        provider: 'twilio',
        error: errBody,
        outcome: 'failed',
        errorCode: code,
        errorMessage: errBody.slice(0, 500),
      };
    }
    const tj = (await res.json().catch(() => null)) as { sid?: string } | null;
    return { ok: true, status: res.status, channel: 'whatsapp', provider: 'twilio', outcome: 'accepted', messageId: tj?.sid };
  } catch (e) {
    console.error('sendWhatsAppTwilio exception', e);
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, channel: 'whatsapp', provider: 'twilio', error: msg, outcome: 'failed', errorMessage: msg };
  }
}

export async function sendWhatsApp(
  toRaw: string,
  text: string,
  opts?: SendWhatsAppOpts
): Promise<SendResult> {
  const toE164 = normalizePhoneE164(toRaw);
  if (!toE164) {
    console.error('sendWhatsApp invalid phone', maskRecipient(toRaw));
    return {
      ok: false,
      channel: 'whatsapp',
      error: 'invalid_phone',
      outcome: 'invalid_phone',
      errorCode: 'invalid_phone',
    };
  }

  const provider = (Deno.env.get('WHATSAPP_PROVIDER') ?? 'auto').toLowerCase();

  if (provider === 'meta') {
    return sendWhatsAppMeta(toE164, text, opts);
  }
  if (provider === 'twilio') {
    return sendWhatsAppTwilio(toE164, text, opts);
  }

  const hasMeta =
    !!Deno.env.get('WHATSAPP_ACCESS_TOKEN') &&
    !!Deno.env.get('WHATSAPP_PHONE_NUMBER_ID');
  const hasTwilio =
    !!Deno.env.get('TWILIO_ACCOUNT_SID') &&
    !!Deno.env.get('TWILIO_WHATSAPP_FROM') &&
    (!!Deno.env.get('TWILIO_AUTH_TOKEN') ||
      (!!Deno.env.get('TWILIO_API_KEY_SID') &&
        !!Deno.env.get('TWILIO_API_KEY_SECRET')));

  if (hasMeta) return sendWhatsAppMeta(toE164, text, opts);
  if (hasTwilio) return sendWhatsAppTwilio(toE164, text, opts);

  return stubResult('none', toE164);
}

// deno-lint-ignore no-explicit-any
type AnyClient = { from: (table: string) => any };

export type NotifyLogCtx = {
  /** Service-role client (notification_log is written by service role only). */
  admin: AnyClient;
  type: string;
  businessId?: string | null;
  appointmentId?: string | null;
};

/** notification_log columns for a send result (shared by logNotification and send-reminders). */
export function notificationLogResult(to: string | null, r: SendResult) {
  return {
    to_masked: maskRecipient(to),
    template: r.template ?? null,
    wamid: r.channel === 'whatsapp' ? r.messageId ?? null : null,
    status: r.outcome ?? (r.ok ? 'accepted' : r.stub ? 'stub' : 'failed'),
    error_code: r.errorCode ?? (r.stub ? 'not_configured' : null),
    error_message: r.errorMessage ?? (r.ok ? null : r.error ? `${r.error}`.slice(0, 500) : null),
  };
}

/** Best-effort row in public.notification_log; never throws. */
export async function logNotification(
  ctx: NotifyLogCtx | undefined,
  to: string | null,
  r: SendResult
): Promise<void> {
  if (!ctx?.admin) return;
  try {
    const { error } = await ctx.admin.from('notification_log').insert({
      business_id: ctx.businessId ?? null,
      appointment_id: ctx.appointmentId ?? null,
      channel: r.channel,
      type: ctx.type,
      ...notificationLogResult(to, r),
    });
    if (error) console.error('notification_log insert failed', error.message);
  } catch (e) {
    console.error('notification_log insert exception', e);
  }
}

/**
 * Booking phone first, else the client's profile phone (when the client has an account).
 * Returns null when neither exists.
 */
export async function resolveClientPhone(
  admin: AnyClient,
  bookingPhone: string | null | undefined,
  clientUserId: string | null | undefined
): Promise<string | null> {
  if (bookingPhone && bookingPhone.trim()) return bookingPhone;
  if (!clientUserId) return null;
  try {
    const { data } = await admin
      .from('profiles')
      .select('phone')
      .eq('id', clientUserId)
      .maybeSingle();
    const p = (data as { phone?: string | null } | null)?.phone;
    return p && p.trim() ? p : null;
  } catch {
    return null;
  }
}

export async function notifyClientChannels(opts: {
  email: string | null;
  phone: string | null;
  subject: string;
  text: string;
  /** Template ref from the message builder (copy.wa); used when WHATSAPP_TPL_<key> is set. */
  wa?: WaTemplateRef;
  log?: NotifyLogCtx;
}): Promise<SendResult[]> {
  const results: SendResult[] = [];
  if (opts.email) {
    const r = await sendEmail(opts.email, opts.subject, opts.text);
    results.push(r);
    await logNotification(opts.log, opts.email, r);
  }
  if (opts.phone) {
    const r = await sendWhatsApp(opts.phone, opts.text, opts.wa ? { template: opts.wa } : undefined);
    results.push(r);
    await logNotification(opts.log, opts.phone, r);
  }
  if (!opts.email && !opts.phone) {
    console.log('NOTIFY_SKIP_NO_CONTACT', opts.subject);
  }
  return results;
}

/** Notify business owner about a new pending booking request. */
export function messageNewPendingRequest(
  businessName: string,
  contact: string,
  whenLabel?: string,
  lang: NotifyLang = 'ro'
): { subject: string; text: string; wa: WaTemplateRef } {
  const wa: WaTemplateRef = { key: 'OWNER_PENDING', vars: [businessName, contact, whenLabel || '-'] };
  if (lang === 'en') {
    const text = whenLabel
      ? `New request at ${businessName} from ${contact} (${whenLabel}). Open Requests to reply.`
      : `New request at ${businessName} from ${contact}. Open Requests to reply.`;
    return { subject: 'New booking request', text, wa };
  }
  const text = whenLabel
    ? `Cerere nouă la ${businessName} de la ${contact} (${whenLabel}). Deschide Cereri pentru a răspunde.`
    : `Cerere nouă la ${businessName} de la ${contact}. Deschide Cereri pentru a răspunde.`;
  return { subject: 'Cerere nouă de programare', text, wa };
}

/** Notify business owner that a client moved their appointment. */
export function messageRescheduledRequest(
  businessName: string,
  contact: string,
  whenLabel?: string,
  lang: NotifyLang = 'ro'
): { subject: string; text: string } {
  if (lang === 'en') {
    const text = whenLabel
      ? `${contact} moved the booking at ${businessName} (${whenLabel}). Open the Calendar.`
      : `${contact} moved the booking at ${businessName}. Open the Calendar.`;
    return { subject: 'Booking moved', text };
  }
  const text = whenLabel
    ? `${contact} a mutat programarea la ${businessName} (${whenLabel}). Deschide Calendarul.`
    : `${contact} a mutat programarea la ${businessName}. Deschide Calendarul.`;
  return { subject: 'Programare mutată', text };
}

/** Copy helpers for decision + reminder. */
export function messageApproved(
  businessName: string,
  whenLabel: string,
  lang: NotifyLang = 'ro'
): { subject: string; text: string; wa: WaTemplateRef } {
  const wa: WaTemplateRef = { key: 'CONFIRMED', vars: [businessName, whenLabel] };
  if (lang === 'en') {
    return {
      subject: 'Booking confirmed',
      text: `Your booking at ${businessName} on ${whenLabel} was confirmed.`,
      wa,
    };
  }
  const text = `Programarea ta la ${businessName} pe ${whenLabel} a fost confirmată.`;
  return { subject: 'Programare confirmată', text, wa };
}

export function messageRejected(
  businessName: string,
  whenLabel: string,
  lang: NotifyLang = 'ro'
): { subject: string; text: string; wa: WaTemplateRef } {
  const wa: WaTemplateRef = { key: 'REJECTED', vars: [businessName, whenLabel] };
  if (lang === 'en') {
    return {
      subject: 'Booking rejected',
      text: `Your booking at ${businessName} on ${whenLabel} was rejected. The slot was released.`,
      wa,
    };
  }
  const text = `Programarea ta la ${businessName} pe ${whenLabel} a fost respinsă. Slotul a fost eliberat.`;
  return { subject: 'Programare respinsă', text, wa };
}

/**
 * "Soon" reminder: kind '1h' when it goes out ~1 hour before the start, 'catchup' for late
 * bookings that get it closer to the start (text then names the time, not a duration).
 * WhatsApp uses the REMINDER_1H template (generic text: business + time); REMINDER_SOON is the
 * old Meta template that says "in about 30 minutes" and must not be used for this anymore.
 */
export function messageReminder(
  businessName: string,
  timeLocal: string,
  timezone: string,
  lang: NotifyLang = 'ro',
  kind: '1h' | 'catchup' = '1h'
): { subject: string; text: string; wa: WaTemplateRef } {
  const wa: WaTemplateRef = { key: 'REMINDER_1H', vars: [businessName, timeLocal] };
  if (lang === 'en') {
    if (kind === 'catchup') {
      return {
        subject: `Booking reminder — today at ${timeLocal}`,
        text: `Hi! Reminder: you have a booking at ${businessName} soon, today at ${timeLocal} (${timezone}).`,
        wa,
      };
    }
    return {
      subject: 'Booking reminder — in 1 hour',
      text: `Hi! You have a booking at ${businessName} in 1 hour, at ${timeLocal} (${timezone}).`,
      wa,
    };
  }
  if (kind === 'catchup') {
    return {
      subject: `Reminder programare — azi la ora ${timeLocal}`,
      text: `Salut! Îți reamintim că ai o programare la ${businessName} în curând, azi la ora ${timeLocal} (${timezone}).`,
      wa,
    };
  }
  const text = `Salut! Ai o programare la ${businessName} într-o oră, la ora ${timeLocal} (${timezone}).`;
  return { subject: 'Reminder programare — într-o oră', text, wa };
}

export function messageReminder24h(
  businessName: string,
  timeLocal: string,
  timezone: string,
  lang: NotifyLang = 'ro'
): { subject: string; text: string; wa: WaTemplateRef } {
  const wa: WaTemplateRef = { key: 'REMINDER_24H', vars: [businessName, timeLocal] };
  if (lang === 'en') {
    return {
      wa,
      subject: 'Booking reminder — 24 hours',
      text: `Hi! You have a booking at ${businessName} tomorrow at ${timeLocal} (${timezone}). Confirm attendance from the app, under My bookings.`,
    };
  }
  const text = `Salut! Ai o programare la ${businessName} mâine la ${timeLocal} (${timezone}). Confirmă prezența din aplicație, la Programările mele.`;
  return { subject: 'Reminder programare — 24 de ore', text, wa };
}

export function messageRebook(
  businessName: string,
  serviceName: string,
  lang: NotifyLang = 'ro'
): { subject: string; text: string; wa: WaTemplateRef } {
  const wa: WaTemplateRef = { key: 'REBOOK', vars: [businessName, serviceName] };
  if (lang === 'en') {
    return {
      wa,
      subject: 'Time to come back',
      text: `Hi! It's time for ${serviceName} at ${businessName}. Book your next visit from the app.`,
    };
  }
  return {
    wa,
    subject: 'E timpul sa revii',
    text: `Salut! A venit timpul pentru ${serviceName} la ${businessName}. Programeaza urmatoarea vizita din aplicatie.`,
  };
}

export function messagePostpone(
  businessName: string,
  hours: number,
  newTimeLocal: string,
  timezone: string,
  lang: NotifyLang = 'ro'
): { subject: string; text: string; wa: WaTemplateRef } {
  const wa: WaTemplateRef = { key: 'MOVED', vars: [businessName, newTimeLocal] };
  const hoursLabel =
    lang === 'en'
      ? `${hours} ${hours === 1 ? 'hour' : 'hours'}`
      : `${hours} ${hours === 1 ? 'oră' : 'ore'}`;
  if (lang === 'en') {
    return {
      wa,
      subject: `Booking postponed by ${hoursLabel}`,
      text: `The booking at ${businessName} is postponed by ${hoursLabel}. New time: ${newTimeLocal} (${timezone}).`,
    };
  }
  const text = `Programarea la ${businessName} se amână cu ${hoursLabel}. Noua oră: ${newTimeLocal} (${timezone}).`;
  return { subject: `Programare amânată cu ${hoursLabel}`, text, wa };
}

export function messageMoved(
  businessName: string,
  newTimeLocal: string,
  timezone: string,
  lang: NotifyLang = 'ro'
): { subject: string; text: string; wa: WaTemplateRef } {
  const wa: WaTemplateRef = { key: 'MOVED', vars: [businessName, newTimeLocal] };
  if (lang === 'en') {
    return {
      wa,
      subject: 'Booking moved',
      text: `Your booking at ${businessName} was moved. New time: ${newTimeLocal} (${timezone}).`,
    };
  }
  const text = `Programarea ta la ${businessName} a fost mutata. Noua ora: ${newTimeLocal} (${timezone}).`;
  return { subject: 'Programare mutata', text, wa };
}

export function messageTest(lang: NotifyLang = 'ro'): { subject: string; text: string } {
  if (lang === 'en') {
    return {
      subject: 'Programari WhatsApp test',
      text: 'Programari test: WhatsApp messages work. You will receive confirmations and reminders here.',
    };
  }
  const text =
    'Test Programari: mesajele WhatsApp funcționează. Vei primi confirmări și reminder-uri aici.';
  return { subject: 'Test WhatsApp Programari', text };
}

/** OTP for WhatsApp phone login. */
export function messageAuthOtp(code: string, lang: NotifyLang = 'ro'): {
  subject: string;
  text: string;
} {
  if (lang === 'en') {
    return {
      subject: 'Programari login code',
      text: `Your Programari code: ${code}. Valid for 15 minutes.`,
    };
  }
  const text = `Codul tau Programari: ${code}. Valabil 15 minute.`;
  return { subject: 'Cod autentificare Programari', text };
}

const RO_MONTHS = ['ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie', 'iulie', 'august', 'septembrie', 'octombrie', 'noiembrie', 'decembrie'];
const EN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** 'YYYY-MM-DD' → „10 noiembrie 2026” / “10 November 2026”; any other input is returned unchanged. */
export function formatLongDate(ymd: string, lang: NotifyLang = 'ro'): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return ymd;
  const month = (lang === 'en' ? EN_MONTHS : RO_MONTHS)[Number(m[2]) - 1];
  if (!month) return ymd;
  return `${Number(m[3])} ${month} ${m[1]}`;
}

/** Notify a waitlisted client that a slot freed up. `desiredDate` is 'YYYY-MM-DD'. */
export function messageWaitlistSpot(
  businessName: string,
  desiredDate: string,
  bookingUrl: string,
  lang: NotifyLang = 'ro'
): { subject: string; text: string; wa: WaTemplateRef } {
  const dateLabel = formatLongDate(desiredDate, lang);
  const wa: WaTemplateRef = { key: 'WAITLIST', vars: [businessName, dateLabel, bookingUrl] };
  if (lang === 'en') {
    return {
      wa,
      subject: 'Slot freed up — Programari',
      text: `A slot freed up at ${businessName} on ${dateLabel}. Book now: ${bookingUrl}`,
    };
  }
  const text = `S-a eliberat un loc la ${businessName} pe ${dateLabel}. Rezervă acum: ${bookingUrl}`;
  return { subject: 'Loc eliberat — Programari', text, wa };
}

/** Owner: a client asked to move an approved booking (the salon decides). */
export function messageRescheduleRequested(
  businessName: string,
  contact: string,
  fromLabel: string,
  toLabel: string,
  lang: NotifyLang = 'ro'
): { subject: string; text: string } {
  if (lang === 'en') {
    return {
      subject: 'Reschedule requested',
      text: `${contact} asks to move the booking at ${businessName}: ${fromLabel} → ${toLabel}. Open Requests to accept or decline.`,
    };
  }
  return {
    subject: 'Reprogramare cerută',
    text: `${contact} cere mutarea programării la ${businessName}: ${fromLabel} → ${toLabel}. Deschide Cereri ca să accepți sau să refuzi.`,
  };
}

/** Client: the salon accepted the requested time. WhatsApp reuses the approved MOVED template. */
export function messageRescheduleAccepted(
  businessName: string,
  newTimeLocal: string,
  lang: NotifyLang = 'ro'
): { subject: string; text: string; wa: WaTemplateRef } {
  const wa: WaTemplateRef = { key: 'MOVED', vars: [businessName, newTimeLocal] };
  if (lang === 'en') {
    return {
      wa,
      subject: 'Reschedule accepted',
      text: `${businessName} accepted your new time: ${newTimeLocal}.`,
    };
  }
  return {
    wa,
    subject: 'Reprogramare acceptată',
    text: `${businessName} a acceptat ora nouă: ${newTimeLocal}.`,
  };
}

/** Client: the salon declined the requested time; the original booking stays. */
export function messageRescheduleDeclined(
  businessName: string,
  keptTimeLocal: string,
  link: string,
  lang: NotifyLang = 'ro'
): { subject: string; text: string } {
  if (lang === 'en') {
    return {
      subject: 'Reschedule declined',
      text: `${businessName} can't do the time you asked for. Your booking stays on ${keptTimeLocal}. Propose another time: ${link}`,
    };
  }
  return {
    subject: 'Reprogramare refuzată',
    text: `${businessName} nu poate la ora cerută. Programarea rămâne pe ${keptTimeLocal}. Propune altă oră: ${link}`,
  };
}

/** Client: nobody answered the reschedule request in time; the original booking stays. */
export function messageRescheduleExpired(
  businessName: string,
  keptTimeLocal: string,
  lang: NotifyLang = 'ro'
): { subject: string; text: string } {
  if (lang === 'en') {
    return {
      subject: 'Reschedule request expired',
      text: `${businessName} didn't answer your reschedule request in time. Your booking stays on ${keptTimeLocal}.`,
    };
  }
  return {
    subject: 'Cererea de reprogramare a expirat',
    text: `${businessName} nu a răspuns la timp cererii de reprogramare. Programarea rămâne pe ${keptTimeLocal}.`,
  };
}

/** Client: the salon did not answer the booking request in time; the request was closed. */
export function messagePendingExpired(
  businessName: string,
  whenLabel: string,
  link: string,
  lang: NotifyLang = 'ro'
): { subject: string; text: string } {
  if (lang === 'en') {
    return {
      subject: 'Booking request expired',
      text: `${businessName} didn't answer your request for ${whenLabel} in time, so it was closed. Book another time: ${link}`,
    };
  }
  return {
    subject: 'Cererea de programare a expirat',
    text: `${businessName} nu a răspuns la timp cererii tale pentru ${whenLabel}, așa că a fost închisă. Alege altă oră: ${link}`,
  };
}

/** Owner: a booking request expired without an answer. */
export function messagePendingExpiredOwner(
  contact: string,
  whenLabel: string,
  lang: NotifyLang = 'ro'
): { subject: string; text: string } {
  if (lang === 'en') {
    return {
      subject: 'Request expired',
      text: `The request from ${contact} for ${whenLabel} expired without an answer. The client was told.`,
    };
  }
  return {
    subject: 'Cerere expirată',
    text: `Cererea de la ${contact} pentru ${whenLabel} a expirat fără răspuns. Clientul a fost anunțat.`,
  };
}

/** Client: the salon cancelled the booking, with its reason. */
export function messageCancelledByBusiness(
  businessName: string,
  whenLabel: string,
  reason: string,
  link: string,
  lang: NotifyLang = 'ro'
): { subject: string; text: string } {
  if (lang === 'en') {
    return {
      subject: 'Booking cancelled by the salon',
      text: `${businessName} cancelled your booking on ${whenLabel}. Reason: ${reason}. Book another time: ${link}`,
    };
  }
  return {
    subject: 'Programare anulată de salon',
    text: `${businessName} a anulat programarea ta din ${whenLabel}. Motiv: ${reason}. Alege altă oră: ${link}`,
  };
}

/** Team invitation email (business_invitations). Plain text; the link opens /invitatie?token=… */
export function messageBusinessInvite(
  opts: {
    businessName: string;
    inviterName: string;
    role: 'staff' | 'admin';
    staffName: string | null;
    email: string;
    link: string;
    token: string;
    expiresAt: string;
  },
  lang: NotifyLang = 'ro'
): { subject: string; text: string } {
  const expires = new Date(opts.expiresAt).toLocaleDateString(notifyLocale(lang), {
    timeZone: 'Europe/Bucharest',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  if (lang === 'en') {
    const role =
      opts.role === 'admin'
        ? 'administrator (manages everything except adding other administrators)'
        : `employee${opts.staffName ? ` for specialist ${opts.staffName}` : ''} (sees and manages only that specialist's appointments)`;
    return {
      subject: `Invitation to join ${opts.businessName} on Programari`,
      text: [
        'Hello,',
        '',
        `${opts.inviterName} invited you to join the team of "${opts.businessName}" in the Programari app as ${role}.`,
        '',
        'Accept the invitation:',
        opts.link,
        '',
        `Important: sign in with exactly this email address (${opts.email}). If you do not have an account yet, create one with this address, then open the link again.`,
        '',
        `If the link does not work, sign in to the app with this email address: the invitation appears on the home screen. Invitation code: ${opts.token}`,
        '',
        `The invitation expires on ${expires}.`,
        '',
        'If you were not expecting this email, you can ignore it.',
      ].join('\n'),
    };
  }
  const role =
    opts.role === 'admin'
      ? 'administrator (gestionezi tot, mai puțin adăugarea altor administratori)'
      : `angajat${opts.staffName ? ` pentru specialistul ${opts.staffName}` : ''} (vezi și gestionezi doar programările acestui specialist)`;
  return {
    subject: `Invitație în echipa ${opts.businessName} – Programări`,
    text: [
      'Bună,',
      '',
      `${opts.inviterName} te-a invitat în echipa „${opts.businessName}” din aplicația Programări, ca ${role}.`,
      '',
      'Acceptă invitația:',
      opts.link,
      '',
      `Important: intră în aplicație cu exact această adresă de email (${opts.email}). Dacă nu ai cont, creează-ți unul cu această adresă, apoi deschide din nou linkul.`,
      '',
      `Dacă linkul nu merge, intră în aplicație cu această adresă de email: invitația apare pe ecranul principal. Cod invitație: ${opts.token}`,
      '',
      `Invitația expiră pe ${expires}.`,
      '',
      'Dacă nu te așteptai la acest email, îl poți ignora.',
    ].join('\n'),
  };
}

/** Public web base for links in client messages. */
export function appWebBase(): string {
  return (Deno.env.get('PUBLIC_WEB_BASE_URL') ?? 'https://programari.expo.app').replace(/\/$/, '');
}

/** Push text for a chat message: the text, or „📷 Foto” / „🎬 Video” (· caption) for an attachment. */
export function chatPushBody(
  record: { body?: string | null; attachment_kind?: string | null },
  lang: NotifyLang = 'ro'
): string {
  const text = String(record.body ?? '').replace(/\s+/g, ' ').trim();
  const kind = record.attachment_kind;
  const label = kind === 'image' ? (lang === 'en' ? '📷 Photo' : '📷 Foto') : kind === 'video' ? '🎬 Video' : '';
  const out = label ? (text ? `${label} · ${text}` : label) : text;
  return out.slice(0, 120);
}
