import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  Avatar,
  Banner,
  Body,
  Button,
  Card,
  LoadingScreen,
  Screen,
  SectionTitle,
  useTheme,
} from '@/components/ui';
import { fontSize, radius, spacing } from '@/constants/theme';
import { registerForPushAsync } from '@/lib/notifications';
import { supabase } from '@/lib/supabase';

type Biz = { id: string; name: string; public_code: string };

const GUIDE_STEPS = [
  'Configurează agenda (business)',
  'Deschide QR-ul sau copiază codul',
  '„Testează ca client” — te programezi la tine',
  '„Cereri” — aprobi sau respingi programarea',
];

export default function HomeScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState<string | null>(null);
  const [business, setBusiness] = useState<Biz | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        setLoading(true);
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user || cancelled) {
          if (!cancelled) setLoading(false);
          return;
        }
        setEmail(user.email ?? null);

        try {
          await registerForPushAsync(user.id);
        } catch (e) {
          console.warn('Push register on home failed', e);
        }

        // Asigură profil (dacă trigger-ul nu a rulat la signup)
        await supabase.from('profiles').upsert(
          {
            id: user.id,
            email: user.email ?? null,
            phone: user.phone ?? null,
          },
          { onConflict: 'id' }
        );

        const { data } = await supabase
          .from('business_profiles')
          .select('id, name, public_code')
          .eq('owner_user_id', user.id)
          .maybeSingle();

        if (!cancelled) {
          setBusiness(data as Biz | null);
          setLoading(false);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [])
  );

  if (loading) {
    return <LoadingScreen label="Se încarcă agenda…" />;
  }

  return (
    <Screen bottomInset={insets.bottom + spacing['3xl']}>
      <View style={styles.hero}>
        <Text style={[styles.heroLabel, { color: t.colors.textMuted }]}>
          Bine ai venit
        </Text>
        <Text style={[styles.heroTitle, { color: t.colors.text }]} numberOfLines={1}>
          Programări
        </Text>
        {email ? (
          <View style={styles.accountRow}>
            <Avatar initials={email} size="sm" />
            <Text style={[styles.account, { color: t.colors.textMuted }]} numberOfLines={1}>
              {email}
            </Text>
          </View>
        ) : null}
      </View>

      {!business ? (
        <>
          <Banner
            tone="accent"
            icon="rocket-outline"
            title="Începe prin a-ți configura agenda"
            description="Timezone, durată ședință, program de lucru și pauză — apoi primești un cod QR."
            actionLabel="Configurează"
            onPress={() => router.push('/(app)/business/setup')}
          />
          <Guide />
        </>
      ) : (
        <>
          <View
            style={[
              styles.bizCard,
              { backgroundColor: t.colors.surface, borderColor: t.colors.border },
              t.shadows.md,
            ]}
          >
            <View style={styles.bizHead}>
              <View style={[styles.bizIcon, { backgroundColor: t.colors.accentSoft }]}>
                <Text style={[styles.bizInitial, { color: t.colors.accentSoftText }]}>
                  {business.name.slice(0, 1).toUpperCase()}
                </Text>
              </View>
              <View style={styles.flex}>
                <Text style={[styles.bizLabel, { color: t.colors.textMuted }]}>
                  Business-ul tău
                </Text>
                <Text style={[styles.bizName, { color: t.colors.text }]} numberOfLines={1}>
                  {business.name}
                </Text>
              </View>
            </View>

            <View style={[styles.codeBox, { backgroundColor: t.colors.surfaceMuted }]}>
              <Text style={[styles.codeLabel, { color: t.colors.textMuted }]}>
                Cod public
              </Text>
              <Text style={[styles.code, { color: t.colors.text }]} selectable>
                {business.public_code}
              </Text>
            </View>

            <View style={styles.bizActions}>
              <Button
                label="Vezi QR / partajează"
                icon="qr-code-outline"
                onPress={() => router.push('/(app)/business/qr')}
              />
              <View style={styles.bizActionsRow}>
                <View style={styles.bizAction}>
                  <Button
                    label="Cereri"
                    icon="hourglass-outline"
                    variant="secondary"
                    size="md"
                    onPress={() => router.push('/(app)/business/requests')}
                  />
                </View>
                <View style={styles.bizAction}>
                  <Button
                    label="Ca client"
                    icon="person-outline"
                    variant="secondary"
                    size="md"
                    onPress={() =>
                      router.push(`/(app)/book/${business.public_code}` as never)
                    }
                  />
                </View>
              </View>
            </View>
          </View>

          <Body muted style={styles.oneAccountNote}>
            Un singur cont acoperă ambele roluri: business și client. Nu ai nevoie de al
            doilea email ca să testezi.
          </Body>
        </>
      )}

      <SectionTitle>Toate acțiunile</SectionTitle>

      <Card
        icon="settings-outline"
        title="Configurare business"
        hint="Nume, program, timezone, durată, pauză"
        chevron
        onPress={() => router.push('/(app)/business/setup')}
      />
      <Card
        icon="qr-code-outline"
        title="Cod QR business"
        hint="Arată sau partajează linkul de rezervare"
        chevron
        onPress={() => router.push('/(app)/business/qr')}
      />
      <Card
        icon="hourglass-outline"
        title="Cereri programări"
        hint="Aprobă sau respinge cererile în așteptare"
        iconTone="warning"
        chevron
        onPress={() => router.push('/(app)/business/requests')}
      />
      <Card
        icon="scan-outline"
        title="Scanează QR"
        hint="Pentru alt business, sau codul tău pe un al doilea telefon"
        iconTone="info"
        chevron
        onPress={() => router.push('/(app)/scan')}
      />
      <Card
        icon="calendar-outline"
        title="Programările mele"
        hint="Status: în așteptare, confirmat, respins"
        iconTone="success"
        chevron
        onPress={() => router.push('/(app)/my-appointments')}
      />
      <Card
        icon="person-circle-outline"
        title="Setări"
        hint="Profil, WhatsApp, notificări push, deconectare"
        iconTone="neutral"
        chevron
        onPress={() => router.push('/(app)/settings')}
      />
    </Screen>
  );
}

function Guide() {
  const t = useTheme();
  return (
    <View
      style={[
        styles.guide,
        { backgroundColor: t.colors.surface, borderColor: t.colors.border },
        t.shadows.sm,
      ]}
    >
      <Text style={[styles.guideTitle, { color: t.colors.text }]}>
        Cum funcționează, pe un singur telefon
      </Text>
      {GUIDE_STEPS.map((step, i) => (
        <View key={step} style={styles.guideStep}>
          <View style={[styles.guideNum, { backgroundColor: t.colors.accentSoft }]}>
            <Text style={[styles.guideNumText, { color: t.colors.accentSoftText }]}>
              {i + 1}
            </Text>
          </View>
          <Text style={[styles.guideText, { color: t.colors.textMuted }]}>{step}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  hero: { gap: 4, marginBottom: spacing.sm },
  heroLabel: { fontSize: fontSize.sm, fontWeight: '600' },
  heroTitle: { fontSize: fontSize['3xl'], fontWeight: '800', letterSpacing: -0.8 },
  accountRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 2 },
  account: { fontSize: fontSize.sm, flexShrink: 1 },

  bizCard: {
    padding: spacing.lg,
    gap: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  bizHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  bizIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bizInitial: { fontSize: fontSize.xl, fontWeight: '800' },
  bizLabel: { fontSize: fontSize.xs, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  bizName: { fontSize: fontSize.xl, fontWeight: '800', letterSpacing: -0.3 },
  codeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
  },
  codeLabel: { fontSize: fontSize.xs, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  code: { fontSize: fontSize.lg, fontWeight: '800', letterSpacing: 1 },
  bizActions: { gap: spacing.sm },
  bizActionsRow: { flexDirection: 'row', gap: spacing.sm },
  bizAction: { flex: 1 },
  oneAccountNote: { fontSize: fontSize.sm, lineHeight: 19 },

  guide: {
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.md,
  },
  guideTitle: { fontSize: fontSize.md, fontWeight: '700' },
  guideStep: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  guideNum: {
    width: 24,
    height: 24,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  guideNumText: { fontSize: fontSize.xs, fontWeight: '800' },
  guideText: { flex: 1, fontSize: fontSize.sm, lineHeight: 19 },
});
