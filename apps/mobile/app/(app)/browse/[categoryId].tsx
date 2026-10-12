import { useCallback, useMemo, useState } from 'react';
import {
  FlatList,
  StyleSheet,
  View,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import {
  Button,
  Callout,
  EmptyState,
  Field,
  ListLoadingScreen,
  Screen,
  Segmented,
  useTheme,
} from '@/components/ui';
import { ClientTabBar } from '@/components/ClientTabBar';
import { PickerField } from '@/components/PickerField';
import { SalonRow } from '@/components/SalonRow';
import { spacing } from '@/constants/theme';
import {
  getDeviceCoords,
  listPublicBusinesses,
  locationErrorMessage,
  withDistances,
  type DeviceCoords,
  type PublicBusiness,
  type PublicBusinessWithDistance,
} from '@/lib/discover';
import {
  isOpenNow,
  sortBusinesses,
  type BusinessSortKey,
} from '@/lib/browseList';
import {
  BROWSE_CATEGORIES,
  businessMatchesCategory,
  categoryLabel,
  type BrowseCategory,
} from '@/lib/browseCategories';
import { useBack } from '@/lib/nav';
import { trKey, useLanguage, useT } from '@/lib/i18n';
import {
  JUDETE,
  localitatiPentruJudet,
  normalizeRo,
} from '@/lib/roGeo';



/**
 * Pagina dedicată unei categorii: listă + căutare + județ → localitate + aproape de mine.
 * Route: /(app)/browse/[categoryId]
 */
export default function CategoryResultsScreen() {
  const t = useTheme();
  const tr = useT();
  const { lang } = useLanguage();
  const back = useBack();
  const router = useRouter();
  const params = useLocalSearchParams<{ categoryId?: string | string[] }>();
  const categoryId = Array.isArray(params.categoryId)
    ? params.categoryId[0]
    : params.categoryId;

  const category: BrowseCategory | null = useMemo(
    () => BROWSE_CATEGORIES.find((c) => c.key === categoryId) ?? null,
    [categoryId]
  );

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<PublicBusiness[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [selectedCounty, setSelectedCounty] = useState<string | null>(null);
  const [selectedLocality, setSelectedLocality] = useState<string | null>(null);
  const [nearMe, setNearMe] = useState(false);
  const [coords, setCoords] = useState<DeviceCoords | null>(null);
  const [locError, setLocError] = useState<string | null>(null);
  const [locLoading, setLocLoading] = useState(false);
  const [sort, setSort] = useState<BusinessSortKey>('name');
  const [openOnly, setOpenOnly] = useState(false);

  const load = useCallback(async (opts?: { q?: string }) => {
    setError(null);
    const { rows: next, error: err } = await listPublicBusinesses({
      q: opts?.q,
      limit: 100,
    });
    setRows(next);
    if (err) setError(err);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void load({});
    }, [load])
  );

  const categoryRows = useMemo(() => {
    if (!category) return [] as PublicBusiness[];
    return rows.filter((r) => businessMatchesCategory(r, category));
  }, [rows, category]);

  // Nomenclator complet RO (toate județele), nu doar cele din business-urile încărcate.
  const countyOptions = useMemo(() => [trKey('browse.allCounties'), ...JUDETE], [lang]);
  const localityOptions = useMemo(
    () =>
      selectedCounty
        ? [trKey('browse.allLocalities'), ...localitatiPentruJudet(selectedCounty)]
        : [trKey('browse.allLocalities')],
    [selectedCounty, lang]
  );

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    let list = categoryRows;
    if (qq) {
      list = list.filter(
        (r) =>
          r.name.toLowerCase().includes(qq) ||
          r.public_code.toLowerCase().includes(qq)
      );
    }
    if (selectedCounty) {
      const needle = normalizeRo(selectedCounty);
      list = list.filter((r) => normalizeRo(r.county) === needle);
    }
    if (selectedLocality) {
      const needle = normalizeRo(selectedLocality);
      list = list.filter((r) => normalizeRo(r.city) === needle);
    }
    if (openOnly) {
      // Randurile fara program cunoscut raman vizibile (nu s-a dovedit inchis).
      list = list.filter((r) => isOpenNow(r.working_hours, r.timezone) !== false);
    }
    const withDist =
      nearMe && coords
        ? withDistances(list, coords)
        : list.map((r) => ({ ...r, distanceKm: null as number | null }));
    return sortBusinesses(withDist, sort, (r) => r.distanceKm);
  }, [categoryRows, q, selectedCounty, selectedLocality, openOnly, nearMe, coords, sort]);

  const onSearch = useCallback(() => {
    setLoading(true);
    void load({ q: q.trim() || undefined });
  }, [load, q]);

  const onCountyChange = useCallback((next: string) => {
    const county = next === trKey('browse.allCounties') ? null : next;
    setSelectedCounty(county);
    setSelectedLocality(null);
  }, []);

  const onLocalityChange = useCallback((next: string) => {
    setSelectedLocality(next === trKey('browse.allLocalities') ? null : next);
  }, []);

  const onNearMe = useCallback(async () => {
    if (nearMe) {
      setNearMe(false);
      setLocError(null);
      return;
    }
    setLocLoading(true);
    setLocError(null);
    try {
      const device = await getDeviceCoords();
      setCoords(device);
      setNearMe(true);
    } catch (err) {
      setCoords(null);
      setNearMe(false);
      setLocError(locationErrorMessage(err));
    } finally {
      setLocLoading(false);
    }
  }, [nearMe]);

  if (!category) {
    return (
      <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
        <Screen title={tr('cat.unknownTitle')} subtitle={tr('cat.unknownSub')} onBack={back}>
          <EmptyState
            icon="grid-outline"
            title={tr('cat.invalid')}
            description={tr('cat.invalidDesc')}
            action={
              <Button
                label={tr('cat.backToSearch')}
                icon="search-outline"
                onPress={() => router.replace('/(app)/browse' as never)}
              />
            }
          />
        </Screen>
        <ClientTabBar />
      </View>
    );
  }

  if (loading && rows.length === 0 && !error) {
    return (
      <ListLoadingScreen
        title={categoryLabel(category)}
        subtitle={tr('cat.inCategory')}
        onBack={back}
        label={tr('common.loading')}
      />
    );
  }

  const subtitle =
    nearMe && coords
      ? tr('cat.countDist', { n: filtered.length })
      : tr('cat.count', { n: filtered.length });

  const catName = category ? categoryLabel(category) : '';
  const emptyDescription = (() => {
    if (selectedLocality && selectedCounty) {
      return tr('cat.emptyInCity', { label: catName, city: selectedLocality, county: selectedCounty });
    }
    if (selectedCounty) {
      return tr('cat.emptyInCounty', { label: catName, county: selectedCounty });
    }
    if (q.trim()) {
      return tr('cat.emptyForQuery', { label: catName, q: q.trim() });
    }
    return tr('cat.emptyGeneric', { label: catName });
  })();

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
      <Screen title={catName} subtitle={subtitle} onBack={back} scroll={false}>
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <View style={{ gap: spacing.md }}>
              <Field
                label={tr('cat.searchIn')}
                icon="search-outline"
                value={q}
                onChangeText={setQ}
                placeholder={tr('cat.searchPlaceholder')}
                autoCapitalize="none"
                returnKeyType="search"
                onSubmitEditing={onSearch}
              />

              <PickerField
                label={tr('browse.county')}
                value={selectedCounty ?? trKey('browse.allCounties')}
                options={countyOptions}
                onChange={onCountyChange}
                placeholder={tr('browse.pickCounty')}
                icon="map-outline"
                hint={tr('browse.allCountiesRo')}
              />

              <PickerField
                label={tr('browse.locality')}
                value={selectedLocality ?? trKey('browse.allLocalities')}
                options={localityOptions}
                onChange={onLocalityChange}
                placeholder={
                  selectedCounty ? tr('browse.pickLocality') : tr('browse.pickCountyFirst')
                }
                icon="business-outline"
                disabled={!selectedCounty}
                hint={
                  selectedCounty
                    ? undefined
                    : tr('browse.localityHint')
                }
              />

              <View style={styles.actions}>
                <Button
                  label={tr('tabs.search')}
                  icon="search-outline"
                  size="sm"
                  fullWidth={false}
                  onPress={onSearch}
                />
                <Button
                  label={tr('browse.nearMe')}
                  icon="navigate-outline"
                  variant={nearMe ? 'primary' : 'secondary'}
                  size="sm"
                  loading={locLoading}
                  fullWidth={false}
                  onPress={() => void onNearMe()}
                />
                <Button
                  label={tr('cat.allCategories')}
                  icon="grid-outline"
                  variant="secondary"
                  size="sm"
                  fullWidth={false}
                  onPress={() => router.replace('/(app)/browse' as never)}
                />
              </View>

              <Segmented
                value={sort}
                onChange={setSort}
                options={
                  nearMe && coords
                    ? [
                        { value: 'distance', label: tr('cat.sortDistance') },
                        { value: 'rating', label: tr('cat.sortRating') },
                        { value: 'name', label: tr('cat.sortName') },
                      ]
                    : [
                        { value: 'rating', label: tr('cat.sortRating') },
                        { value: 'name', label: tr('cat.sortName') },
                      ]
                }
              />
              <View style={styles.actions}>
                <Button
                  label={tr('browse.openNow')}
                  icon="time-outline"
                  variant={openOnly ? 'primary' : 'secondary'}
                  size="sm"
                  fullWidth={false}
                  onPress={() => setOpenOnly((v) => !v)}
                />
              </View>

              {locError ? (
                <Callout tone="warning" title={tr('cat.locUnavailable')}>
                  {locError}
                </Callout>
              ) : null}
              {error ? (
                <Callout tone="warning" title={tr('browse.partialList')}>
                  {tr('cat.partialDesc', { error: error ?? '' })}
                </Callout>
              ) : null}
            </View>
          }
          ListEmptyComponent={
            <EmptyState
              icon="storefront-outline"
              title={tr('cat.noResults')}
              description={emptyDescription}
              action={
                selectedCounty || selectedLocality || q.trim() ? (
                  <Button
                    label={tr('browse.clearFilters')}
                    icon="close-outline"
                    onPress={() => {
                      setSelectedCounty(null);
                      setSelectedLocality(null);
                      setQ('');
                      setLoading(true);
                      void load({});
                    }}
                  />
                ) : (
                  <Button
                    label={tr('cat.backToSearch')}
                    icon="search-outline"
                    onPress={() => router.replace('/(app)/browse' as never)}
                  />
                )
              }
            />
          }
          renderItem={({ item }) => (
            <SalonRow
              item={item}
              openNow={isOpenNow(item.working_hours, item.timezone)}
              onPress={() => router.push(`/(app)/book/${item.public_code}` as never)}
            />
          )}
        />
      </Screen>
      <ClientTabBar />
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    padding: spacing.lg,
    gap: spacing.md,
    flexGrow: 1,
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
