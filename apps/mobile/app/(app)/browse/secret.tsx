import { useEffect, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';

import { Body, Button, Callout, Field, LoadingScreen, Screen } from '@/components/ui';
import { radius, spacing } from '@/constants/theme';
import { formatAccessCode, isCompleteAccessCode } from '@/lib/accessCode';
import { setPendingAuthRedirect } from '@/lib/auth-redirect';
import { SECRET_TILE_IMAGE } from '@/lib/browseCategories';
import { getCurrentUser } from '@/lib/currentUser';
import { syncFavoritesFromCloud } from '@/lib/favorites';
import { useT } from '@/lib/i18n';
import { useBack } from '@/lib/nav';
import { redeemAccessCode } from '@/lib/privateAccess';

const SELF_PATH = '/browse/secret';

/**
 * „Top secret”: nu listează niciun business. Clientul introduce codul primit de la
 * un business privat; codul valid îi dă acces permanent (până la revocare).
 * Mesajele de eroare sunt generice — nu spunem dacă un cod există.
 */
export default function SecretCodeScreen() {
  const tr = useT();
  const back = useBack();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getCurrentUser().then((u) => setSignedIn(Boolean(u)));
  }, []);

  function goLogin() {
    setPendingAuthRedirect(SELF_PATH);
    router.push('/(auth)/login');
  }

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await redeemAccessCode(code);
    setBusy(false);
    if (!res.ok) {
      if (res.error === 'auth_required') {
        goLogin();
        return;
      }
      setError(tr(res.error === 'locked' ? 'secret.errLocked' : 'secret.errInvalid'));
      return;
    }
    setCode('');
    // Serverul a adăugat business-ul la favorite: sincronizăm lista locală.
    void syncFavoritesFromCloud();
    router.replace(`/b/${res.publicCode}` as never);
  }

  if (signedIn == null) return <LoadingScreen />;

  return (
    <Screen title={tr('secret.title')} subtitle={tr('secret.subtitle')} onBack={back}>
      <Image source={SECRET_TILE_IMAGE} style={styles.hero} resizeMode="cover" accessibilityIgnoresInvertColors />
      <Body muted>{tr('secret.explain')}</Body>
      {!signedIn ? (
        <>
          <Callout tone="info" title={tr('secret.loginTitle')}>
            {tr('secret.loginBody')}
          </Callout>
          <Button label={tr('secret.login')} icon="log-in-outline" onPress={goLogin} />
        </>
      ) : (
        <View style={styles.form}>
          <Field
            label={tr('secret.codeLabel')}
            placeholder="XXXX-XXXX-XXXX"
            value={code}
            onChangeText={(v) => setCode(formatAccessCode(v))}
            autoCapitalize="characters"
            autoCorrect={false}
            autoComplete="off"
            maxLength={14}
            onSubmitEditing={() => {
              if (isCompleteAccessCode(code) && !busy) void submit();
            }}
          />
          {error ? <Callout tone="danger">{error}</Callout> : null}
          <Button
            label={tr('secret.submit')}
            icon="key-outline"
            loading={busy}
            disabled={!isCompleteAccessCode(code)}
            onPress={() => void submit()}
          />
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { width: '100%', height: 160, borderRadius: radius.lg },
  form: { gap: spacing.md },
});
