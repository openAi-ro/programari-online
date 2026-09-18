/**
 * Edge Function: auth-whatsapp-verify
 *
 * Public POST { phone, code } — verify custom WhatsApp OTP, upsert auth user, return session tokens.
 * Client should call supabase.auth.setSession({ access_token, refresh_token }).
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { handleCors, jsonResponse } from '../_shared/cors.ts';
import { normalizePhoneE164 } from '../_shared/phone.ts';

const MAX_ATTEMPTS = 5;
const IDEMPOTENT_MS = 3 * 60_000;

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Placeholder email for phone-only accounts (needed for generateLink magiclink). */
function phonePlaceholderEmail(e164: string): string {
  const digits = e164.replace(/^\+/, '');
  return `${digits}@phone.programari.local`;
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !serviceKey || !anonKey) {
    return jsonResponse({ error: 'server_misconfigured' }, 500);
  }

  let body: { phone?: string; code?: string; account_kind?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400);
  }

  const accountKind = body.account_kind === 'business' ? 'business' : 'client';
  const phone = normalizePhoneE164(body.phone);
  const code = (body.code ?? '').replace(/\D/g, '');
  if (!phone) {
    return jsonResponse(
      {
        error: 'invalid_phone',
        hint: 'Folosește un număr valid (07xxxxxxxx sau +40...).',
      },
      400
    );
  }
  if (!/^\d{6}$/.test(code)) {
    return jsonResponse(
      { error: 'invalid_code', hint: 'Codul trebuie să aibă 6 cifre.' },
      400
    );
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const codeHash = await sha256Hex(code);

  const { data: rows, error: otpErr } = await admin
    .from('auth_whatsapp_otps')
    .select('id, code_hash, attempts, expires_at, consumed_at')
    .eq('phone', phone)
    .order('created_at', { ascending: false })
    .limit(8);

  if (otpErr) {
    console.error('auth-whatsapp-verify otp lookup', otpErr);
    return jsonResponse({ error: 'otp_lookup_failed' }, 500);
  }

  const list = rows ?? [];
  const matched = list.find((r) => r.code_hash === codeHash);
  const latestActive = list.find(
    (r) =>
      !r.consumed_at &&
      new Date(r.expires_at).getTime() > now
  );

  if (matched?.consumed_at) {
    const consumedAt = new Date(matched.consumed_at).getTime();
    if (now - consumedAt <= IDEMPOTENT_MS) {
      // Same code submitted twice (double tap) — continue to session.
    } else {
      return jsonResponse(
        {
          error: 'otp_already_used',
          hint: 'Acest cod a fost deja folosit. Cere un cod nou.',
        },
        400
      );
    }
  } else if (matched && new Date(matched.expires_at).getTime() <= now) {
    return jsonResponse(
      {
        error: 'otp_expired',
        hint: 'Codul a expirat. Cere un cod nou.',
      },
      400
    );
  } else if (matched) {
    if ((matched.attempts ?? 0) >= MAX_ATTEMPTS) {
      await admin
        .from('auth_whatsapp_otps')
        .update({ consumed_at: nowIso })
        .eq('id', matched.id);
      return jsonResponse(
        {
          error: 'too_many_attempts',
          hint: 'Prea multe încercări. Cere un cod nou.',
        },
        429
      );
    }
  } else if (latestActive) {
    const attempts = (latestActive.attempts ?? 0) + 1;
    const patch: { attempts: number; consumed_at?: string } = { attempts };
    if (attempts >= MAX_ATTEMPTS) patch.consumed_at = nowIso;
    await admin.from('auth_whatsapp_otps').update(patch).eq('id', latestActive.id);
    if (attempts >= MAX_ATTEMPTS) {
      return jsonResponse(
        {
          error: 'too_many_attempts',
          hint: 'Prea multe încercări. Cere un cod nou.',
        },
        429
      );
    }
    return jsonResponse(
      { error: 'invalid_code', hint: 'Cod greșit. Încearcă din nou.' },
      400
    );
  } else {
    const latest = list[0];
    if (latest && new Date(latest.expires_at).getTime() <= now) {
      return jsonResponse(
        {
          error: 'otp_expired',
          hint: 'Codul a expirat. Cere un cod nou.',
        },
        400
      );
    }
    return jsonResponse(
      {
        error: 'otp_not_found',
        hint: 'Nu am găsit un cod pentru acest număr. Cere un cod nou.',
      },
      400
    );
  }

  const otpRow = matched;
  if (!otpRow) {
    return jsonResponse(
      {
        error: 'otp_not_found',
        hint: 'Nu am găsit un cod pentru acest număr. Cere un cod nou.',
      },
      400
    );
  }

  if (!otpRow.consumed_at) {
    await admin
      .from('auth_whatsapp_otps')
      .update({ consumed_at: nowIso })
      .eq('id', otpRow.id);
  }

  // Find existing profile by phone (E.164)
  const { data: profile } = await admin
    .from('profiles')
    .select('id, email, phone, account_kind')
    .eq('phone', phone)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  let userId: string;
  let sessionEmail: string;
  let isNewUser = false;

  if (profile?.id) {
    const existingKind = profile.account_kind === 'business' ? 'business' : 'client';
    if (existingKind !== accountKind) {
      return jsonResponse(
        {
          error: 'wrong_account_kind',
          hint:
            existingKind === 'business'
              ? 'Acest număr e un cont business. Folosește „Cont business”.'
              : 'Acest număr e un cont client. Folosește „Cont client”.',
        },
        403
      );
    }
    userId = profile.id;
    const { data: userData, error: getUserErr } =
      await admin.auth.admin.getUserById(userId);
    if (getUserErr || !userData?.user) {
      console.error('auth-whatsapp-verify getUserById', getUserErr);
      return jsonResponse({ error: 'user_lookup_failed' }, 500);
    }

    const existing = userData.user;
    // generateLink requires an auth email — never use profiles.email alone
    sessionEmail = existing.email || phonePlaceholderEmail(phone);

    const updates: {
      phone?: string;
      phone_confirm?: boolean;
      email?: string;
      email_confirm?: boolean;
    } = {};

    if (!existing.phone || existing.phone !== phone) {
      updates.phone = phone;
      updates.phone_confirm = true;
    }
    if (!existing.email) {
      updates.email = sessionEmail;
      updates.email_confirm = true;
    }

    if (Object.keys(updates).length > 0) {
      const { error: updErr } = await admin.auth.admin.updateUserById(
        userId,
        updates
      );
      if (updErr) {
        console.error('auth-whatsapp-verify updateUser', updErr);
        // Continue if phone already taken on another auth user — still try session
      }
    }

    // Keep profiles.phone in sync
    if (profile.phone !== phone) {
      await admin.from('profiles').update({ phone }).eq('id', userId);
    }
  } else {
    sessionEmail = phonePlaceholderEmail(phone);
    const { data: createdUser, error: createErr } =
      await admin.auth.admin.createUser({
        phone,
        phone_confirm: true,
        email: sessionEmail,
        email_confirm: true,
        user_metadata: { auth_via: 'whatsapp_otp', account_kind: accountKind },
      });

    if (createErr || !createdUser?.user) {
      console.error('auth-whatsapp-verify createUser', createErr);
      // Race / already exists: resolve by phone then placeholder email
      let again = (
        await admin
          .from('profiles')
          .select('id, email')
          .eq('phone', phone)
          .limit(1)
          .maybeSingle()
      ).data;
      if (!again?.id) {
        again = (
          await admin
            .from('profiles')
            .select('id, email')
            .eq('email', sessionEmail)
            .limit(1)
            .maybeSingle()
        ).data;
      }
      if (!again?.id) {
        return jsonResponse(
          {
            error: 'user_create_failed',
            hint: createErr?.message ?? 'Nu am putut crea contul.',
          },
          500
        );
      }
      userId = again.id;
      if (again.email) sessionEmail = again.email;
      const { data: raced } = await admin
        .from('profiles')
        .select('account_kind')
        .eq('id', again.id)
        .maybeSingle();
      const racedKind = raced?.account_kind === 'business' ? 'business' : 'client';
      if (racedKind !== accountKind) {
        return jsonResponse(
          {
            error: 'wrong_account_kind',
            hint:
              racedKind === 'business'
                ? 'Acest număr e un cont business. Folosește „Cont business”.'
                : 'Acest număr e un cont client. Folosește „Cont client”.',
          },
          403
        );
      }
    } else {
      userId = createdUser.user.id;
      isNewUser = true;
      await admin
        .from('profiles')
        .update({ phone, email: sessionEmail, account_kind: accountKind })
        .eq('id', userId);
    }
  }

  // Session via magiclink hashed_token → verifyOtp (reliable on Deno edge + supabase-js v2)
  const { data: linkData, error: linkErr } =
    await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: sessionEmail,
    });

  if (linkErr || !linkData?.properties?.hashed_token) {
    console.error('auth-whatsapp-verify generateLink', linkErr);
    return jsonResponse(
      {
        error: 'session_create_failed',
        hint: 'Nu am putut crea sesiunea. Încearcă din nou.',
      },
      500
    );
  }

  // verifyOtp with anon client so returned session is a normal user session
  const anon = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: verified, error: verifyErr } = await anon.auth.verifyOtp({
    type: 'email',
    token_hash: linkData.properties.hashed_token,
  });

  if (verifyErr || !verified.session) {
    console.error('auth-whatsapp-verify verifyOtp', verifyErr);
    return jsonResponse(
      {
        error: 'session_create_failed',
        hint: 'Nu am putut crea sesiunea. Încearcă din nou.',
      },
      500
    );
  }

  const session = verified.session;
  return jsonResponse({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_in: session.expires_in,
    expires_at: session.expires_at,
    token_type: session.token_type ?? 'bearer',
    user: session.user ?? verified.user,
    created: isNewUser,
  });
});