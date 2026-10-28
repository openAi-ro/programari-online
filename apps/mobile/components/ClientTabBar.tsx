import { useCallback, useEffect, useRef, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { router, usePathname } from 'expo-router';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/components/ui';
import { getUnreadTotal } from '@/lib/chatRpc';
import { useForegroundInterval } from '@/lib/useForegroundInterval';
import { useT, type TrKey } from '@/lib/i18n';
import { fontSize, spacing } from '@/constants/theme';
import { TabCountBadge } from '@/components/CountBadge';

type TabKey = 'home' | 'search' | 'appointments' | 'chat' | 'favorites' | 'account';

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
    key: 'chat',
    labelKey: 'tabs.chat',
    icon: 'chatbubbles-outline',
    href: '/(app)/chat',
    match: (p) => p.includes('/chat') && !p.includes('/business/'),
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

const BAR_PAD_X = spacing.xs;
const ITEM_PAD_X = 0;
/** Lățimea celei mai lungi etichete („Programări", „Messages") la weight 600 ≈ 5 em; +8% rezervă. */
const LONGEST_LABEL_EM = 5.4;
const MIN_LABEL_SIZE = 11;

/**
 * Mărimea etichetei din lățimea reală a unui tab: 12 px când încape (≥ ~400 px),
 * coboară în pași de 0,5 px pe ecrane înguste (minim 11 px la 360–390) ca să nu fie tăiată
 * („Program…"). adjustsFontSizeToFit nu există pe web, deci nu ne bazăm pe el.
 */
function labelFontSize(barWidth: number): number {
  const perTab = (barWidth - 2 * BAR_PAD_X) / TABS.length - 2 * ITEM_PAD_X;
  const fit = Math.floor((perTab / LONGEST_LABEL_EM) * 2) / 2;
  return Math.max(MIN_LABEL_SIZE, Math.min(fontSize.xs, fit));
}

/**
 * Client-only bottom bar (6 tabs). Render inside client screens only —
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
  const { width: windowWidth } = useWindowDimensions();
  const [barWidth, setBarWidth] = useState(0);
  const labelSize = labelFontSize(barWidth || windowWidth);
  const pathname = usePathname() || '';
  const [chatUnread, setChatUnread] = useState(0);
  // Necitite: cache partajat (max. o cerere/minut pentru toate tab bar-urile montate),
  // reîmprospătat la schimbarea ecranului și la 60 s doar cât aplicația e în prim-plan.
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  const refresh = useCallback(() => {
    getUnreadTotal()
      .then((n) => { if (mounted.current) setChatUnread(n); })
      .catch(() => {});
  }, []);
  useEffect(() => { refresh(); }, [pathname, refresh]);
  useForegroundInterval(refresh, 60_000);

  return (
    <View
      onLayout={(e) => setBarWidth(e.nativeEvent.layout.width)}
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
        const count = (badges?.[tab.key] ?? 0) + (tab.key === 'chat' ? chatUnread : 0);
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
              <TabCountBadge count={count} />
            </View>
            <Text
              style={[styles.label, { color, fontSize: labelSize }]}
              numberOfLines={1}
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
    paddingHorizontal: BAR_PAD_X,
  },
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    minWidth: 0,
    maxWidth: '100%',
    paddingHorizontal: ITEM_PAD_X,
    // Fara overflow hidden: badge-ul (top: -4) era taiat sus. Eticheta are deja numberOfLines=1.
  },
  label: {
    fontWeight: '600',
    flexShrink: 1,
    minWidth: 0,
    maxWidth: '100%',
    textAlign: 'center',
  },
});
