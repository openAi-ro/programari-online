import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { Button, Screen, useTheme } from '@/components/ui';
import { useT } from '@/lib/i18n';
import { InstallQrCard } from '@/components/InstallQrCard';
import { fontSize, radius, spacing } from '@/constants/theme';
import { getAppVersionLabel } from '@/lib/appVersion';
import { peekPendingAuthRedirect } from '@/lib/auth-redirect';

export default function LoginScreen() {
  const t = useTheme();
  const tr = useT();
  const pendingBook = peekPendingAuthRedirect();

  return (
    <Screen scroll bottomInset={spacing['3xl']}>
      <View style={styles.hero}>
        <View style={[styles.logo, { backgroundColor: t.colors.accent }, t.shadows.accent]}>
          <Ionicons name="calendar" size={30} color={t.colors.onAccent} />
        </View>
        <Text style={[styles.title, { color: t.colors.text }]}>Programări</Text>
        <Text style={[styles.version, { color: t.colors.textMuted }]}>
          {getAppVersionLabel()}
        </Text>
      </View>

      <Button
        label={tr('auth.signIn')}
        icon="log-in-outline"
        onPress={() => router.push({ pathname: '/(auth)/client', params: { mode: 'login' } } as never)}
        style={styles.signInButton}
      />
      {pendingBook ? (
        <Pressable
          onPress={() => router.replace(pendingBook as never)}
          accessibilityRole="button"
          accessibilityLabel={tr('auth.backToBooking')}
          style={({ pressed }) => [
            styles.backBook,
            {
              backgroundColor: t.colors.accentSoft,
              borderColor: t.colors.border,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
        >
          <Ionicons name="arrow-back" size={18} color={t.colors.accentSoftText} />
          <Text style={[styles.backBookText, { color: t.colors.accentSoftText }]}>
            {tr('auth.backToBooking')}
          </Text>
        </Pressable>
      ) : null}
      <Button
        label={tr('auth.createClientAccount')}
        variant="secondary"
        icon="person-outline"
        onPress={() => router.push('/(auth)/client')}
        style={styles.createButton}
      />
      <Button
        label={tr('auth.createBusinessAccount')}
        variant="secondary"
        icon="storefront-outline"
        onPress={() => router.push('/(auth)/business')}
        style={styles.createButton}
      />

      {Platform.OS === 'web' ? <InstallQrCard /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: spacing.sm, marginBottom: spacing.lg },
  logo: {
    width: 64,
    height: 64,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  title: {
    fontSize: fontSize['2xl'],
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: -0.5,
  },
  version: {
    fontSize: fontSize.xs,
    textAlign: 'center',
    fontWeight: '600',
    letterSpacing: 0.3,
    marginTop: spacing.xs,
  },
  signInButton: { marginBottom: spacing.md },
  createButton: { marginBottom: spacing.md },
  backBook: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    marginBottom: spacing.md,
  },
  backBookText: { fontSize: fontSize.md, fontWeight: '700' },
});
