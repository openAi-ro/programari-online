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
  Screen,
  SectionTitle,
  SkeletonScreen,
  useTheme,
} from '@/components/ui';
import { fontSize, palette, radius, spacing } from '@/constants/theme';
import { getBookingPaths } from '@/lib/bookingLink';
import { getInstallUrl } from '@/lib/installLink';
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

  const links = useMemo(() => {
    if (!business?.public_code) return null;
    try {
      return getBookingPaths(business.public_code);
    } catch (e) {
      console.warn('getBookingPaths', e);
      return null;
    }
  }, [business]);

  // QR public HTTPS — Instagram, WhatsApp, camera nativă, browser
  const qrValue = links?.webUrl ?? '';
  const installUrl = getInstallUrl();

  async function handleShare() {
    if (!links || !business) return;
    await Share.share({
      message: `Rezervă la ${business.name}\n${links.webUrl}`,
      url: links.webUrl,
    });
  }

  async function handleCopy() {
    if (!links) return;
    await Clipboard.setStringAsync(links.webUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function openBookingInApp() {
    if (!links) return;
    router.push(links.route as never);
  }

  if (loading) {
    return <SkeletonScreen title="Cod QR" onBack={back} blocks={3} label="Se pregătește codul QR…" />;
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
          Clienții scanează și deschid pagina publică de rezervare, fără să instaleze app-ul.
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

      <Card icon="link-outline" iconTone="neutral" title="Link public" hint={links.webUrl} />

      <View style={[styles.qrCard, { backgroundColor: t.colors.surface, borderColor: t.colors.border }, t.shadows.md]}>
        <Text style={[styles.qrHint, { color: t.colors.text, fontWeight: '700' }]}>Instalare aplicație (APK)</Text>
        <View style={styles.qrInner}>
          <QRCode value={installUrl} size={180} backgroundColor={palette.white} color={palette.ink950} />
        </View>
        <Text style={[styles.qrHint, { color: t.colors.textMuted }]}>Scanează pentru a instala APK-ul. Link: {installUrl}</Text>
        <Button label="Deschide link instalare" icon="download-outline" variant="secondary" onPress={() => void Share.share({ message: installUrl, url: installUrl })} />
      </View>

      <Callout tone="accent" title="Pagină publică /b/…">
        Clienții rezervă din browser pe {links.webUrl}. Trebuie să fii autentificat ca să
        trimiți cererea; vizualizarea orelor libere e deschisă oricui. Linkul din QR e
        mereu public (nu localhost), ca să se deschidă de pe telefon.
      </Callout>

      <Callout tone="warning" title="Expo Go pe telefon">
        Camera nativă deschide linkul HTTPS. Dacă rulezi doar Expo Go local, poți totuși
        să folosești „Deschide programarea acum” pe același telefon, sau Scanează QR
        din app pe un al doilea telefon.
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
