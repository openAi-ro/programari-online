import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  View,
} from 'react-native';
import { router } from 'expo-router';

import {
  Button,
  Callout,
  ErrorState,
  Field,
  LoadingScreen,
  Screen,
} from '@/components/ui';
import { spacing } from '@/constants/theme';
import { getSession, mapAuthError, updatePassword } from '@/lib/auth';

export default function ResetPasswordScreen() {
  const [checking, setChecking] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const session = await getSession();
      if (cancelled) return;
      setHasSession(!!session);
      setChecking(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit() {
    setError(null);
    if (!password || password.length < 6) {
      setError('Parola trebuie să aibă cel puțin 6 caractere.');
      return;
    }
    if (password !== confirm) {
      setError('Parolele nu coincid.');
      return;
    }

    setLoading(true);
    const { error: err } = await updatePassword(password);
    setLoading(false);
    if (err) {
      setError(mapAuthError(err) ?? err.message);
      return;
    }
    setDone(true);
    setTimeout(() => {
      router.replace('/(app)/home');
    }, 1500);
  }

  if (checking) {
    return <LoadingScreen label="Se verifică sesiunea…" />;
  }

  if (!hasSession) {
    return (
      <Screen title="Parolă nouă" onBack={() => router.replace('/(auth)/login')}>
        <ErrorState
          icon="link-outline"
          title="Link invalid sau expirat"
          description="Deschide din nou linkul din emailul de resetare pe acest dispozitiv. Dacă a expirat, cere un link nou."
          action={
            <Button
              label="Cere un link nou"
              icon="mail-outline"
              onPress={() => router.replace('/(auth)/forgot-password')}
            />
          }
        />
        <Button
          label="Înapoi la autentificare"
          variant="ghost"
          onPress={() => router.replace('/(auth)/login')}
          style={styles.back}
        />
      </Screen>
    );
  }

  const form = (
    <Screen
        title="Parolă nouă"
        onBack={() => router.replace('/(auth)/login')}
        scroll
        bottomInset={spacing['3xl']}
      >
        <Field
          label="Parolă nouă"
          icon="lock-closed-outline"
          secureTextEntry
          autoComplete="new-password"
          placeholder="Minim 6 caractere"
          value={password}
          onChangeText={setPassword}
          editable={!loading && !done}
        />
        <Field
          label="Confirmă parola"
          icon="lock-closed-outline"
          secureTextEntry
          autoComplete="new-password"
          placeholder="Repetă parola"
          value={confirm}
          onChangeText={setConfirm}
          editable={!loading && !done}
          onSubmitEditing={handleSubmit}
          returnKeyType="go"
        />

        {error ? <Callout tone="danger">{error}</Callout> : null}
        {done ? (
          <Callout tone="success">Parola a fost actualizată. Te ducem în app…</Callout>
        ) : null}

        {!done ? (
          <Button
            label="Salvează parola"
            icon="checkmark-circle-outline"
            onPress={handleSubmit}
            loading={loading}
            style={styles.submit}
          />
        ) : null}
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
  submit: { marginTop: spacing.sm },
  back: { marginTop: spacing.md },
});
