import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { Button, Callout, Field, Screen, Segmented, useTheme } from '@/components/ui';
import { fontSize, radius, spacing } from '@/constants/theme';
import {
  mapAuthError,
  signInWithPassword,
  signUpWithPassword,
} from '@/lib/auth';
import {
  applyWhatsAppOtpSession,
  requestWhatsAppOtp,
  verifyWhatsAppOtp,
} from '@/lib/auth-whatsapp';
import { isValidRoMobile, normalizePhoneE164 } from '@/lib/phone';

type Channel = 'email' | 'phone';
type Mode = 'login' | 'register';

const CHANNELS: { value: Channel; label: string }[] = [
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Telefon' },
];

const MODES: { value: Mode; label: string }[] = [
  { value: 'login', label: 'Intră în cont' },
  { value: 'register', label: 'Cont nou' },
];

const RESEND_COOLDOWN_SEC = 45;

function mapWhatsAppError(raw: string | null | undefined): string {
  if (!raw?.trim()) return 'A apărut o eroare. Încearcă din nou.';
  const m = raw.toLowerCase();
  if (
    m.includes('valid') ||
    m.includes('număr') ||
    m.includes('numar') ||
    m.includes('07') ||
    m.includes('+40')
  ) {
    return 'Folosește un număr valid (07xxxxxxxx sau +40...).';
  }
  if (m.includes('6 cifre') || (m.includes('cod') && m.includes('cifre'))) {
    return 'Codul trebuie să aibă 6 cifre.';
  }
  if (
    m.includes('invalid') ||
    m.includes('incorrect') ||
    m.includes('wrong') ||
    m.includes('greșit') ||
    m.includes('gresit')
  ) {
    return 'Cod greșit. Verifică mesajul WhatsApp și încearcă din nou.';
  }
  if (
    m.includes('expired') ||
    m.includes('expirat') ||
    m.includes('expir')
  ) {
    return 'Codul a expirat. Cere un cod nou.';
  }
  if (
    m.includes('rate') ||
    m.includes('too many') ||
    m.includes('prea multe') ||
    m.includes('cooldown') ||
    m.includes('așteaptă') ||
    m.includes('asteapta')
  ) {
    return 'Prea multe încercări. Așteaptă câteva minute.';
  }
  if (m.includes('trimite') || m.includes('send') || m.includes('stub')) {
    return raw;
  }
  // Backend already returns RO hints often — keep them if readable.
  if (/[ăâîșțĂÂÎȘȚ]/.test(raw) || raw.includes(' ')) return raw;
  return 'Nu am putut finaliza autentificarea. Încearcă din nou.';
}

export default function LoginScreen() {
  const t = useTheme();
  const [channel, setChannel] = useState<Channel>('email');
  const [mode, setMode] = useState<Mode>('login');

  // Email path
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // Phone / WhatsApp OTP path
  const [phone, setPhone] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [stubSend, setStubSend] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  function switchChannel(next: Channel) {
    setChannel(next);
    clearFeedback();
  }

  function switchMode(next: Mode) {
    setMode(next);
    clearFeedback();
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
      const { data, error: err } = await signUpWithPassword(e, password);
      setLoading(false);
      if (err) {
        setError(mapAuthError(err) ?? err.message);
        return;
      }
      if (data.session) {
        setMessage('Cont creat. Ești autentificat.');
        return;
      }
      setMessage(
        'Cont creat. Dacă ți se cere confirmare pe email: fie apeși linkul DOAR după ce ai setat Site URL la app, fie în Supabase dezactivezi „Confirm email” (Auth → Providers → Email). Apoi folosește „Intră în cont”.'
      );
      setMode('login');
      return;
    }

    const { error: err } = await signInWithPassword(e, password);
    setLoading(false);
    if (err) {
      setError(mapAuthError(err) ?? err.message);
      return;
    }
    setMessage('Autentificare reușită.');
  }

  async function handleSendWhatsAppOtp() {
    clearFeedback();
    const normalized = normalizePhoneE164(phone);
    if (!normalized || !isValidRoMobile(normalized)) {
      setError('Folosește un număr valid (07xxxxxxxx sau +40...).');
      return;
    }

    setLoading(true);
    const { data, error: err } = await requestWhatsAppOtp(phone);
    setLoading(false);
    if (err) {
      setError(mapWhatsAppError(err));
      return;
    }

    setOtpSent(true);
    setStubSend(data?.stub === true);
    setCooldown(RESEND_COOLDOWN_SEC);
    setMessage(
      data?.stub
        ? null
        : 'Ți-am trimis un cod pe WhatsApp. Introdu-l mai jos.'
    );
  }

  async function handleVerifyWhatsAppOtp() {
    clearFeedback();
    const code = otpCode.trim();
    if (!/^\d{6}$/.test(code)) {
      setError('Codul trebuie să aibă 6 cifre.');
      return;
    }

    setLoading(true);
    const { data, error: err } = await verifyWhatsAppOtp(phone, code);
    if (err || !data) {
      setLoading(false);
      setError(mapWhatsAppError(err));
      return;
    }

    const { error: sessionErr } = await applyWhatsAppOtpSession(data);
    setLoading(false);
    if (sessionErr) {
      setError(mapWhatsAppError(sessionErr.message));
      return;
    }
    setMessage('Autentificare reușită.');
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Screen scroll bottomInset={spacing['3xl']}>
        <View style={styles.hero}>
          <View style={[styles.logo, { backgroundColor: t.colors.accent }, t.shadows.accent]}>
            <Ionicons name="calendar" size={30} color={t.colors.onAccent} />
          </View>
          <Text style={[styles.title, { color: t.colors.text }]}>Programări</Text>
          <Text style={[styles.subtitle, { color: t.colors.textMuted }]}>
            Agenda ta, într-un singur loc
          </Text>
        </View>

        <Segmented value={channel} onChange={switchChannel} options={CHANNELS} />

        {channel === 'email' ? (
          <>
            <Segmented value={mode} onChange={switchMode} options={MODES} />

            <Field
              label="Email"
              icon="mail-outline"
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              autoCorrect={false}
              placeholder="email@exemplu.ro"
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
              onSubmitEditing={handleEmailSubmit}
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
              onPress={handleEmailSubmit}
              loading={loading}
              style={styles.submit}
            />

            <View style={[styles.hintBox, { backgroundColor: t.colors.surfaceMuted }]}>
              <Ionicons
                name="information-circle-outline"
                size={16}
                color={t.colors.textMuted}
                style={styles.hintIcon}
              />
              <Text style={[styles.hint, { color: t.colors.textMuted }]}>
                Emailul de la Supabase („Your sign-in link”) duce la localhost:3000 pe telefon —
                nu-l folosi. Introdu emailul și parola aici.{'\n\n'}
                La dezvoltare, în Supabase: Auth → Providers → Email → dezactivează „Confirm
                email”.
              </Text>
            </View>
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
              hint="Primești un cod pe WhatsApp. Contul se creează automat dacă nu există."
              value={phone}
              onChangeText={(v) => {
                setPhone(v);
                if (otpSent) {
                  setOtpSent(false);
                  setStubSend(false);
                  setOtpCode('');
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
                  onPress={handleSendWhatsAppOtp}
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
                  onSubmitEditing={handleVerifyWhatsAppOtp}
                  returnKeyType="go"
                />

                {error ? <Callout tone="danger">{error}</Callout> : null}
                {message ? <Callout tone="success">{message}</Callout> : null}

                <Button
                  label="Intră în cont"
                  icon="log-in-outline"
                  onPress={handleVerifyWhatsAppOtp}
                  loading={loading}
                  style={styles.submit}
                />

                <Button
                  label={
                    cooldown > 0
                      ? `Retrimite cod (${cooldown}s)`
                      : 'Retrimite cod pe WhatsApp'
                  }
                  variant="ghost"
                  icon="refresh-outline"
                  onPress={handleSendWhatsAppOtp}
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
                Autentificare cu număr de telefon prin WhatsApp. Nu e nevoie de parolă — același
                număr te autentifică sau îți creează contul.
              </Text>
            </View>
          </>
        )}
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
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
    marginBottom: spacing.md,
  },
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