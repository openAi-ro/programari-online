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

async function sendWhatsAppMeta(
  toE164: string,
  text: string
): Promise<SendResult> {
  const token = Deno.env.get('WHATSAPP_ACCESS_TOKEN');
  const phoneNumberId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID');
  if (!token || !phoneNumberId) {
    console.log('WHATSAPP_STUB', { toE164, text, provider: 'meta' });
    return { ok: true, stub: true, channel: 'whatsapp', provider: 'stub' };
  }

  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: phoneForMetaApi(toE164),
          type: 'text',
          text: { body: text },
        }),
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
  text: string
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
      Body: text,
    });
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
  text: string
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
    return sendWhatsAppMeta(toE164, text);
  }
  if (provider === 'twilio') {
    return sendWhatsAppTwilio(toE164, text);
  }

  // auto: prefer Meta if configured, else Twilio
  const hasMeta =
    !!Deno.env.get('WHATSAPP_ACCESS_TOKEN') &&
    !!Deno.env.get('WHATSAPP_PHONE_NUMBER_ID');
  const hasTwilio =
    !!Deno.env.get('TWILIO_ACCOUNT_SID') &&
    !!Deno.env.get('TWILIO_WHATSAPP_FROM') &&
    (!!Deno.env.get('TWILIO_AUTH_TOKEN') ||
      (!!Deno.env.get('TWILIO_API_KEY_SID') &&
        !!Deno.env.get('TWILIO_API_KEY_SECRET')));

  if (hasMeta) return sendWhatsAppMeta(toE164, text);
  if (hasTwilio) return sendWhatsAppTwilio(toE164, text);

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
  const text = `Salut! Ai o programare la ${businessName} în 30 de minute (${timeLocal}, ${timezone}).`;
  return { subject: 'Reminder programare — 30 minute', text };
}

export function messageTest(): { subject: string; text: string } {
  const text =
    'Test Programari: mesajele WhatsApp funcționează. Vei primi confirmări și reminder-uri aici.';
  return { subject: 'Test WhatsApp Programari', text };
}

/** Romanian OTP for WhatsApp phone login. */
export function messageAuthOtp(code: string): { subject: string; text: string } {
  const text = `Codul tau Programari: ${code}. Valabil 10 minute.`;
  return { subject: 'Cod autentificare Programari', text };
}
