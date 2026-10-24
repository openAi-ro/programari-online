import { useEffect, useMemo, useState } from 'react';
import { Share, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
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
import { copyBusinessLink, shareBusinessLink } from '@/lib/shareBusiness';
import { trKey, useT } from '@/lib/i18n';
import { useBack } from '@/lib/nav';
import { fetchMyBusinessResult } from '@/lib/myBusiness';
import { getCurrentUser } from '@/lib/currentUser';
import type { BusinessProfile } from '@/lib/types';

export default function BusinessQrScreen() {
  const t = useTheme();
  const back = useBack();
  const tr = useT();
  const insets = useSafeAreaInsets();
  const [business, setBusiness] = useState<BusinessProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    (async () => {
      const user = await getCurrentUser();
      if (!user) {
        setLoading(false);
        setError(trKey('req.notAuthed'));
        return;
      }
      const { data, error: err } = await fetchMyBusinessResult(user.id);
      if (err) {
        setError(err.message);
      } else if (!data) {
        setError(trKey('qr.setupFirst'));
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

  function flashCopied() {
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleShare() {
    if (!business) return;
    if ((await shareBusinessLink(business)) === 'copied') flashCopied();
  }

  async function handleCopy() {
    if (!business) return;
    await copyBusinessLink(business.public_code);
    flashCopied();
  }

  function openBookingInApp() {
    if (!links) return;
    router.push(links.route as never);
  }

  if (loading) {
    return <SkeletonScreen title={tr('qr.title')} onBack={back} blocks={3} label={tr('qr.preparing')} />;
  }

  if (error || !business || !links) {
    return (
      <Screen title={tr('qr.title')} onBack={back}>
        <EmptyState
          icon="alert-circle-outline"
          title={tr('qr.noQr')}
          description={error ?? tr('qr.bizMissing')}
          action={
            <Button
              label={tr('qr.setupBiz')}
              icon="settings-outline"
              onPress={() => router.replace('/(app)/business/setup' as never)}
            />
          }
        />
      </Screen>
    );
  }

  return (
    <Screen title={tr('qr.title')} subtitle={business.name} onBack={back}>
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
          {tr('qr.hint')}
        </Text>
      </View>

      <SectionTitle>{tr('qr.publicCode')}</SectionTitle>
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
        label={tr('qr.openNow')}
        icon="calendar-outline"
        onPress={openBookingInApp}
      />
      <Text style={[styles.help, { color: t.colors.textMuted }]}>
        {tr('qr.samePhone')}
      </Text>

      <View style={styles.actionsRow}>
        <View style={styles.action}>
          <Button
            label={tr('qr.share')}
            variant="secondary"
            size="md"
            icon="share-social-outline"
            onPress={handleShare}
          />
        </View>
        <View style={styles.action}>
          <Button
            label={copied ? tr('qr.copied') : tr('qr.copyLink')}
            variant="secondary"
            size="md"
            icon={copied ? 'checkmark' : 'copy-outline'}
            onPress={handleCopy}
          />
        </View>
      </View>

      <Card icon="link-outline" iconTone="neutral" title={tr('qr.publicLink')} hint={links.webUrl} />

      <View style={[styles.qrCard, { backgroundColor: t.colors.surface, borderColor: t.colors.border }, t.shadows.md]}>
        <Text style={[styles.qrHint, { color: t.colors.text, fontWeight: '700' }]}>{tr('qr.installApk')}</Text>
        <View style={styles.qrInner}>
          <QRCode value={installUrl} size={180} backgroundColor={palette.white} color={palette.ink950} />
        </View>
        <Text style={[styles.qrHint, { color: t.colors.textMuted }]}>{tr('qr.scanInstall').replace('{url}', installUrl)}</Text>
        <Button label={tr('qr.openInstall')} icon="download-outline" variant="secondary" onPress={() => void Share.share({ message: installUrl, url: installUrl })} />
      </View>

      <Callout tone="accent" title={tr('qr.publicPage')}>
        {tr('qr.publicBody').replace('{url}', links.webUrl)}
      </Callout>

      <Callout tone="warning" title={tr('qr.expoTitle')}>
        {tr('qr.expoBody').replace('{openNow}', tr('qr.openNow'))}
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
