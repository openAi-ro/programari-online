import { useEffect, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { Button, Callout, Screen, Segmented, useTheme } from '@/components/ui';
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
  mapAuthError,
  resendSignupEmail,
  signInWithPassword,
  signOut,
  signUpWithPassword,
  isDuplicateSignupUser,
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

const CHANNELS: { value: Channel; label: string }[] = [
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Telefon' },
];

const RESEND_COOLDOWN_SEC = 60;

function mapWhatsAppError(raw: string | null | undefined): string {
  if (!raw?.trim()) return 'A apărut o eroare. Încearcă din nou.';
  const m = raw.toLowerCase();

  if (m.includes('wrong_account_kind') || m.includes('cont e de')) {
    return raw;
  }
  if (
    m.includes('invalid_phone') ||
    m.includes('folosește un număr valid') ||
    m.includes('foloseste un numar valid')
  ) {
    return 'Folosește un număr valid (07xxxxxxxx sau +40...).';
  }
  if (m.includes('invalid_code') || m.includes('cod greșit') || m.includes('cod gresit')) {
    return m.includes('6 cifre')
      ? 'Codul trebuie să aibă 6 cifre.'
      : 'Cod greșit. Verifică mesajul WhatsApp și încearcă din nou.';
  }
  if (m.includes('otp_expired') || m.includes('codul a expirat') || m.includes('cod expirat')) {
    return 'Codul a expirat. Cere un cod nou din aplicație (nu folosi un mesaj vechi).';
  }
  if (m.includes('otp_already_used') || m.includes('deja folosit')) {
    return 'Acest cod a fost deja folosit. Cere un cod nou.';
  }
  if (m.includes('otp_not_found')) {
    return 'Nu am găsit un cod pentru acest număr. Cere un cod nou.';
  }
  if (
    m.includes('rate_limited') ||
    m.includes('too_many') ||
    m.includes('prea multe') ||
    m.includes('cooldown') ||
    m.includes('așteaptă') ||
    m.includes('asteapta')
  ) {
    return 'Prea multe încercări. Așteaptă un minut și cere un cod nou.';
  }
  if (m.includes('non-2xx') || m.includes('edge function')) {
    return 'Serverul WhatsApp a răspuns cu eroare. Verifică secrets și deploy-ul funcțiilor.';
  }
  if (/[ăâîșțĂÂÎȘȚ]/.test(raw) || raw.includes('WhatsApp') || raw.includes('Twilio')) {
    return raw;
  }
  if (raw.includes(' ')) return raw;
  return 'Nu am putut finaliza autentificarea. Încearcă din nou.';
}

export function AuthAccountForm({ kind }: { kind: AppMode }) {
  const t = useTheme();
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
  const [resendBusy, setResendBusy] = useState(false);

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
      setError('Introdu adresa de email.');
      return;
    }
    if (!password || password.length < 6) {
      setError('Parola trebuie să aibă cel puțin 6 caractere.');
      return;
    }

    setLoading(true);
    if (asMode === 'register') {
      await signOut();
      const { data, error: err } = await signUpWithPassword(e, password, kind);
      if (err) {
        setLoading(false);
        setError(mapAuthError(err) ?? err.message);
        return;
      }
      if (isDuplicateSignupUser(data.user)) {
        setLoading(false);
        setActivationEmail(e);
        setError(
          'Contul există deja. Folosește „Intră în cont”. Dacă nu e activat, retrimite linkul de mai jos.'
        );
        return;
      }
      setActivationEmail(e);
      setLoading(false);
      setMessage(
        `Ți-am trimis un link de activare la ${e}. Deschide-l din email, apasă linkul, apoi revino și alege „Intră în cont”. Fără link, nu poți intra.`
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
    if (rememberPassword) {
      await saveRememberedCredentials(e, password);
    } else {
      await clearRememberedCredentials();
    }
    setMessage('Autentificare reușită.');
  }

  async function handleResendActivation() {
    const target = activationEmail || email.trim();
    if (!target) {
      setError('Introdu adresa de email.');
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
    setMessage(`Am retrimis linkul de activare la ${target}.`);
  }

  async function handleSendWhatsAppOtp() {
    if (otpLock.current) return;
    clearFeedback();
    if (!whatsappConsent) {
      setError('Bifeaza acordul pentru a primi codul pe WhatsApp.');
      return;
    }
    const normalized = normalizePhoneE164(phone);
    if (!normalized || !isValidRoMobile(normalized)) {
      setError('Folosește un număr valid (07xxxxxxxx sau +40...).');
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
        ? 'WhatsApp nu e configurat pe server — codul nu a fost trimis. Setează secrets Meta/Twilio.'
        : 'Ți-am trimis un cod pe WhatsApp. Introdu-l mai jos.'
    );
  }

  async function handleVerifyWhatsAppOtp() {
    if (otpLock.current) return;
    clearFeedback();
    const code = otpCode.replace(/\D/g, '');
    if (!/^\d{6}$/.test(code)) {
      setError('Codul trebuie să aibă 6 cifre.');
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
    setMessage('Autentificare reușită.');
  }

  return (
    <Screen scroll bottomInset={spacing['3xl']}>
      <Button
        label={
          peekPendingAuthRedirect()
            ? 'Înapoi la programare'
            : 'Înapoi la alegerea contului'
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

      <Segmented value={channel} onChange={setChannel} options={CHANNELS} />

      <LoginCard heading={isBusiness ? 'Cont business' : 'Cont client'}>
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
              placeholder="Parola"
              value={password}
              onChangeText={setPassword}
              editable={!loading}
              onSubmitEditing={() => void handleEmailSubmit()}
              returnKeyType="go"
            />


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
              accessibilityLabel="Reține parola"
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
                Reține parola
              </Text>
            </Pressable>

            {error ? <Callout tone="danger">{error}</Callout> : null}
            {message ? <Callout tone="success">{message}</Callout> : null}

            <LoginButtonRow>
              <LoginButtonHalf>
                <LoginButton
                  label="Intră în cont"
                  onPress={() => void handleEmailSubmit('login')}
                  disabled={loading}
                  loading={loading && mode === 'login'}
                />
              </LoginButtonHalf>
              <LoginButtonHalf>
                <LoginButton
                  label="Creează cont"
                  onPress={() => void handleEmailSubmit('register')}
                  disabled={loading}
                  loading={loading && mode === 'register'}
                />
              </LoginButtonHalf>
            </LoginButtonRow>
            <LoginButton
              label="Recuperează parola"
              tone="danger"
              onPress={() => router.push('/(auth)/forgot-password')}
              disabled={loading}
            />
            {activationEmail ? (
              <LoginButton
                label={resendBusy ? 'Se trimite…' : 'Retrimite linkul de activare'}
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
              placeholder="Telefon"
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
                    Sunt de acord sa primesc codul de verificare pe WhatsApp la numarul introdus.{' '}
                    <Text onPress={() => Linking.openURL('https://programari.expo.app/privacy')} style={[styles.consentLink, { color: t.colors.accent }]}>
                      Politica de confidențialitate
                    </Text>
                  </Text>
                </Pressable>
                {error ? <Callout tone="danger">{error}</Callout> : null}
                {message ? <Callout tone="success">{message}</Callout> : null}
                <LoginButton
                  label="Trimite cod pe WhatsApp"
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
                  placeholder="Cod"
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
                  label="Intră în cont"
                  onPress={() => void handleVerifyWhatsAppOtp()}
                  disabled={loading}
                  loading={loading}
                />

                <LoginButton
                  label={
                    cooldown > 0 ? `Retrimite cod (${cooldown}s)` : 'Retrimite cod pe WhatsApp'
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
