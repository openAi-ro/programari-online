import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { Button, Callout, Field, Screen, Segmented, useTheme } from '@/components/ui';
import { fontSize, radius, spacing } from '@/constants/theme';
import { InstallQrCard } from '@/components/InstallQrCard';
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

type Channel = 'email' | 'phone';
type Mode = 'login' | 'register';

const CHANNELS: { value: Channel; label: string }[] = [
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Telefon' },
];

const MODES: { value: Mode; label: string }[] = [
  { value: 'register', label: 'Creează cont' },
  { value: 'login', label: 'Intră în cont' },
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

  const [phone, setPhone] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [stubSend, setStubSend] = useState(false);
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

  function clearFeedback() {
    setError(null);
    setMessage(null);
  }

  async function handleEmailSubmit() {
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
    if (mode === 'register') {
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
    setStubSend(data?.stub === true);
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
      <View style={styles.hero}>
        <View style={[styles.logo, { backgroundColor: t.colors.accent }, t.shadows.accent]}>
          <Ionicons
            name={isBusiness ? 'storefront-outline' : 'person-outline'}
            size={30}
            color={t.colors.onAccent}
          />
        </View>
        <Text style={[styles.title, { color: t.colors.text }]}>
          {isBusiness ? 'Cont business' : 'Cont client'}
        </Text>
        <Text style={[styles.subtitle, { color: t.colors.textMuted }]}>
          {isBusiness
            ? 'Agenda, cereri, clienți, echipă, servicii, QR și rapoarte'
            : 'Rezervă un loc, scanează QR-ul și vezi programările tale'}
        </Text>
        <Text style={[styles.version, { color: t.colors.textMuted }]}>
          {getAppVersionLabel()}
        </Text>
      </View>

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

      {channel === 'email' ? (
        <>
          <Segmented
            value={mode}
            onChange={(next) => {
              setMode(next);
              clearFeedback();
            }}
            options={MODES}
          />

          <Field
            label="Email"
            icon="mail-outline"
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            autoCorrect={false}
            placeholder="email@exemplu.ro"
            hint={
              mode === 'register'
                ? 'Îți trimitem un link de activare pe această adresă. Contul se activează doar după ce apeși linkul.'
                : undefined
            }
            value={email}
            onChangeText={setEmail}
            editable={!loading}
          />
          <Field
            label="Parolă"
            icon="lock-closed-outline"
            secureTextEntry
            autoComplete={mode === 'register' ? 'new-password' : 'password'}
            placeholder="Minim 6 caractere"
            value={password}
            onChangeText={setPassword}
            editable={!loading}
            onSubmitEditing={() => void handleEmailSubmit()}
            returnKeyType="go"
          />

          {mode === 'login' ? (
            <Button
              label="Ai uitat parola?"
              variant="ghost"
              size="sm"
              fullWidth={false}
              onPress={() => router.push('/(auth)/forgot-password')}
              style={styles.forgot}
              disabled={loading}
            />
          ) : null}

          {error ? <Callout tone="danger">{error}</Callout> : null}
          {message ? <Callout tone="success">{message}</Callout> : null}

          <Button
            label={mode === 'login' ? 'Intră în cont' : 'Creează cont'}
            icon={mode === 'login' ? 'log-in-outline' : 'person-add-outline'}
            onPress={() => void handleEmailSubmit()}
            loading={loading}
            style={styles.submit}
          />
          {activationEmail ? (
            <Button
              label={resendBusy ? 'Se trimite…' : 'Retrimite linkul de activare'}
              variant="ghost"
              icon="mail-outline"
              onPress={() => void handleResendActivation()}
              loading={resendBusy}
              disabled={loading || resendBusy}
              style={styles.resend}
            />
          ) : null}
        </>
      ) : (
        <>
          <Field
            label="Telefon"
            icon="logo-whatsapp"
            keyboardType="phone-pad"
            autoComplete="tel"
            autoCorrect={false}
            placeholder="07xxxxxxxx sau +407xxxxxxxx"
            hint="Primești un cod pe WhatsApp. Dacă nu ai cont, se creează automat ca acest tip."
            value={phone}
            onChangeText={setPhone}
            onBlur={() => {
              if (!otpSent || !otpPhoneRef.current) return;
              const n = normalizePhoneE164(phone);
              if (n !== otpPhoneRef.current) {
                setOtpSent(false);
                setStubSend(false);
                setOtpCode('');
                otpPhoneRef.current = null;
              }
            }}
            editable={!loading}
          />

          {!otpSent ? (
            <>
              {error ? <Callout tone="danger">{error}</Callout> : null}
              {message ? <Callout tone="success">{message}</Callout> : null}
              <Button
                label="Trimite cod pe WhatsApp"
                icon="chatbubble-ellipses-outline"
                onPress={() => void handleSendWhatsAppOtp()}
                loading={loading}
                style={styles.submit}
              />
            </>
          ) : (
            <>
              {stubSend ? (
                <Callout tone="warning" title="Trimitere simulată">
                  Serverul a simulat trimiterea (stub). Folosește codul din logurile Edge
                  Function / mediul de dezvoltare.
                </Callout>
              ) : null}

              <Field
                label="Cod din WhatsApp"
                icon="keypad-outline"
                keyboardType="number-pad"
                autoComplete="one-time-code"
                autoCorrect={false}
                placeholder="6 cifre"
                maxLength={6}
                value={otpCode}
                onChangeText={setOtpCode}
                editable={!loading}
                onSubmitEditing={() => void handleVerifyWhatsAppOtp()}
                returnKeyType="go"
              />

              {error ? <Callout tone="danger">{error}</Callout> : null}
              {message ? <Callout tone="success">{message}</Callout> : null}

              <Button
                label="Intră în cont"
                icon="log-in-outline"
                onPress={() => void handleVerifyWhatsAppOtp()}
                loading={loading}
                style={styles.submit}
              />

              <Button
                label={
                  cooldown > 0 ? `Retrimite cod (${cooldown}s)` : 'Retrimite cod pe WhatsApp'
                }
                variant="ghost"
                icon="refresh-outline"
                onPress={() => void handleSendWhatsAppOtp()}
                disabled={loading || cooldown > 0}
                style={styles.resend}
              />
            </>
          )}

          <View style={[styles.hintBox, { backgroundColor: t.colors.surfaceMuted }]}>
            <Ionicons
              name="logo-whatsapp"
              size={16}
              color={t.colors.textMuted}
              style={styles.hintIcon}
            />
            <Text style={[styles.hint, { color: t.colors.textMuted }]}>
              Autentificare cu număr de telefon prin WhatsApp. Același număr ține minte dacă
              ești client sau business — nu poți intra pe ușa cealaltă.
            </Text>
          </View>
        </>
      )}

      <InstallQrCard />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  logo: {
    width: 64,
    height: 64,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  title: {
    fontSize: fontSize['2xl'],
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: fontSize.md,
    textAlign: 'center',
  },
  version: {
    fontSize: fontSize.xs,
    textAlign: 'center',
    fontWeight: '600',
    letterSpacing: 0.3,
    marginBottom: spacing.md,
    marginTop: spacing.xs,
  },
  switchRole: { alignSelf: 'center', marginBottom: spacing.md },
  forgot: { alignSelf: 'flex-end', marginTop: -spacing.xs, marginBottom: spacing.xs },
  submit: { marginTop: spacing.sm },
  resend: { marginTop: spacing.xs },
  hintBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    marginTop: spacing.lg,
  },
  hintIcon: { marginTop: 1 },
  hint: { flex: 1, fontSize: fontSize.xs, lineHeight: 18 },
});
