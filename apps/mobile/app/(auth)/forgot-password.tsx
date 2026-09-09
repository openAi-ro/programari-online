import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
} from 'react-native';
import { router } from 'expo-router';

import { Button, Callout, Field, Screen, useTheme } from '@/components/ui';
import { fontSize, spacing } from '@/constants/theme';
import { mapAuthError, resetPasswordForEmail } from '@/lib/auth';

export default function ForgotPasswordScreen() {
  const t = useTheme();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setError(null);
    const e = email.trim();
    if (!e) {
      setError('Introdu adresa de email.');
      return;
    }

    setLoading(true);
    const { error: err } = await resetPasswordForEmail(e);
    setLoading(false);
    if (err) {
      setError(mapAuthError(err) ?? err.message);
      return;
    }
    // Nu divulgăm dacă emailul există — mesaj generic de succes.
    setSent(true);
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Screen
        title="Resetare parolă"
        onBack={() => router.replace('/(auth)/login')}
        scroll
        bottomInset={spacing['3xl']}
      >
        <Text style={[styles.lead, { color: t.colors.textMuted }]}>
          Introdu emailul contului. Îți trimitem un link pentru a seta o parolă nouă.
        </Text>

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
          editable={!loading && !sent}
          onSubmitEditing={handleSubmit}
          returnKeyType="send"
        />

        {error ? <Callout tone="danger">{error}</Callout> : null}
        {sent ? (
          <Callout tone="success">
            Dacă există un cont cu acest email, vei primi un link de resetare. Verifică și
            folderul Spam. Deschide linkul pe același dispozitiv pe care folosești app-ul.
          </Callout>
        ) : null}

        {!sent ? (
          <Button
            label="Trimite link de resetare"
            icon="send-outline"
            onPress={handleSubmit}
            loading={loading}
            style={styles.submit}
          />
        ) : null}

        <Button
          label="Înapoi la autentificare"
          variant="ghost"
          icon="arrow-back-outline"
          onPress={() => router.replace('/(auth)/login')}
          style={styles.back}
        />
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  lead: {
    fontSize: fontSize.md,
    lineHeight: 22,
    marginBottom: spacing.md,
  },
  submit: { marginTop: spacing.sm },
  back: { marginTop: spacing.sm },
});
