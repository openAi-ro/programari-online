import { Ionicons } from '@expo/vector-icons';
import { router, usePathname } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/components/ui';
import { fontSize, spacing } from '@/constants/theme';

type TabKey = 'home' | 'search' | 'appointments' | 'favorites' | 'account';

const TABS: {
  key: TabKey;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  href: string;
  match: (path: string) => boolean;
}[] = [
  {
    key: 'home',
    label: 'Acasă',
    icon: 'home-outline',
    href: '/(app)/home',
    match: (p) =>
      (p.includes('/home') || p.endsWith('/(app)') || p.endsWith('/(app)/')) &&
      !p.includes('/business/'),
  },
  {
    key: 'search',
    label: 'Caută',
    icon: 'search-outline',
    href: '/(app)/browse',
    match: (p) => p.includes('/browse') || p.includes('/map'),
  },
  {
    key: 'appointments',
    label: 'Programări',
    icon: 'calendar-outline',
    href: '/(app)/my-appointments',
    match: (p) => p.includes('my-appointments'),
  },
  {
    key: 'favorites',
    label: 'Favorite',
    icon: 'heart-outline',
    href: '/(app)/favorites',
    match: (p) => p.includes('/favorites'),
  },
  {
    key: 'account',
    label: 'Cont',
    icon: 'person-outline',
    href: '/(app)/settings',
    match: (p) => p.includes('/settings') && !p.includes('/business/'),
  },
];

/**
 * Client-only bottom bar (5 tabs). Render inside client screens only —
 * do NOT mount on business routes.
 */
export function ClientTabBar({
  badges,
}: {
  badges?: Partial<Record<TabKey, number>>;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const pathname = usePathname() || '';

  return (
    <View
      style={[
        styles.bar,
        {
          backgroundColor: t.colors.surface,
          borderTopColor: t.colors.border,
          paddingBottom: Math.max(insets.bottom, spacing.sm),
        },
      ]}
    >
      {TABS.map((tab) => {
        const active = tab.match(pathname);
        const count = badges?.[tab.key] ?? 0;
        const color = active ? t.colors.accent : t.colors.textMuted;
        return (
          <Pressable
            key={tab.key}
            accessibilityRole="button"
            accessibilityLabel={tab.label}
            onPress={() => {
              if (active) return;
              router.replace(tab.href as never);
            }}
            style={({ pressed }) => [styles.item, { opacity: pressed ? 0.7 : 1 }]}
            hitSlop={4}
          >
            <View>
              <Ionicons name={tab.icon} size={22} color={color} />
              {count > 0 ? (
                <View style={[styles.badge, { backgroundColor: t.colors.danger }]}>
                  <Text style={styles.badgeText} numberOfLines={1}>
                    {count > 9 ? '9+' : String(count)}
                  </Text>
                </View>
              ) : null}
            </View>
            <Text
              style={[styles.label, { color }]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.75}
              ellipsizeMode="tail"
            >
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    minWidth: 0,
    maxWidth: '100%',
    paddingHorizontal: 2,
    overflow: 'hidden',
  },
  label: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    flexShrink: 1,
    minWidth: 0,
    maxWidth: '100%',
    textAlign: 'center',
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -10,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
  },
});
