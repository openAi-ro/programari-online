import { useEffect, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { router, usePathname } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/components/ui';
import { fetchUnreadTotal } from '@/lib/chatRpc';
import { useT, type TrKey } from '@/lib/i18n';
import { fontSize, spacing } from '@/constants/theme';

type TabKey = 'home' | 'search' | 'appointments' | 'favorites' | 'account';

const TABS: {
  key: TabKey;
  labelKey: TrKey;
  icon: keyof typeof Ionicons.glyphMap;
  href: string;
  match: (path: string) => boolean;
}[] = [
  {
    key: 'home',
    labelKey: 'tabs.home',
    icon: 'home-outline',
    href: '/(app)/home',
    match: (p) =>
      (p.includes('/home') || p.endsWith('/(app)') || p.endsWith('/(app)/')) &&
      !p.includes('/business/'),
  },
  {
    key: 'search',
    labelKey: 'tabs.search',
    icon: 'search-outline',
    href: '/(app)/browse',
    match: (p) => p.includes('/browse') || p.includes('/map'),
  },
  {
    key: 'appointments',
    labelKey: 'tabs.appointments',
    icon: 'calendar-outline',
    href: '/(app)/my-appointments',
    match: (p) => p.includes('my-appointments'),
  },
  {
    key: 'favorites',
    labelKey: 'tabs.favorites',
    icon: 'heart-outline',
    href: '/(app)/favorites',
    match: (p) => p.includes('/favorites'),
  },
  {
    key: 'account',
    labelKey: 'tabs.account',
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
  const tr = useT();
  const insets = useSafeAreaInsets();
  const pathname = usePathname() || '';
  const [chatUnread, setChatUnread] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => { const n = await fetchUnreadTotal(); if (!cancelled) setChatUnread(n); };
    void refresh();
    const iv = setInterval(() => void refresh(), 60_000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [pathname]);

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
        const count = (badges?.[tab.key] ?? 0) + (tab.key === 'account' ? chatUnread : 0);
        const color = active ? t.colors.accent : t.colors.textMuted;
        return (
          <Pressable
            key={tab.key}
            accessibilityRole="button"
            accessibilityLabel={tr(tab.labelKey)}
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
              {tr(tab.labelKey)}
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
    // Fara overflow hidden: badge-ul (top: -4) era taiat sus. Eticheta are deja numberOfLines=1.
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
