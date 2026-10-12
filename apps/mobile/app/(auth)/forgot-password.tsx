import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';

import { Button, Callout, Field, Screen, useTheme } from '@/components/ui';
import { useT } from '@/lib/i18n';
import { fontSize, spacing } from '@/constants/theme';
import { mapAuthError, resetPasswordForEmail } from '@/lib/auth';

export default function ForgotPasswordScreen() {
  const t = useTheme();
  const tr = useT();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setError(null);
    const e = email.trim();
    if (!e) {
      setError(tr('auth.enterEmail'));
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

  const form = (
    <Screen
        title={tr('auth.resetPassword')}
        onBack={() => router.replace('/(auth)/login')}
        scroll
        bottomInset={spacing['3xl']}
      >
        <Text style={[styles.lead, { color: t.colors.textMuted }]}>
          {tr('auth.forgotLead')}
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
            {tr('auth.forgotSent')}
            
          </Callout>
        ) : null}

        {!sent ? (
          <Button
            label={tr('auth.sendResetLink')}
            icon="send-outline"
            onPress={handleSubmit}
            loading={loading}
            style={styles.submit}
          />
        ) : null}

        <Button
          label={tr('auth.backToLogin')}
          variant="ghost"
          icon="arrow-back-outline"
          onPress={() => router.replace('/(auth)/login')}
          style={styles.back}
        />
      </Screen>
  );

  if (Platform.OS === 'ios') {
    return (
      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        {form}
      </KeyboardAvoidingView>
    );
  }
  return <View style={styles.flex}>{form}</View>;
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
