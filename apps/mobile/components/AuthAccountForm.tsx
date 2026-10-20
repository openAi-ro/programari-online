import { useEffect, useRef, useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { Ionicons } from '@expo/vector-icons';
import { GoogleLogo } from '@/components/GoogleLogo';
import { router } from 'expo-router';

import { Button, Callout, Screen, Segmented, useTheme } from '@/components/ui';
import { trKey, useT } from '@/lib/i18n';
import { fontSize, spacing } from '@/constants/theme';
import {
  LoginButton,
  LoginButtonHalf,
  LoginButtonRow,
  LoginCard,
  LoginField,
} from '@/components/LoginCard';
import { assertAccountKind, persistAccountKind } from '@/lib/accountKind';
import type { AppMode } from '@/lib/appMode';
import {
  completeGoogleSignIn,
  getGoogleRedirectTo,
  mapAuthError,
  resendSignupEmail,
  signInWithPassword,
  signOut,
  signUpWithPassword,
  isDuplicateSignupUser,
  startGoogleSignIn,
  stashReferralCode,
  claimReferralCode,
} from '@/lib/auth';
import {
  applyWhatsAppOtpSession,
  requestWhatsAppOtp,
  verifyWhatsAppOtp,
} from '@/lib/auth-whatsapp';
import { getAppVersionLabel } from '@/lib/appVersion';
import { peekPendingAuthRedirect } from '@/lib/auth-redirect';
import { isValidRoMobile, normalizePhoneE164 } from '@/lib/phone';
import {
  clearRememberedCredentials,
  loadRememberedCredentials,
  saveRememberedCredentials,
} from '@/lib/rememberCredentials';

type Channel = 'email' | 'phone';
type Mode = 'login' | 'register';

const CHANNEL_VALUES: Channel[] = [
  'email',
  'phone',
];

const RESEND_COOLDOWN_SEC = 60;

function mapWhatsAppError(raw: string | null | undefined): string {
  if (!raw?.trim()) return trKey('auth.waGeneric');
  const m = raw.toLowerCase();

  if (m.includes('wrong_account_kind') || m.includes('cont e de') || m.includes('business account') || m.includes('client account')) {
    return raw;
  }
  if (
    m.includes('invalid_phone') ||
    m.includes('folosește un număr valid') ||
    m.includes('foloseste un numar valid') ||
    m.includes('use a valid number')
  ) {
    return trKey('auth.validNumber');
  }
  if (m.includes('invalid_code') || m.includes('cod greșit') || m.includes('cod gresit') || m.includes('wrong code')) {
    return m.includes('6 cifre') || m.includes('6 digits')
      ? trKey('auth.waCode6')
      : trKey('auth.waWrongCode');
  }
  if (m.includes('otp_expired') || m.includes('codul a expirat') || m.includes('cod expirat') || m.includes('code expired')) {
    return trKey('auth.waExpired');
  }
  if (m.includes('otp_already_used') || m.includes('deja folosit') || m.includes('already used')) {
    return trKey('auth.waUsed');
  }
  if (m.includes('otp_not_found')) {
    return trKey('auth.waNotFound');
  }
  if (
    m.includes('rate_limited') ||
    m.includes('too_many') ||
    m.includes('prea multe') ||
    m.includes('cooldown') ||
    m.includes('așteaptă') ||
    m.includes('asteapta') ||
    m.includes('too many') ||
    m.includes('wait 60 seconds')
  ) {
    return trKey('auth.waRateLimit');
  }
  if (m.includes('non-2xx') || m.includes('edge function')) {
    return trKey('auth.waServerError');
  }
  if (/[ăâîșțĂÂÎȘȚ]/.test(raw) || raw.includes('WhatsApp') || raw.includes('Twilio')) {
    return raw;
  }
  if (raw.includes(' ')) return raw;
  return trKey('auth.waFailed');
}

WebBrowser.maybeCompleteAuthSession();

export function AuthAccountForm({ kind }: { kind: AppMode }) {
  const t = useTheme();
  const tr = useT();
  const isBusiness = kind === 'business';
  const [channel, setChannel] = useState<Channel>('email');
  const [mode, setMode] = useState<Mode>('register');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberPassword, setRememberPassword] = useState(false);

  const [phone, setPhone] = useState('');
  const [whatsappConsent, setWhatsappConsent] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const otpPhoneRef = useRef<string | null>(null);
  const otpLock = useRef(false);

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activationEmail, setActivationEmail] = useState<string | null>(null);
  const [referralInput, setReferralInput] = useState('');
  const [resendBusy, setResendBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => {
      setCooldown((c) => (c <= 1 ? 0 : c - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [cooldown]);


  useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = await loadRememberedCredentials();
      if (cancelled || !saved) return;
      setEmail(saved.email);
      if (saved.password) setPassword(saved.password);
      setRememberPassword(true);
      setMode('login');
      setChannel('email');
    })();
    return () => {
      cancelled = true;
    };
  }, []);


  function clearFeedback() {
    setError(null);
    setMessage(null);
  }

  async function handleEmailSubmit(asMode: Mode = mode) {
    setMode(asMode);
    clearFeedback();
    const e = email.trim();
    if (!e) {
      setError(tr('auth.enterEmail'));
      return;
    }
    if (!password || password.length < 6) {
      setError(tr('auth.passwordMinLength'));
      return;
    }

    setLoading(true);
    if (asMode === 'register') {
      if (!isBusiness && referralInput.trim()) {
        await stashReferralCode(referralInput);
      }
      await signOut();
      const { data, error: err } = await signUpWithPassword(e, password, kind);
      if (err) {
        setLoading(false);
        setError(mapAuthError(err) ?? err.message);
        return;
      }
      if (isDuplicateSignupUser(data.user)) {
        // Supabase raspunde asa doar pentru un cont deja activat si nu trimite email,
        // deci nu afisam butonul de retrimitere a linkului.
        setLoading(false);
        setActivationEmail(null);
        setError(tr('auth.accountExists'));
        return;
      }
      setActivationEmail(e);
      setLoading(false);
      setMessage(
        tr('auth.activationSent', { email: e })
      );
      return;
    }

    const { error: err } = await signInWithPassword(e, password);
    if (err) {
      setLoading(false);
      const mapped = mapAuthError(err) ?? err.message;
      setError(mapped);
      if (
        mapped.toLowerCase().includes('nu e activat') ||
        mapped.toLowerCase().includes('not activated') ||
        (err.message || '').toLowerCase().includes('email not confirmed')
      ) {
        setActivationEmail(e);
      }
      return;
    }
    const check = await assertAccountKind(kind);
    setLoading(false);
    if (!check.ok) {
      setError(check.error);
      return;
    }
    await claimReferralCode();
    if (rememberPassword) {
      await saveRememberedCredentials(e, password);
    } else {
      await clearRememberedCredentials();
    }
    setMessage(tr('auth.signedIn'));
  }

  async function handleResendActivation() {
    const target = activationEmail || email.trim();
    if (!target) {
      setError(tr('auth.enterEmail'));
      return;
    }
    setResendBusy(true);
    clearFeedback();
    const { error: err } = await resendSignupEmail(target);
    setResendBusy(false);
    if (err) {
      setError(mapAuthError(err) ?? err.message);
      return;
    }
    setActivationEmail(target);
    setMessage(tr('auth.activationResent', { email: target }));
  }

  async function handleGoogleSignIn() {
    clearFeedback();
    setGoogleBusy(true);
    const { url, error: err } = await startGoogleSignIn(kind);
    if (err || !url) {
      setGoogleBusy(false);
      setError(
        err && /provider is not enabled|unsupported provider/i.test(err)
          ? tr('auth.errGoogleDisabled')
          : (mapAuthError(err ? new Error(err) : null) ?? tr('auth.errGoogleDisabled'))
      );
      return;
    }
    if (Platform.OS === 'web') {
      window.location.assign(url);
      return;
    }
    try {
      const result = await WebBrowser.openAuthSessionAsync(url, getGoogleRedirectTo());
      if (result.type !== 'success') {
        setGoogleBusy(false);
        setError(tr('auth.errGoogleCancelled') ?? 'Autentificarea a fost anulată.');
        return;
      }
      const done = await completeGoogleSignIn(result.url, kind);
      if (done.session) await claimReferralCode();
      setGoogleBusy(false);
      if (done.error || !done.session) {
        setError(done.error ?? tr('auth.errGoogleDisabled'));
        return;
      }
      setMessage(tr('auth.signedIn'));
    } catch (e) {
      setGoogleBusy(false);
      setError(tr('auth.errGoogleNetwork') ?? 'Eroare de rețea. Încearcă din nou.');
    }
  }

  async function handleSendWhatsAppOtp() {
    if (otpLock.current) return;
    clearFeedback();
    if (!whatsappConsent) {
      setError(tr('auth.waConsentNeeded'));
      return;
    }
    const normalized = normalizePhoneE164(phone);
    if (!normalized || !isValidRoMobile(normalized)) {
      setError(tr('auth.validNumber'));
      return;
    }

    otpLock.current = true;
    setLoading(true);
    const { data, error: err } = await requestWhatsAppOtp(phone);
    setLoading(false);
    otpLock.current = false;
    if (err) {
      setError(mapWhatsAppError(err));
      return;
    }

    setOtpSent(true);
    otpPhoneRef.current = normalized;
    setCooldown(RESEND_COOLDOWN_SEC);
    setMessage(
      data?.stub
        ? tr('auth.waNotConfigured')
        : tr('auth.waCodeSent')
    );
  }

  async function handleVerifyWhatsAppOtp() {
    if (otpLock.current) return;
    clearFeedback();
    const code = otpCode.replace(/\D/g, '');
    if (!/^\d{6}$/.test(code)) {
      setError(tr('auth.waCode6'));
      return;
    }

    otpLock.current = true;
    setLoading(true);
    const phoneToUse = otpPhoneRef.current || phone;
    const { data, error: err } = await verifyWhatsAppOtp(phoneToUse, code, kind);
    if (err || !data) {
      otpLock.current = false;
      setLoading(false);
      setError(mapWhatsAppError(err));
      return;
    }

    const { error: sessionErr } = await applyWhatsAppOtpSession(data);
    if (sessionErr) {
      otpLock.current = false;
      setLoading(false);
      setError(mapWhatsAppError(sessionErr.message));
      return;
    }

    if (data.created) {
      await persistAccountKind(kind);
      await claimReferralCode();
    } else {
      const check = await assertAccountKind(kind);
      if (!check.ok) {
        otpLock.current = false;
        setLoading(false);
        setError(check.error);
        return;
      }
    }
    otpLock.current = false;
    setLoading(false);
    setMessage(tr('auth.signedIn'));
  }

  return (
    <Screen scroll bottomInset={spacing['3xl']}>
      <Button
        label={
          peekPendingAuthRedirect()
            ? tr('auth.backToBooking')
            : tr('auth.backToAccountChoice')
        }
        variant="ghost"
        size="sm"
        icon="arrow-back-outline"
        onPress={() => {
          const pending = peekPendingAuthRedirect();
          if (pending) {
            router.replace(pending as never);
            return;
          }
          router.replace('/(auth)/login');
        }}
        style={styles.switchRole}
      />

      <Segmented
        value={channel}
        onChange={setChannel}
        options={CHANNEL_VALUES.map((value) => ({
          value,
          label: value === 'phone' ? tr('auth.channelPhone') : 'Email',
        }))}
      />

      <LoginCard heading={isBusiness ? tr('auth.businessAccountTitle') : tr('auth.clientAccountTitle')}>
        {channel === 'email' ? (
          <>
            <LoginField
              icon="mail-outline"
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              autoCorrect={false}
              placeholder="Email"
              value={email}
              onChangeText={setEmail}
              editable={!loading}
            />
            <LoginField
              icon="lock-closed-outline"
              secureTextEntry
              autoComplete={mode === 'register' ? 'new-password' : 'password'}
              placeholder={tr('auth.password')}
              value={password}
              onChangeText={setPassword}
              editable={!loading}
              onSubmitEditing={() => void handleEmailSubmit()}
              returnKeyType="go"
            />
            {!isBusiness && mode === 'register' ? (
              <LoginField
                icon="people-outline"
                autoCapitalize="characters"
                autoCorrect={false}
                placeholder={tr('ref.field')}
                value={referralInput}
                onChangeText={setReferralInput}
                editable={!loading}
              />
            ) : null}


            <Pressable
              onPress={() => setRememberPassword((v) => !v)}
              style={[
                styles.consentRow,
                {
                  borderColor: rememberPassword ? t.colors.accent : t.colors.border,
                  backgroundColor: rememberPassword
                    ? t.colors.accentSoft ?? t.colors.surfaceMuted
                    : t.colors.surface,
                },
              ]}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: rememberPassword }}
              accessibilityLabel={tr('auth.rememberPassword')}
            >
              <View
                style={[
                  styles.checkbox,
                  {
                    borderColor: t.colors.border,
                    backgroundColor: rememberPassword ? t.colors.accent : 'transparent',
                  },
                ]}
              >
                {rememberPassword ? (
                  <Ionicons name="checkmark" size={14} color={t.colors.onAccent} />
                ) : null}
              </View>
              <Text style={[styles.consentText, { color: t.colors.text }]}>
                {tr('auth.rememberPassword')}
              </Text>
            </Pressable>

            {error ? <Callout tone="danger">{error}</Callout> : null}
            {message ? <Callout tone="success">{message}</Callout> : null}

            <LoginButtonRow>
              <LoginButtonHalf>
                <LoginButton
                  label={tr('auth.signIn')}
                  onPress={() => void handleEmailSubmit('login')}
                  disabled={loading}
                  loading={loading && mode === 'login'}
                />
              </LoginButtonHalf>
              <LoginButtonHalf>
                <LoginButton
                  label={tr('auth.createAccount')}
                  onPress={() => void handleEmailSubmit('register')}
                  disabled={loading}
                  loading={loading && mode === 'register'}
                />
              </LoginButtonHalf>
            </LoginButtonRow>
            <LoginButton
              label={tr('auth.googleContinue')}
              leading={<GoogleLogo size={18} />}
              onPress={() => void handleGoogleSignIn()}
              disabled={loading || googleBusy}
              loading={googleBusy}
            />
            <LoginButton
              label={tr('auth.recoverPassword')}
              tone="danger"
              onPress={() => router.push('/(auth)/forgot-password')}
              disabled={loading}
            />
            {activationEmail ? (
              <LoginButton
                label={resendBusy ? tr('common.sending') : tr('auth.resendActivation')}
                onPress={() => void handleResendActivation()}
                disabled={loading || resendBusy}
              />
            ) : null}
          </>
        ) : (
          <>
            <LoginField
              icon="logo-whatsapp"
              keyboardType="phone-pad"
              autoComplete="tel"
              autoCorrect={false}
              placeholder={tr('auth.channelPhone')}
              value={phone}
              onChangeText={setPhone}
              onBlur={() => {
                if (!otpSent || !otpPhoneRef.current) return;
                const n = normalizePhoneE164(phone);
                if (n !== otpPhoneRef.current) {
                  setOtpSent(false);
                  setOtpCode('');
                  otpPhoneRef.current = null;
                }
              }}
              editable={!loading}
            />

            {!otpSent ? (
              <>
                <Pressable
                  onPress={() => setWhatsappConsent((v) => !v)}
                  style={[styles.consentRow, { borderColor: whatsappConsent ? t.colors.accent : t.colors.border, backgroundColor: whatsappConsent ? t.colors.accentSoft ?? t.colors.surfaceMuted : t.colors.surface }]}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: whatsappConsent }}
                >
                  <View style={[styles.checkbox, { borderColor: t.colors.border, backgroundColor: whatsappConsent ? t.colors.accent : 'transparent' }]}>
                    {whatsappConsent ? <Ionicons name="checkmark" size={14} color={t.colors.onAccent} /> : null}
                  </View>
                  <Text style={[styles.consentText, { color: t.colors.text }]}>
                    {tr('auth.waConsentText')}{' '}
                    <Text onPress={() => Linking.openURL('https://programari.expo.app/privacy')} style={[styles.consentLink, { color: t.colors.accent }]}>
                      {tr('auth.privacyPolicy')}
                    </Text>
                  </Text>
                </Pressable>
                {error ? <Callout tone="danger">{error}</Callout> : null}
                {message ? <Callout tone="success">{message}</Callout> : null}
                <LoginButton
                  label={tr('auth.sendWaCode')}
                  onPress={() => void handleSendWhatsAppOtp()}
                  disabled={loading}
                  loading={loading}
                />
              </>
            ) : (
              <>
                <LoginField
                  icon="keypad-outline"
                  keyboardType="number-pad"
                  autoComplete="one-time-code"
                  autoCorrect={false}
                  placeholder={tr('auth.code')}
                  maxLength={6}
                  value={otpCode}
                  onChangeText={setOtpCode}
                  editable={!loading}
                  onSubmitEditing={() => void handleVerifyWhatsAppOtp()}
                  returnKeyType="go"
                />

                {error ? <Callout tone="danger">{error}</Callout> : null}
                {message ? <Callout tone="success">{message}</Callout> : null}

                <LoginButton
                  label={tr('auth.signIn')}
                  onPress={() => void handleVerifyWhatsAppOtp()}
                  disabled={loading}
                  loading={loading}
                />

                <LoginButton
                  label={
                    cooldown > 0 ? tr('auth.resendCodeIn', { s: cooldown }) : tr('auth.resendWaCode')
                  }
                  onPress={() => void handleSendWhatsAppOtp()}
                  disabled={loading || cooldown > 0}
                />
              </>
            )}
          </>
        )}
      </LoginCard>

      <Text style={[styles.version, { color: t.colors.textMuted }]}>
        {getAppVersionLabel()}
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  version: {
    fontSize: fontSize.xs,
    textAlign: 'center',
    fontWeight: '600',
    letterSpacing: 0.3,
    marginBottom: spacing.md,
    marginTop: spacing.md,
  },
  switchRole: { alignSelf: 'center', marginBottom: spacing.md },
  consentRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 12, borderWidth: 1, borderRadius: 12, marginTop: 8 },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  consentText: { flex: 1, minWidth: 0, fontSize: 13, lineHeight: 18 },
  consentLink: { textDecorationLine: 'underline', fontWeight: '600' },
});
