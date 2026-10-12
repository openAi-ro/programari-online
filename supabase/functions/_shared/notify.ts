/**
 * Shared client notification channels: email (Resend) + WhatsApp (Twilio / Meta Cloud).
 * When env keys are missing, stubs log to console and return ok.
 */
import { normalizePhoneE164, phoneForMetaApi } from './phone.ts';

/** Recipient language for notification copy. Functions accept `lang` in the body (default 'ro'). */
export type NotifyLang = 'ro' | 'en';

export function parseNotifyLang(v: unknown): NotifyLang {
  return v === 'en' ? 'en' : 'ro';
}

/** Intl locale tag for date/time labels inside notifications. */
export function notifyLocale(lang: NotifyLang): string {
  return lang === 'en' ? 'en-GB' : 'ro-RO';
}

export type SendResult = {
  ok: boolean;
  stub?: boolean;
  status?: number;
  channel: 'email' | 'whatsapp';
  error?: string;
  provider?: 'twilio' | 'meta' | 'stub';
};

export async function sendEmail(
  to: string,
  subject: string,
  text: string
): Promise<SendResult> {
  const key = Deno.env.get('RESEND_API_KEY');
  if (!key) {
    console.log('EMAIL_STUB', { to, subject, text });
    return { ok: true, stub: true, channel: 'email' };
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: Deno.env.get('EMAIL_FROM') ?? 'Programari <onboarding@resend.dev>',
        to: [to],
        subject,
        text,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error('Resend error', res.status, body);
      return { ok: false, status: res.status, channel: 'email', error: body };
    }
    return { ok: true, status: res.status, channel: 'email' };
  } catch (e) {
    console.error('sendEmail exception', e);
    return {
      ok: false,
      channel: 'email',
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export type SendWhatsAppOpts = {
  /** Prefer an approved template (required for OTP / first contact outside 24h). */
  otpCode?: string;
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
    e.includes('"code":190') ||
    e.includes('errorcod":190') ||
    (e.includes('oauth') && e.includes('expired')) ||
    e.includes('session has expired')
  ) {
    return en
      ? 'The WhatsApp token expired. Refresh WHATSAPP_ACCESS_TOKEN in the Supabase secrets.'
      : 'Token-ul WhatsApp a expirat. Reînnoiește WHATSAPP_ACCESS_TOKEN în secrets Supabase.';
  }
  if (e.includes('132001') || e.includes('template name does not exist')) {
    return en
      ? 'The WhatsApp template does not exist or is not approved. Check WHATSAPP_OTP_TEMPLATE and the language.'
      : 'Șablonul WhatsApp nu există sau nu e aprobat. Verifică WHATSAPP_OTP_TEMPLATE și limba.';
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
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    }
  );
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    console.error('Meta WhatsApp error', res.status, errBody);
    return {
      ok: false,
      status: res.status,
      channel: 'whatsapp',
      provider: 'meta',
      error: errBody,
    };
  }
  return { ok: true, status: res.status, channel: 'whatsapp', provider: 'meta' };
}

async function sendWhatsAppMeta(
  toE164: string,
  text: string,
  opts?: SendWhatsAppOpts
): Promise<SendResult> {
  const token = Deno.env.get('WHATSAPP_ACCESS_TOKEN');
  const phoneNumberId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID');
  if (!token || !phoneNumberId) {
    console.log('WHATSAPP_STUB', { toE164, text, provider: 'meta' });
    return { ok: true, stub: true, channel: 'whatsapp', provider: 'stub' };
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

    return await postMetaMessage(phoneNumberId, token, {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: text },
    });
  } catch (e) {
    console.error('sendWhatsAppMeta exception', e);
    return {
      ok: false,
      channel: 'whatsapp',
      provider: 'meta',
      error: e instanceof Error ? e.message : String(e),
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
    console.log('WHATSAPP_STUB', { toE164, text, provider: 'twilio' });
    return { ok: true, stub: true, channel: 'whatsapp', provider: 'stub' };
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
      return {
        ok: false,
        status: res.status,
        channel: 'whatsapp',
        provider: 'twilio',
        error: errBody,
      };
    }
    return { ok: true, status: res.status, channel: 'whatsapp', provider: 'twilio' };
  } catch (e) {
    console.error('sendWhatsAppTwilio exception', e);
    return {
      ok: false,
      channel: 'whatsapp',
      provider: 'twilio',
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function sendWhatsApp(
  toRaw: string,
  text: string,
  opts?: SendWhatsAppOpts
): Promise<SendResult> {
  const toE164 = normalizePhoneE164(toRaw);
  if (!toE164) {
    console.error('sendWhatsApp invalid phone', toRaw);
    return {
      ok: false,
      channel: 'whatsapp',
      error: 'invalid_phone',
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

  console.log('WHATSAPP_STUB', { toE164, text, provider: 'none' });
  return { ok: true, stub: true, channel: 'whatsapp', provider: 'stub' };
}

export async function notifyClientChannels(opts: {
  email: string | null;
  phone: string | null;
  subject: string;
  text: string;
}): Promise<SendResult[]> {
  const results: SendResult[] = [];
  if (opts.email) {
    results.push(await sendEmail(opts.email, opts.subject, opts.text));
  }
  if (opts.phone) {
    results.push(await sendWhatsApp(opts.phone, opts.text));
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
): { subject: string; text: string } {
  if (lang === 'en') {
    const text = whenLabel
      ? `New request at ${businessName} from ${contact} (${whenLabel}). Open Requests to reply.`
      : `New request at ${businessName} from ${contact}. Open Requests to reply.`;
    return { subject: 'New booking request', text };
  }
  const text = whenLabel
    ? `Cerere nouă la ${businessName} de la ${contact} (${whenLabel}). Deschide Cereri pentru a răspunde.`
    : `Cerere nouă la ${businessName} de la ${contact}. Deschide Cereri pentru a răspunde.`;
  return { subject: 'Cerere nouă de programare', text };
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
): {
  subject: string;
  text: string;
} {
  if (lang === 'en') {
    return {
      subject: 'Booking confirmed',
      text: `Your booking at ${businessName} on ${whenLabel} was confirmed.`,
    };
  }
  const text = `Programarea ta la ${businessName} pe ${whenLabel} a fost confirmată.`;
  return { subject: 'Programare confirmată', text };
}

export function messageRejected(
  businessName: string,
  whenLabel: string,
  lang: NotifyLang = 'ro'
): {
  subject: string;
  text: string;
} {
  if (lang === 'en') {
    return {
      subject: 'Booking rejected',
      text: `Your booking at ${businessName} on ${whenLabel} was rejected. The slot was released.`,
    };
  }
  const text = `Programarea ta la ${businessName} pe ${whenLabel} a fost respinsă. Slotul a fost eliberat.`;
  return { subject: 'Programare respinsă', text };
}

export function messageReminder(
  businessName: string,
  timeLocal: string,
  timezone: string,
  lang: NotifyLang = 'ro'
): { subject: string; text: string } {
  if (lang === 'en') {
    return {
      subject: 'Booking reminder — 30 minutes',
      text: `Hi! You have a booking at ${businessName} in 30 minutes (${timeLocal}, ${timezone}).`,
    };
  }
  const text = `Salut! Ai o programare la ${businessName} în 30 de minute (${timeLocal}, ${timezone}).`;
  return { subject: 'Reminder programare — 30 de minute', text };
}

export function messageReminder24h(
  businessName: string,
  timeLocal: string,
  timezone: string,
  lang: NotifyLang = 'ro'
): { subject: string; text: string } {
  if (lang === 'en') {
    return {
      subject: 'Booking reminder — 24 hours',
      text: `Hi! You have a booking at ${businessName} tomorrow at ${timeLocal} (${timezone}). Confirm attendance from the app, under My bookings.`,
    };
  }
  const text = `Salut! Ai o programare la ${businessName} mâine la ${timeLocal} (${timezone}). Confirmă prezența din aplicație, la Programările mele.`;
  return { subject: 'Reminder programare — 24 de ore', text };
}

export function messagePostpone(
  businessName: string,
  hours: number,
  newTimeLocal: string,
  timezone: string,
  lang: NotifyLang = 'ro'
): { subject: string; text: string } {
  const hoursLabel =
    lang === 'en'
      ? `${hours} ${hours === 1 ? 'hour' : 'hours'}`
      : `${hours} ${hours === 1 ? 'oră' : 'ore'}`;
  if (lang === 'en') {
    return {
      subject: `Booking postponed by ${hoursLabel}`,
      text: `The booking at ${businessName} is postponed by ${hoursLabel}. New time: ${newTimeLocal} (${timezone}).`,
    };
  }
  const text = `Programarea la ${businessName} se amână cu ${hoursLabel}. Noua oră: ${newTimeLocal} (${timezone}).`;
  return { subject: `Programare amânată cu ${hoursLabel}`, text };
}

export function messageMoved(
  businessName: string,
  newTimeLocal: string,
  timezone: string,
  lang: NotifyLang = 'ro'
): { subject: string; text: string } {
  if (lang === 'en') {
    return {
      subject: 'Booking moved',
      text: `Your booking at ${businessName} was moved. New time: ${newTimeLocal} (${timezone}).`,
    };
  }
  const text = `Programarea ta la ${businessName} a fost mutata. Noua ora: ${newTimeLocal} (${timezone}).`;
  return { subject: 'Programare mutata', text };
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

/** Notify business owner about a new pending booking request. */
export function messageWaitlistSpot(
  businessName: string,
  dateLabel: string,
  bookingUrl: string,
  lang: NotifyLang = 'ro'
): { subject: string; text: string } {
  if (lang === 'en') {
    return {
      subject: 'Slot freed up — Programari',
      text: `A slot freed up at ${businessName} on ${dateLabel}. Book now: ${bookingUrl}`,
    };
  }
  const text = `S-a eliberat un loc la ${businessName} pe ${dateLabel}. Rezervă acum: ${bookingUrl}`;
  return { subject: 'Loc eliberat — Programari', text };
}
