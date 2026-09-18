import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { Screen, useTheme } from '@/components/ui';
import { InstallQrCard } from '@/components/InstallQrCard';
import { fontSize, radius, spacing } from '@/constants/theme';
import { getAppVersionLabel } from '@/lib/appVersion';
import { peekPendingAuthRedirect } from '@/lib/auth-redirect';

export default function LoginScreen() {
  const t = useTheme();
  const pendingBook = peekPendingAuthRedirect();

  return (
    <Screen scroll bottomInset={spacing['3xl']}>
      <View style={styles.hero}>
        <View style={[styles.logo, { backgroundColor: t.colors.accent }, t.shadows.accent]}>
          <Ionicons name="calendar" size={30} color={t.colors.onAccent} />
        </View>
        <Text style={[styles.title, { color: t.colors.text }]}>Programări</Text>
        <Text style={[styles.subtitle, { color: t.colors.textMuted }]}>
          Alege tipul de cont. Client și business sunt conturi separate.
        </Text>
        <Text style={[styles.version, { color: t.colors.textMuted }]}>
          {getAppVersionLabel()}
        </Text>
      </View>

      {pendingBook ? (
        <Pressable
          onPress={() => router.replace(pendingBook as never)}
          accessibilityRole="button"
          accessibilityLabel="Înapoi la programare"
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
            Înapoi la programare
          </Text>
        </Pressable>
      ) : null}
      <Pressable
        onPress={() => router.push('/(auth)/client')}
        accessibilityRole="button"
        accessibilityLabel="Creează sau deschide cont client"
        style={({ pressed }) => [
          styles.roleCard,
          {
            backgroundColor: t.colors.surface,
            borderColor: t.colors.border,
            opacity: pressed ? 0.85 : 1,
          },
          t.shadows.md,
        ]}
      >
        <View style={[styles.roleIcon, { backgroundColor: t.colors.accentSoft }]}>
          <Ionicons name="person-outline" size={26} color={t.colors.accentSoftText} />
        </View>
        <View style={styles.flex}>
          <Text style={[styles.roleTitle, { color: t.colors.accent }]}>Creează cont client</Text>
          <Text style={[styles.roleHint, { color: t.colors.textMuted }]}>
            Scanează QR, rezervă un loc și vezi programările tale. Ai deja cont? Intră din
            ecranul următor.
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={t.colors.textFaint} />
      </Pressable>

      <Pressable
        onPress={() => router.push('/(auth)/business')}
        accessibilityRole="button"
        accessibilityLabel="Creează sau deschide cont business"
        style={({ pressed }) => [
          styles.roleCard,
          {
            backgroundColor: t.colors.surface,
            borderColor: t.colors.border,
            opacity: pressed ? 0.85 : 1,
          },
          t.shadows.md,
        ]}
      >
        <View style={[styles.roleIcon, { backgroundColor: t.colors.accentSoft }]}>
          <Ionicons name="storefront-outline" size={26} color={t.colors.accentSoftText} />
        </View>
        <View style={styles.flex}>
          <Text style={[styles.roleTitle, { color: t.colors.accent }]}>Creează cont business</Text>
          <Text style={[styles.roleHint, { color: t.colors.textMuted }]}>
            Agenda, cereri, clienți, echipă, servicii, QR de rezervare și rapoarte.
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={t.colors.textFaint} />
      </Pressable>

      <InstallQrCard />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
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
  subtitle: {
    fontSize: fontSize.md,
    textAlign: 'center',
  },
  version: {
    fontSize: fontSize.xs,
    textAlign: 'center',
    fontWeight: '600',
    letterSpacing: 0.3,
    marginTop: spacing.xs,
  },
  roleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    marginBottom: spacing.md,
  },
  roleIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roleTitle: { fontSize: fontSize.lg, fontWeight: '800', letterSpacing: -0.3 },
  roleHint: { fontSize: fontSize.sm, lineHeight: 19, marginTop: 2 },
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
