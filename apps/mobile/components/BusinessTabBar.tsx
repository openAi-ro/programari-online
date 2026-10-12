import { Ionicons } from '@expo/vector-icons';
import { router, usePathname } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/components/ui';
import { useT, type TrKey } from '@/lib/i18n';
import { spacing } from '@/constants/theme';
import { markNavStart } from '@/lib/navTiming';

type TabKey = 'home' | 'requests' | 'clients' | 'reports' | 'settings';

type TabBarRoute = { key: string; name: string; params?: object };
type TabBarNavProps = {
  state?: { index: number; routes: TabBarRoute[] };
  navigation?: { navigate: (name: string, params?: object) => void };
};

const TABS: {
  key: TabKey;
  labelKey: TrKey;
  icon: keyof typeof Ionicons.glyphMap;
  /** Fallback href when not rendered as Tabs tabBar (legacy / outside tabs). */
  href: string;
  routeName: string;
  match: (path: string) => boolean;
}[] = [
  {
    key: 'home',
    labelKey: 'bizTabs.home',
    icon: 'home-outline',
    href: '/(app)/business/(tabs)',
    routeName: 'index',
    match: (p) =>
      (p.includes('/business') &&
        (p.endsWith('/business') ||
          p.endsWith('/business/') ||
          p.includes('/business/(tabs)') ||
          p.match(/\/business\/?$/) != null)) ||
      ((p.includes('/home') || p.endsWith('/(app)') || p.endsWith('/(app)/')) &&
        !p.includes('/business/')),
  },
  {
    key: 'requests',
    labelKey: 'bizTabs.requests',
    icon: 'file-tray-full-outline',
    href: '/(app)/business/(tabs)/requests',
    routeName: 'requests',
    match: (p) => p.includes('/business/(tabs)/requests'),
  },
  {
    key: 'clients',
    labelKey: 'bizTabs.clients',
    icon: 'people-outline',
    href: '/(app)/business/(tabs)/clients',
    routeName: 'clients',
    match: (p) => p.includes('/business/(tabs)/clients'),
  },
  {
    key: 'reports',
    labelKey: 'bizTabs.reports',
    icon: 'stats-chart-outline',
    href: '/(app)/business/(tabs)/reports',
    routeName: 'reports',
    match: (p) => p.includes('/business/(tabs)/reports'),
  },
  {
    key: 'settings',
    labelKey: 'bizTabs.settings',
    icon: 'settings-outline',
    href: '/(app)/business/(tabs)/settings',
    routeName: 'settings',
    match: (p) =>
      p.includes('/business/(tabs)/settings') ||
      (p.includes('/settings') && p.includes('/business')),
  },
];

/**
 * Business-only bottom bar (5 tabs).
 * Preferred: rendered once as Tabs `tabBar={...}` so screens stay mounted.
 * Fallback: pathname + router.replace (should be rare after Pas 5).
 */
export function BusinessTabBar({
  badges,
  state,
  navigation,
  onRequestsFocus,
}: {
  badges?: Partial<Record<TabKey, number>>;
  onRequestsFocus?: () => void;
} & TabBarNavProps) {
  const t = useTheme();
  const tr = useT();
  const insets = useSafeAreaInsets();
  const pathname = usePathname() || '';
  const fromTabs = Boolean(state && navigation);

  const activeKeyFromTabs: TabKey | null = fromTabs
    ? (() => {
        const route = state!.routes[state!.index];
        const found = TABS.find((tab) => tab.routeName === route?.name);
        return found?.key ?? null;
      })()
    : null;

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
        const active = fromTabs
          ? activeKeyFromTabs === tab.key
          : tab.match(pathname);
        const count = badges?.[tab.key] ?? 0;
        const color = active ? t.colors.accent : t.colors.textMuted;
        return (
          <Pressable
            key={tab.key}
            accessibilityRole="button"
            accessibilityLabel={
              tab.key === 'requests' ? tr('bizTabs.requestsA11y') : tr(tab.labelKey)
            }
            onPress={() => {
              if (active) {
                if (tab.key === 'requests') onRequestsFocus?.();
                return;
              }
              markNavStart(tab.key);
              if (fromTabs && state && navigation) {
                const route = state.routes.find((r: TabBarRoute) => r.name === tab.routeName);
                if (route) {
                  navigation.navigate(route.name, route.params);
                } else {
                  navigation.navigate(tab.routeName);
                }
                if (tab.key === 'requests') onRequestsFocus?.();
                return;
              }
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
            <Text style={[styles.label, { color }]} numberOfLines={1}>
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
    gap: 2,
    minWidth: 0,
  },
  label: {
    fontSize: 10,
    fontWeight: '600',
    flexShrink: 1,
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
