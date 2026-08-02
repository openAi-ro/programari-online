/**
 * Shared client notification channels: email (Resend) + WhatsApp (Twilio).
 * When env keys are missing, stubs log to console and return ok.
 */

export type SendResult = {
  ok: boolean;
  stub?: boolean;
  status?: number;
  channel: 'email' | 'whatsapp';
  error?: string;
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

export async function sendWhatsApp(
  toE164: string,
  text: string
): Promise<SendResult> {
  const sid = Deno.env.get('TWILIO_ACCOUNT_SID');
  const token = Deno.env.get('TWILIO_AUTH_TOKEN');
  const from = Deno.env.get('TWILIO_WHATSAPP_FROM'); // e.g. whatsapp:+14155238886
  if (!sid || !token || !from) {
    console.log('WHATSAPP_STUB', { toE164, text });
    return { ok: true, stub: true, channel: 'whatsapp' };
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
          Authorization: 'Basic ' + btoa(`${sid}:${token}`),
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
        error: errBody,
      };
    }
    return { ok: true, status: res.status, channel: 'whatsapp' };
  } catch (e) {
    console.error('sendWhatsApp exception', e);
    return {
      ok: false,
      channel: 'whatsapp',
      error: e instanceof Error ? e.message : String(e),
    };
  }
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
