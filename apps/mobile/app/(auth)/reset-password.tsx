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
import { useT } from '@/lib/i18n';
import { useTransientMessage } from '@/lib/useTransientMessage';

export default function ResetPasswordScreen() {
  const tr = useT();
  const [checking, setChecking] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useTransientMessage();

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
      setError(tr('auth.passwordMinLength'));
      return;
    }
    if (password !== confirm) {
      setError(tr('auth.passwordsMismatch'));
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
    return <LoadingScreen label={tr('auth.checkingSession')} />;
  }

  if (!hasSession) {
    return (
      <Screen title={tr('auth.newPassword')} onBack={() => router.replace('/(auth)/login')}>
        <ErrorState
          icon="link-outline"
          title={tr('auth.badLinkTitle')}
          description={tr('auth.badLinkDesc')}
          action={
            <Button
              label={tr('auth.requestNewLink')}
              icon="mail-outline"
              onPress={() => router.replace('/(auth)/forgot-password')}
            />
          }
        />
        <Button
          label={tr('auth.backToLogin')}
          variant="ghost"
          onPress={() => router.replace('/(auth)/login')}
          style={styles.back}
        />
      </Screen>
    );
  }

  const form = (
    <Screen
        title={tr('auth.newPassword')}
        onBack={() => router.replace('/(auth)/login')}
        scroll
        bottomInset={spacing['3xl']}
      >
        <Field
          label={tr('auth.newPassword')}
          icon="lock-closed-outline"
          secureTextEntry
          autoComplete="new-password"
          placeholder={tr('auth.min6Chars')}
          value={password}
          onChangeText={setPassword}
          editable={!loading && !done}
        />
        <Field
          label={tr('auth.confirmPassword')}
          icon="lock-closed-outline"
          secureTextEntry
          autoComplete="new-password"
          placeholder={tr('auth.repeatPassword')}
          value={confirm}
          onChangeText={setConfirm}
          editable={!loading && !done}
          onSubmitEditing={handleSubmit}
          returnKeyType="go"
        />

        {error ? <Callout onClose={() => setError(null)} tone="danger">{error}</Callout> : null}
        {done ? (
          <Callout tone="success">{tr('auth.passwordUpdated')}</Callout>
        ) : null}

        {!done ? (
          <Button
            label={tr('auth.savePassword')}
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
