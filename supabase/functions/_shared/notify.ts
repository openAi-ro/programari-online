/**
 * Shared client notification channels: email (Resend) + WhatsApp (Twilio / Meta Cloud).
 * When env keys are missing, stubs log to console and return ok.
 */
import { normalizePhoneE164, phoneForMetaApi } from './phone.ts';

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

/** Romanian hint from Meta/Twilio error payload — safe to show in the app. */
export function whatsappUserHint(result: SendResult): string {
  const e = `${result.error ?? ''}`.toLowerCase();
  if (e.includes('invalid_phone')) {
    return 'Folosește un număr valid (07xxxxxxxx sau +40...).';
  }
  if (e.includes('63015')) {
    return 'Numărul nu e înscris în sandbox-ul Twilio. Deschide WhatsApp, scrie „join …” către numărul Twilio, apoi reîncearcă.';
  }
  if (
    e.includes('63016') ||
    e.includes('131047') ||
    e.includes('re-engagement') ||
    e.includes('outside the allowed window')
  ) {
    return 'WhatsApp blochează mesajele libere. Adaugă un șablon OTP aprobat: WHATSAPP_OTP_TEMPLATE (Meta) sau TWILIO_WHATSAPP_CONTENT_SID (Twilio).';
  }
  if (e.includes('133010') || e.includes('not a whatsapp user')) {
    return 'Acest număr nu are WhatsApp activ.';
  }
  if (
    e.includes('"code":190') ||
    e.includes('errorcod":190') ||
    (e.includes('oauth') && e.includes('expired')) ||
    e.includes('session has expired')
  ) {
    return 'Token-ul WhatsApp a expirat. Reînnoiește WHATSAPP_ACCESS_TOKEN în secrets Supabase.';
  }
  if (e.includes('132001') || e.includes('template name does not exist')) {
    return 'Șablonul WhatsApp nu există sau nu e aprobat. Verifică WHATSAPP_OTP_TEMPLATE și limba.';
  }
  if (e.includes('21608') || e.includes('unverified')) {
    return 'Numărul Twilio WhatsApp nu e verificat / aprobat pentru acest destinatar.';
  }
  return 'Nu am putut trimite mesajul WhatsApp. Verifică secrets Meta/Twilio și încearcă din nou.';
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
  whenLabel?: string
): { subject: string; text: string } {
  const text = whenLabel
    ? `Cerere nouă la ${businessName} de la ${contact} (${whenLabel}). Deschide Cereri pentru a răspunde.`
    : `Cerere nouă la ${businessName} de la ${contact}. Deschide Cereri pentru a răspunde.`;
  return { subject: 'Cerere nouă de programare', text };
}

/** Notify business owner that a client moved their appointment. */
export function messageRescheduledRequest(
  businessName: string,
  contact: string,
  whenLabel?: string
): { subject: string; text: string } {
  const text = whenLabel
    ? `${contact} a mutat programarea la ${businessName} (${whenLabel}). Deschide Calendarul.`
    : `${contact} a mutat programarea la ${businessName}. Deschide Calendarul.`;
  return { subject: 'Programare mutată', text };
}

/** Romanian copy helpers for decision + reminder. */
export function messageApproved(businessName: string, whenLabel: string): {
  subject: string;
  text: string;
} {
  const text = `Programarea ta la ${businessName} pe ${whenLabel} a fost confirmată.`;
  return { subject: 'Programare confirmată', text };
}

export function messageRejected(businessName: string, whenLabel: string): {
  subject: string;
  text: string;
} {
  const text = `Programarea ta la ${businessName} pe ${whenLabel} a fost respinsă. Slotul a fost eliberat.`;
  return { subject: 'Programare respinsă', text };
}

export function messageReminder(
  businessName: string,
  timeLocal: string,
  timezone: string
): { subject: string; text: string } {
  const text = `Salut! Ai o programare la ${businessName} în 1 oră (${timeLocal}, ${timezone}).`;
  return { subject: 'Reminder programare — 1 oră', text };
}

export function messageReminder24h(
  businessName: string,
  timeLocal: string,
  timezone: string
): { subject: string; text: string } {
  const text = `Salut! Ai o programare la ${businessName} mâine la ${timeLocal} (${timezone}). Confirmă prezența din aplicație, la Programările mele.`;
  return { subject: 'Reminder programare — 24 de ore', text };
}

export function messagePostpone(
  businessName: string,
  hours: 1 | 2,
  newTimeLocal: string,
  timezone: string
): { subject: string; text: string } {
  const hoursLabel = hours === 1 ? '1 oră' : '2 ore';
  const text = `Programarea la ${businessName} se amână cu ${hoursLabel}. Noua oră: ${newTimeLocal} (${timezone}).`;
  return { subject: `Programare amânată cu ${hoursLabel}`, text };
}

export function messageTest(): { subject: string; text: string } {
  const text =
    'Test Programari: mesajele WhatsApp funcționează. Vei primi confirmări și reminder-uri aici.';
  return { subject: 'Test WhatsApp Programari', text };
}

/** Romanian OTP for WhatsApp phone login. */
export function messageAuthOtp(code: string): { subject: string; text: string } {
  const text = `Codul tau Programari: ${code}. Valabil 15 minute.`;
  return { subject: 'Cod autentificare Programari', text };
}

/** Notify business owner about a new pending booking request. */
export function messageWaitlistSpot(
  businessName: string,
  dateLabel: string,
  bookingUrl: string
): { subject: string; text: string } {
  const text = `S-a eliberat un loc la ${businessName} pe ${dateLabel}. Rezervă acum: ${bookingUrl}`;
  return { subject: 'Loc eliberat — Programari', text };
}
