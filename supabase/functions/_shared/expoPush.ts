/**
 * Shared Expo Push helper for edge functions.
 * Always sends with sound + priority high so Android can heads-up (channel must exist on device).
 */
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

export type ExpoPushMessage = {
  title: string;
  body: string;
  channelId?: string;
  data?: Record<string, unknown>;
};

type AdminClient = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => PromiseLike<{
        data: { expo_push_token: string }[] | null;
        error: { message: string } | null;
      }>;
    };
    delete: () => {
      in: (column: string, values: string[]) => PromiseLike<unknown>;
    };
  };
};

type ExpoTicket = {
  status?: string;
  message?: string;
  details?: { error?: string };
};

/**
 * Send Expo push to all tokens for userId.
 * Always sets sound + priority high (Android heads-up when channel allows).
 */
export async function sendExpoPushToUser(
  admin: AdminClient,
  userId: string,
  message: ExpoPushMessage,
): Promise<{ sent: number }> {
  const { data: tokens, error } = await admin
    .from('device_push_tokens')
    .select('expo_push_token')
    .eq('user_id', userId);

  if (error) {
    console.error('expoPush tokens load failed', error.message);
    return { sent: 0 };
  }

  if (!tokens?.length) {
    return { sent: 0 };
  }

  const channelId = message.channelId ?? 'cereri_heads';
  const data = message.data ?? {};

  const messages = tokens.map((t) => ({
    to: t.expo_push_token,
    title: message.title,
    body: message.body,
    sound: 'default' as const,
    priority: 'high' as const,
    channelId,
    data,
  }));

  let sent = 0;
  try {
    const expoRes = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(messages),
    });
    const expoJson = await expoRes.json().catch(() => null);
    console.log('Expo push response', expoRes.status, JSON.stringify(expoJson));

    const tickets: ExpoTicket[] = Array.isArray(expoJson?.data)
      ? expoJson.data
      : expoJson?.data
        ? [expoJson.data]
        : [];

    const toDelete: string[] = [];
    for (let i = 0; i < tickets.length; i++) {
      const ticket = tickets[i];
      if (ticket?.status === 'ok') {
        sent += 1;
        continue;
      }
      const errCode = ticket?.details?.error ?? ticket?.message ?? 'ticket_error';
      console.error('Expo ticket error', errCode);
      if (
        errCode === 'DeviceNotRegistered' ||
        String(ticket?.message ?? '').includes('DeviceNotRegistered')
      ) {
        toDelete.push(tokens[i]!.expo_push_token);
      }
    }

    if (toDelete.length) {
      await admin.from('device_push_tokens').delete().in('expo_push_token', toDelete);
      console.log('Removed invalid tokens', toDelete.length);
    }
  } catch (e) {
    console.error('Expo push fetch failed', e);
  }

  return { sent };
}
