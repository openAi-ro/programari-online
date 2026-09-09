import { useEffect, useMemo, useState } from 'react';
import { Share, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import QRCode from 'react-native-qrcode-svg';

import {
  Button,
  Callout,
  Card,
  EmptyState,
  LoadingScreen,
  Screen,
  SectionTitle,
  useTheme,
} from '@/components/ui';
import { fontSize, palette, radius, spacing } from '@/constants/theme';
import { getBookingPaths } from '@/lib/bookingLink';
import { useBack } from '@/lib/nav';
import { supabase } from '@/lib/supabase';
import type { BusinessProfile } from '@/lib/types';

export default function BusinessQrScreen() {
  const t = useTheme();
  const back = useBack();
  const insets = useSafeAreaInsets();
  const [business, setBusiness] = useState<BusinessProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        setError('Nu ești autentificat.');
        return;
      }
      const { data, error: err } = await supabase
        .from('business_profiles')
        .select('*')
        .eq('owner_user_id', user.id)
        .maybeSingle();
      if (err) {
        setError(err.message);
      } else if (!data) {
        setError('Configurează mai întâi business-ul.');
      } else {
        setBusiness(data as BusinessProfile);
      }
      setLoading(false);
    })();
  }, []);

  const links = useMemo(
    () => (business ? getBookingPaths(business.public_code) : null),
    [business]
  );

  // QR folosește linkul Expo (deschide app-ul în Expo Go pe același Wi‑Fi)
  const qrValue = links?.expoUrl ?? links?.appScheme ?? '';

  async function handleShare() {
    if (!links || !business) return;
    await Share.share({
      message: `Rezervă la ${business.name}\n\nDeschide în app:\n${links.expoUrl}\n\nSau cod: ${links.code}`,
      url: links.expoUrl,
    });
  }

  async function handleCopy() {
    if (!links) return;
    await Clipboard.setStringAsync(links.expoUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function openBookingInApp() {
    if (!links) return;
    router.push(links.route as never);
  }

  if (loading) {
    return <LoadingScreen label="Se pregătește codul QR…" />;
  }

  if (error || !business || !links) {
    return (
      <Screen title="Cod QR" onBack={back}>
        <EmptyState
          icon="alert-circle-outline"
          title="Nu există încă un cod QR"
          description={error ?? 'Business negăsit.'}
          action={
            <Button
              label="Configurează business"
              icon="settings-outline"
              onPress={() => router.replace('/(app)/business/setup' as never)}
            />
          }
        />
      </Screen>
    );
  }

  return (
    <Screen title="Cod QR" subtitle={business.name} onBack={back}>
      <View
        style={[
          styles.qrCard,
          { backgroundColor: t.colors.surface, borderColor: t.colors.border },
          t.shadows.md,
        ]}
      >
        <View style={styles.qrInner}>
          <QRCode value={qrValue} size={216} backgroundColor={palette.white} color={palette.ink950} />
        </View>
        <Text style={[styles.qrHint, { color: t.colors.textMuted }]}>
          Clienții scanează codul ca să aleagă o oră liberă pe agenda ta.
        </Text>
      </View>

      <SectionTitle>Cod public</SectionTitle>
      <View
        style={[
          styles.codeBox,
          { backgroundColor: t.colors.surfaceMuted, borderColor: t.colors.border },
        ]}
      >
        <Text style={[styles.code, { color: t.colors.text }]} selectable>
          {links.code}
        </Text>
      </View>

      <Button
        label="Deschide programarea acum"
        icon="calendar-outline"
        onPress={openBookingInApp}
      />
      <Text style={[styles.help, { color: t.colors.textMuted }]}>
        Pe același telefon nu e nevoie de cameră: apeși butonul de mai sus, apoi alegi
        data și ora liberă.
      </Text>

      <View style={styles.actionsRow}>
        <View style={styles.action}>
          <Button
            label="Partajează"
            variant="secondary"
            size="md"
            icon="share-social-outline"
            onPress={handleShare}
          />
        </View>
        <View style={styles.action}>
          <Button
            label={copied ? 'Copiat' : 'Copiază link'}
            variant="secondary"
            size="md"
            icon={copied ? 'checkmark' : 'copy-outline'}
            onPress={handleCopy}
          />
        </View>
      </View>

      <Card icon="link-outline" iconTone="neutral" title="Link de programare" hint={links.expoUrl} />

      <Callout tone="warning" title="De ce camera nu deschide app-ul?">
        Camera telefonului nu știe de „Programări” cât timp rulezi în Expo Go. Schemele
        custom (programari://) merg după ce publici app-ul (APK / App Store).
        {'\n\n'}
        • Pe același telefon: butonul „Deschide programarea acum”.'
        {'\n'}
        • Al doilea telefon: app → Scanează QR.'
        {'\n'}
        • Sau deschide linkul copiat pe telefonul unde e Expo Go deschis.
      </Callout>

      <View style={{ height: insets.bottom + spacing.md }} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  qrCard: {
    alignItems: 'center',
    gap: spacing.lg,
    padding: spacing.xl,
    borderRadius: radius.xl,
    borderWidth: 1,
  },
  qrInner: {
    padding: spacing.md,
    backgroundColor: palette.white,
    borderRadius: radius.lg,
  },
  qrHint: {
    fontSize: fontSize.sm,
    lineHeight: 19,
    textAlign: 'center',
  },
  codeBox: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    alignItems: 'center',
  },
  code: {
    fontSize: fontSize['2xl'],
    fontWeight: '800',
    letterSpacing: 2,
  },
  help: {
    fontSize: fontSize.sm,
    lineHeight: 19,
    textAlign: 'center',
  },
  actionsRow: { flexDirection: 'row', gap: spacing.md },
  action: { flex: 1 },
});
