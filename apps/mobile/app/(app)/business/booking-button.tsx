import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  Button,
  Callout,
  EmptyState,
  Screen,
  SectionTitle,
  SkeletonScreen,
  useTheme,
} from '@/components/ui';
import { fontSize, radius, spacing } from '@/constants/theme';
import { getBookingPaths } from '@/lib/bookingLink';
import { buttonSnippet, iframeSnippet } from '@/lib/bookingButton';
import { shareBusinessLink } from '@/lib/shareBusiness';
import { trKey, useLanguage, useT, type TrKey } from '@/lib/i18n';
import { useBack } from '@/lib/nav';
import { fetchMyBusinessResult } from '@/lib/myBusiness';
import { getCurrentUser } from '@/lib/currentUser';
import type { BusinessProfile } from '@/lib/types';
import { managerOnly } from '@/components/ManagerOnly';

type CopyKey = 'link' | 'button' | 'iframe';

const GUIDE: { icon: 'logo-instagram' | 'logo-facebook' | 'logo-google' | 'globe-outline'; title: TrKey; body: TrKey }[] = [
  { icon: 'logo-instagram', title: 'btn.igTitle', body: 'btn.igBody' },
  { icon: 'logo-facebook', title: 'btn.fbTitle', body: 'btn.fbBody' },
  { icon: 'logo-google', title: 'btn.googleTitle', body: 'btn.googleBody' },
  { icon: 'globe-outline', title: 'btn.siteTitle', body: 'btn.siteBody' },
];

/** „Butonul tău de programare”: linkul public, cele două coduri HTML și ghidul pentru rețele. */
function BookingButtonScreen() {
  const t = useTheme();
  const back = useBack();
  const tr = useT();
  const { lang } = useLanguage();
  const insets = useSafeAreaInsets();
  const [business, setBusiness] = useState<BusinessProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<CopyKey | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    (async () => {
      const user = await getCurrentUser();
      if (!user) {
        setError(trKey('req.notAuthed'));
        setLoading(false);
        return;
      }
      const { data, error: err } = await fetchMyBusinessResult(user.id);
      if (err) setError(err.message);
      else if (!data) setError(trKey('qr.setupFirst'));
      else setBusiness(data as BusinessProfile);
      setLoading(false);
    })();
    return () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    };
  }, []);

  const codes = useMemo(() => {
    if (!business?.public_code) return null;
    const webUrl = getBookingPaths(business.public_code).webUrl;
    return {
      webUrl,
      button: buttonSnippet(webUrl, lang),
      iframe: iframeSnippet(webUrl, business.name ?? '', lang),
    };
  }, [business, lang]);

  async function copy(key: CopyKey, text: string) {
    await Clipboard.setStringAsync(text);
    setCopied(key);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(null), 2000);
  }

  async function share() {
    if (!business) return;
    if ((await shareBusinessLink(business)) === 'copied') void copy('link', codes?.webUrl ?? '');
  }

  if (loading) {
    return <SkeletonScreen title={tr('btn.title')} onBack={back} blocks={4} label={tr('qr.preparing')} />;
  }

  if (error || !business || !codes) {
    return (
      <Screen title={tr('btn.title')} onBack={back}>
        <EmptyState
          icon="alert-circle-outline"
          title={tr('btn.title')}
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

  const copyLabel = (key: CopyKey, idle: TrKey) => (copied === key ? tr('qr.copied') : tr(idle));
  const copyIcon = (key: CopyKey) => (copied === key ? 'checkmark' : 'copy-outline');
  const box = [styles.box, { backgroundColor: t.colors.surfaceMuted, borderColor: t.colors.border }];

  return (
    <Screen title={tr('btn.title')} subtitle={business.name} onBack={back}>
      <Text style={[styles.text, { color: t.colors.textMuted }]}>{tr('btn.intro')}</Text>

      <SectionTitle>{tr('btn.linkTitle')}</SectionTitle>
      <View style={box}>
        <Text style={[styles.link, { color: t.colors.text }]} selectable testID="booking-link">
          {codes.webUrl}
        </Text>
      </View>
      <View style={styles.row}>
        <View style={styles.cell}>
          <Button
            label={copyLabel('link', 'qr.copyLink')}
            variant="secondary"
            size="md"
            icon={copyIcon('link')}
            onPress={() => void copy('link', codes.webUrl)}
          />
        </View>
        <View style={styles.cell}>
          <Button label={tr('qr.share')} variant="secondary" size="md" icon="share-social-outline" onPress={() => void share()} />
        </View>
      </View>

      <SectionTitle>{tr('btn.buttonTitle')}</SectionTitle>
      <Text style={[styles.text, { color: t.colors.textMuted }]}>{tr('btn.buttonHint')}</Text>
      <View style={box}>
        <Text style={[styles.code, { color: t.colors.text }]} selectable>{codes.button}</Text>
      </View>
      <Button
        label={copyLabel('button', 'btn.copyCode')}
        variant="secondary"
        icon={copyIcon('button')}
        onPress={() => void copy('button', codes.button)}
      />

      <SectionTitle>{tr('btn.iframeTitle')}</SectionTitle>
      <Text style={[styles.text, { color: t.colors.textMuted }]}>{tr('btn.iframeHint')}</Text>
      <View style={box}>
        <Text style={[styles.code, { color: t.colors.text }]} selectable>{codes.iframe}</Text>
      </View>
      <Button
        label={copyLabel('iframe', 'btn.copyCode')}
        variant="secondary"
        icon={copyIcon('iframe')}
        onPress={() => void copy('iframe', codes.iframe)}
      />

      <SectionTitle>{tr('btn.guideTitle')}</SectionTitle>
      {GUIDE.map((g) => (
        <Callout key={g.title} tone="info" icon={g.icon} title={tr(g.title)}>
          {tr(g.body)}
        </Callout>
      ))}
      <Text style={[styles.text, { color: t.colors.textMuted }]}>{tr('btn.guideNote')}</Text>

      <View style={{ height: insets.bottom + spacing.md }} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  text: { fontSize: fontSize.sm, lineHeight: 20 },
  box: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  link: { fontSize: fontSize.md, fontWeight: '700' },
  code: {
    fontSize: fontSize.sm,
    lineHeight: 19,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'ui-monospace, Menlo, Consolas, monospace' }),
  },
  row: { flexDirection: 'row', gap: spacing.md },
  cell: { flex: 1 },
});

export default managerOnly(BookingButtonScreen);
