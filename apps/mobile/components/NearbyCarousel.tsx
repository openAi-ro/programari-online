import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { Button, Callout, EmptyState, SectionTitle, Skeleton, useTheme } from '@/components/ui';
import { PickerField } from '@/components/PickerField';
import { fontSize, radius, spacing } from '@/constants/theme';
import { BROWSE_CATEGORIES, categoryLabelForKey } from '@/lib/browseCategories';
import { visibleCoverUrl } from '@/lib/businessPage';
import {
  formatDistanceKm,
  getDeviceCoords,
  hasGrantedLocation,
  listPublicBusinesses,
  withDistances,
  type DeviceCoords,
  type PublicBusiness,
  type PublicBusinessWithDistance,
} from '@/lib/discover';
import { useT } from '@/lib/i18n';
import {
  carouselLayout,
  NEARBY_RADIUS_KM,
  nearestOffsetIndex,
  roundCoords,
  selectNearby,
  type NearbyArea,
} from '@/lib/nearby';
import { loadNearbyPrefs, saveNearbyPrefs } from '@/lib/nearbyPrefs';
import { JUDETE, localitatiPentruJudet } from '@/lib/roGeo';

const LOCATE_TIMEOUT_MS = 8000;
const GAP = spacing.md;
const SEE_ALL = '__see_all__';

type Item = PublicBusinessWithDistance | typeof SEE_ALL;
type LocState = 'idle' | 'locating' | 'denied' | 'failed';

/**
 * Carusel „Lângă tine (20 km)” pe ecranul principal al clientului.
 * Locația se cere doar la apăsare, aproximativ, rotunjită și ținută doar în memorie;
 * fallback: zona aleasă (județ / localitate), apoi toate business-urile.
 */
export function NearbyCarousel() {
  const t = useTheme();
  const tr = useT();
  const [businesses, setBusinesses] = useState<PublicBusiness[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [coords, setCoords] = useState<DeviceCoords | null>(null);
  const [locState, setLocState] = useState<LocState>('idle');
  const [area, setArea] = useState<NearbyArea | null>(null);
  const [width, setWidth] = useState(0);
  const [index, setIndex] = useState(0);
  const listRef = useRef<FlatList<Item>>(null);

  const accept = useCallback(async (c: DeviceCoords) => {
    setCoords(roundCoords(c));
    setLocState('idle');
    const prefs = await loadNearbyPrefs();
    await saveNearbyPrefs({ ...prefs, locationAllowed: true });
  }, []);

  const locate = useCallback(async () => {
    setLocState('locating');
    try {
      const c = await getDeviceCoords({
        approximate: true,
        timeoutMs: LOCATE_TIMEOUT_MS,
        // „Allow” apăsat după ce am arătat eroarea: poziția înlocuiește mesajul.
        onLatePosition: (late) => void accept(late),
      });
      await accept(c);
    } catch (err) {
      const denied = err instanceof Error && err.message === 'permission_denied';
      setLocState(denied ? 'denied' : 'failed');
      if (denied) {
        const prefs = await loadNearbyPrefs();
        await saveNearbyPrefs({ ...prefs, locationAllowed: false });
      }
    }
  }, [accept]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const { rows, error } = await listPublicBusinesses({ limit: 200 });
      if (!alive) return;
      setBusinesses(rows);
      setListError(error);
    })();
    void (async () => {
      const prefs = await loadNearbyPrefs();
      if (!alive) return;
      setArea(prefs.area);
      // Fără dialog la pornire: doar dacă clientul a ales deja și permisiunea e acordată.
      if (prefs.locationAllowed && (await hasGrantedLocation()) && alive) void locate();
    })();
    return () => {
      alive = false;
    };
  }, [locate]);

  const selection = useMemo(
    () => selectNearby(withDistances(businesses ?? [], coords), area),
    [businesses, coords, area]
  );

  function changeArea(next: NearbyArea | null) {
    setArea(next);
    void loadNearbyPrefs().then((p) => saveNearbyPrefs({ ...p, area: next }));
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
    setIndex(0);
  }

  const allCounties = tr('browse.allCounties');
  const allLocalities = tr('browse.allLocalities');
  const countyOptions = useMemo(() => [allCounties, ...JUDETE], [allCounties]);
  const localityOptions = useMemo(
    () => (area?.county ? [allLocalities, ...localitatiPentruJudet(area.county)] : [allLocalities]),
    [area?.county, allLocalities]
  );

  const title =
    selection.mode === 'near'
      ? tr('nearby.titleNear', { km: NEARBY_RADIUS_KM })
      : selection.mode === 'area'
        ? selection.byCity
          ? tr('nearby.titleCity', { city: selection.label })
          : tr('nearby.titleCounty', { county: selection.label })
        : tr('nearby.titleAll');

  const data: Item[] = selection.rows.length > 0 ? [...selection.rows, SEE_ALL] : [];
  // Lățimea cardurilor vine din lățimea reală a containerului (onLayout).
  const layout = carouselLayout(width, data.length, { gap: GAP });
  const cardW = layout.cardWidth;
  const offsets = layout.offsets;
  const showArrows = Platform.OS === 'web' && !layout.fitsAll;

  function scrollTo(i: number) {
    const clamped = Math.max(0, Math.min(offsets.length - 1, i));
    listRef.current?.scrollToOffset({ offset: offsets[clamped], animated: true });
    setIndex(clamped);
  }

  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    setIndex(nearestOffsetIndex(offsets, e.nativeEvent.contentOffset.x));
  }

  const showPrompt = coords == null && locState !== 'locating';

  return (
    <View style={styles.wrap} onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}>
      <SectionTitle
        action={
          showArrows ? (
            <View style={styles.arrows}>
              <ArrowButton icon="chevron-back" label={tr('nearby.prev')} disabled={index <= 0} onPress={() => scrollTo(index - 1)} />
              <ArrowButton
                icon="chevron-forward"
                label={tr('nearby.next')}
                disabled={index >= offsets.length - 1}
                onPress={() => scrollTo(index + 1)}
              />
            </View>
          ) : undefined
        }
      >
        {title}
      </SectionTitle>

      {locState === 'locating' ? (
        <View style={styles.locating}>
          <ActivityIndicator color={t.colors.accent} />
          <Text style={[styles.muted, { color: t.colors.textMuted }]}>{tr('nearby.locating')}</Text>
        </View>
      ) : null}

      {showPrompt && locState !== 'idle' && !area ? (
        <Callout tone="warning" title={tr('nearby.locFailTitle')}>
          {locState === 'denied' ? tr('nearby.deniedDesc') : tr('nearby.failedDesc')}
        </Callout>
      ) : null}
      {showPrompt && locState === 'idle' ? (
        <View style={[styles.prompt, { backgroundColor: t.colors.accentSoft, borderColor: t.colors.border }]}>
          <View style={styles.promptRow}>
            <Ionicons name="navigate-circle-outline" size={26} color={t.colors.accentSoftText} />
            <Text style={[styles.promptText, { color: t.colors.accentSoftText }]}>
              {tr('nearby.promptDesc', { km: NEARBY_RADIUS_KM })}
            </Text>
          </View>
          <Button label={tr('nearby.promptBtn')} icon="navigate-outline" onPress={() => void locate()} />
        </View>
      ) : null}
      {showPrompt && locState !== 'idle' ? (
        <Button label={tr('nearby.retry')} icon="navigate-outline" variant="secondary" onPress={() => void locate()} />
      ) : null}

      {coords && selection.mode !== 'near' ? (
        <Callout tone="info">{tr('nearby.noneNear', { km: NEARBY_RADIUS_KM })}</Callout>
      ) : null}

      {selection.mode !== 'near' ? (
        <View style={styles.pickers}>
          <View style={styles.picker}>
            <PickerField
              label={tr('browse.county')}
              value={area?.county ?? allCounties}
              options={countyOptions}
              onChange={(v) => changeArea(v === allCounties ? null : { county: v, city: null })}
              icon="map-outline"
            />
          </View>
          <View style={styles.picker}>
            <PickerField
              label={tr('browse.locality')}
              value={area?.city ?? allLocalities}
              options={localityOptions}
              disabled={!area?.county}
              onChange={(v) => changeArea({ county: area?.county ?? null, city: v === allLocalities ? null : v })}
              icon="business-outline"
            />
          </View>
        </View>
      ) : null}

      {businesses == null ? (
        <View style={styles.skeletonRow}>
          <Skeleton width={cardW} height={210} radius={radius.lg} />
          <Skeleton width={Math.round(cardW * 0.4)} height={210} radius={radius.lg} />
        </View>
      ) : data.length === 0 ? (
        <EmptyState
          compact
          icon="storefront-outline"
          title={listError ? tr('nearby.loadFail') : tr('nearby.empty')}
          description={listError ?? tr('nearby.emptyDesc')}
        />
      ) : (
        <FlatList
          ref={listRef}
          testID="nearby-list"
          data={data}
          horizontal
          keyExtractor={(item) => (item === SEE_ALL ? SEE_ALL : item.id)}
          showsHorizontalScrollIndicator={false}
          scrollEnabled={!layout.fitsAll}
          snapToOffsets={offsets}
          snapToEnd
          decelerationRate="fast"
          disableIntervalMomentum
          style={Platform.OS === 'web' ? (webSnapList as object) : undefined}
          initialNumToRender={3}
          windowSize={5}
          onScroll={onScroll}
          scrollEventThrottle={64}
          contentContainerStyle={styles.listContent}
          ItemSeparatorComponent={() => <View style={{ width: GAP }} />}
          renderItem={({ item, index: i }) => (
            // Pe web snap-ul e CSS: ultimul card se aliniază la dreapta, deci e mereu întreg.
            <View style={Platform.OS === 'web' ? ((i === data.length - 1 ? webSnapEnd : webSnapStart) as object) : undefined}>
              {item === SEE_ALL ? <SeeAllCard width={cardW} /> : <BusinessCard biz={item} width={cardW} />}
            </View>
          )}
        />
      )}
    </View>
  );
}

function ArrowButton({
  icon,
  label,
  disabled,
  onPress,
}: {
  icon: 'chevron-back' | 'chevron-forward';
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.arrow,
        { borderColor: t.colors.borderStrong, backgroundColor: t.colors.surface, opacity: disabled ? 0.4 : pressed ? 0.8 : 1 },
      ]}
    >
      <Ionicons name={icon} size={18} color={t.colors.text} />
    </Pressable>
  );
}

function BusinessCard({ biz, width }: { biz: PublicBusinessWithDistance; width: number }) {
  const t = useTheme();
  const tr = useT();
  const category = BROWSE_CATEGORIES.find((c) => c.key === biz.category) ?? null;
  const cover = visibleCoverUrl(biz);
  const distance = formatDistanceKm(biz.distanceKm);
  const meta = [categoryLabelForKey(biz.category), distance, biz.city].filter(Boolean).join(' · ');
  return (
    <View testID="nearby-card" style={[styles.card, { width, backgroundColor: t.colors.surface, borderColor: t.colors.border }]}>
      <View style={[styles.media, { backgroundColor: t.colors.surfaceMuted }]}>
        {cover ? (
          <Image source={{ uri: cover }} style={styles.photo} resizeMode="cover" accessibilityIgnoresInvertColors />
        ) : biz.logo_url ? (
          <Image source={{ uri: biz.logo_url }} style={styles.logo} resizeMode="contain" accessibilityIgnoresInvertColors />
        ) : category ? (
          <Image source={category.image} style={styles.photo} resizeMode="cover" accessibilityIgnoresInvertColors />
        ) : (
          <Ionicons name="storefront-outline" size={40} color={t.colors.textFaint} />
        )}
      </View>
      <View style={styles.cardBody}>
        <Text style={[styles.name, styles.fill, { color: t.colors.text }]} numberOfLines={2}>
          {biz.name}
        </Text>
        <Text style={[styles.muted, styles.fill, { color: t.colors.textMuted }]} numberOfLines={2}>
          {meta || ' '}
        </Text>
        <Button
          size="sm"
          label={tr('nearby.book')}
          icon="calendar-outline"
          onPress={() => router.push(`/(app)/book/${biz.public_code}` as never)}
        />
      </View>
    </View>
  );
}

function SeeAllCard({ width }: { width: number }) {
  const t = useTheme();
  const tr = useT();
  return (
    <View testID="nearby-card" style={[styles.card, styles.seeAll, { width, backgroundColor: t.colors.accentSoft, borderColor: t.colors.border }]}>
      <Ionicons name="map-outline" size={36} color={t.colors.accentSoftText} />
      <Text style={[styles.name, styles.fill, { color: t.colors.accentSoftText, textAlign: 'center' }]}>
        {tr('nearby.seeAll')}
      </Text>
      <Text style={[styles.muted, styles.fill, { color: t.colors.accentSoftText, textAlign: 'center' }]}>
        {tr('nearby.seeAllDesc')}
      </Text>
      <View style={styles.fill}>
        <Button size="sm" variant="secondary" label={tr('nearby.seeAll')} onPress={() => router.push('/(app)/map' as never)} />
      </View>
    </View>
  );
}

const webSnapList = { scrollSnapType: 'x mandatory' };
const webSnapStart = { scrollSnapAlign: 'start' };
const webSnapEnd = { scrollSnapAlign: 'end' };

const styles = StyleSheet.create({
  fill: { alignSelf: 'stretch', minWidth: 0, flexShrink: 1 },
  wrap: { gap: spacing.sm },
  arrows: { flexDirection: 'row', gap: spacing.xs },
  arrow: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  locating: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  prompt: { gap: spacing.md, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1 },
  promptRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  promptText: { flex: 1, fontSize: fontSize.sm },
  muted: { fontSize: fontSize.sm },
  pickers: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  picker: { flexGrow: 1, flexBasis: 160 },
  skeletonRow: { flexDirection: 'row', gap: GAP, overflow: 'hidden' },
  listContent: { paddingVertical: spacing.xs },
  card: { borderWidth: 1, borderRadius: radius.lg, overflow: 'hidden' },
  media: { height: 110, alignItems: 'center', justifyContent: 'center' },
  logo: { width: '70%', height: 90 },
  photo: { width: '100%', height: '100%' },
  cardBody: { padding: spacing.md, gap: spacing.xs },
  name: { fontSize: fontSize.md, fontWeight: '800' },
  seeAll: { padding: spacing.lg, gap: spacing.sm, alignItems: 'center', justifyContent: 'center' },
});
