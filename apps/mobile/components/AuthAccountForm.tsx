import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { Ionicons } from '@expo/vector-icons';
import { GoogleLogo } from '@/components/GoogleLogo';
import { router } from 'expo-router';

import { Button, Callout, Screen, Segmented, useTheme } from '@/components/ui';
import { useT } from '@/lib/i18n';
import { fontSize, spacing } from '@/constants/theme';
import {
  LoginButton,
  LoginCard,
  LoginField,
} from '@/components/LoginCard';
import { assertAccountKind } from '@/lib/accountKind';
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
import { getAppVersionLabel } from '@/lib/appVersion';
import { peekPendingAuthRedirect } from '@/lib/auth-redirect';
import {
  clearRememberedCredentials,
  loadRememberedCredentials,
  REMEMBER_PASSWORD_SUPPORTED,
  saveRememberedCredentials,
} from '@/lib/rememberCredentials';
import { useTransientMessage } from '@/lib/useTransientMessage';

type Mode = 'login' | 'register';

const MODE_VALUES: Mode[] = ['login', 'register'];


WebBrowser.maybeCompleteAuthSession();

export function AuthAccountForm({ kind, initialMode = 'register' }: { kind: AppMode; initialMode?: Mode }) {
  const t = useTheme();
  const tr = useT();
  const isBusiness = kind === 'business';
  const [mode, setMode] = useState<Mode>(initialMode);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberPassword, setRememberPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useTransientMessage();
  const [error, setError] = useTransientMessage();
  const [activationEmail, setActivationEmail] = useState<string | null>(null);
  const [referralInput, setReferralInput] = useState('');
  const [resendBusy, setResendBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = await loadRememberedCredentials();
      if (cancelled || !saved) return;
      setEmail(saved.email);
      if (saved.password) setPassword(saved.password);
      setRememberPassword(true);
      setMode('login');
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
        value={mode}
        onChange={(m) => {
          setMode(m);
          clearFeedback();
        }}
        options={MODE_VALUES.map((value) => ({
          value,
          label: value === 'login' ? tr('auth.signIn') : tr('auth.createAccount'),
        }))}
      />

      <LoginCard heading={isBusiness ? tr('auth.businessAccountTitle') : tr('auth.clientAccountTitle')}>
        <>
            <LoginField
              label={tr('auth.email')}
              textContentType="emailAddress"
              icon="mail-outline"
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              autoCorrect={false}
              placeholder={tr('auth.emailPlaceholder')}
              value={email}
              onChangeText={setEmail}
              editable={!loading}
            />
            <LoginField
              label={tr('auth.password')}
              textContentType={mode === 'register' ? 'newPassword' : 'password'}
              icon="lock-closed-outline"
              keyboardType="default"
              secureTextEntry
              autoComplete={mode === 'register' ? 'new-password' : 'password'}
              placeholder={tr('auth.passwordPlaceholder')}
              value={password}
              onChangeText={setPassword}
              editable={!loading}
              onSubmitEditing={() => void handleEmailSubmit()}
              returnKeyType="go"
            />
            {!isBusiness && mode === 'register' ? (
              <LoginField
                label={tr('ref.label')}
                hint={tr('ref.optional')}
                autoComplete="off"
                textContentType="none"
                icon="people-outline"
                keyboardType="default"
                autoCapitalize="characters"
                autoCorrect={false}
                placeholder="ABC123"
                value={referralInput}
                onChangeText={setReferralInput}
                editable={!loading}
              />
            ) : null}


            {REMEMBER_PASSWORD_SUPPORTED ? (
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
            ) : null}

            {error ? <Callout onClose={() => setError(null)} tone="danger">{error}</Callout> : null}
            {message ? <Callout onClose={() => setMessage(null)} tone="success">{message}</Callout> : null}

            <LoginButton
              label={mode === 'login' ? tr('auth.signIn') : tr('auth.createAccount')}
              onPress={() => void handleEmailSubmit(mode)}
              disabled={loading}
              loading={loading}
            />
            <LoginButton
              tone="secondary"
              label={tr('auth.googleContinue')}
              leading={<GoogleLogo size={18} />}
              onPress={() => void handleGoogleSignIn()}
              disabled={loading || googleBusy}
              loading={googleBusy}
            />
            <LoginButton
              label={tr('auth.recoverPassword')}
              tone="ghost"
              onPress={() => router.push('/(auth)/forgot-password')}
              disabled={loading}
            />
            {activationEmail ? (
              <LoginButton
                tone="secondary"
                label={resendBusy ? tr('common.sending') : tr('auth.resendActivation')}
                onPress={() => void handleResendActivation()}
                disabled={loading || resendBusy}
              />
            ) : null}
        </>
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
});
