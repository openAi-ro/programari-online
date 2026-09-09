import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Button, Callout, Field, Screen, Segmented, useTheme } from '@/components/ui';
import { fontSize, radius, spacing } from '@/constants/theme';
import {
  mapAuthError,
  signInWithPassword,
  signUpWithPassword,
} from '@/lib/auth';

type Mode = 'login' | 'register';

const MODES: { value: Mode; label: string }[] = [
  { value: 'login', label: 'Intră în cont' },
  { value: 'register', label: 'Cont nou' },
];

export default function LoginScreen() {
  const t = useTheme();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setError(null);
    setMessage(null);

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
      // Dacă confirm email e dezactivat, avem sesiune imediat
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

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setMessage(null);
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
          onSubmitEditing={handleSubmit}
          returnKeyType="go"
        />

        {error ? <Callout tone="danger">{error}</Callout> : null}
        {message ? <Callout tone="success">{message}</Callout> : null}

        <Button
          label={mode === 'login' ? 'Intră în cont' : 'Creează cont'}
          icon={mode === 'login' ? 'log-in-outline' : 'person-add-outline'}
          onPress={handleSubmit}
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
  submit: { marginTop: spacing.sm },
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
