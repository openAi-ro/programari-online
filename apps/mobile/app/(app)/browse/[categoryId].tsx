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
  type BrowseCategory,
} from '@/lib/browseCategories';
import { useBack } from '@/lib/nav';
import {
  JUDETE,
  localitatiPentruJudet,
  normalizeRo,
} from '@/lib/roGeo';

const ALL_COUNTIES_LABEL = 'Toate județele';
const ALL_LOCALITIES_LABEL = 'Toate localitățile';

/**
 * Pagina dedicată unei categorii: listă + căutare + județ → localitate + aproape de mine.
 * Route: /(app)/browse/[categoryId]
 */
export default function CategoryResultsScreen() {
  const t = useTheme();
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
  const countyOptions = useMemo(() => [ALL_COUNTIES_LABEL, ...JUDETE], []);
  const localityOptions = useMemo(
    () =>
      selectedCounty
        ? [ALL_LOCALITIES_LABEL, ...localitatiPentruJudet(selectedCounty)]
        : [ALL_LOCALITIES_LABEL],
    [selectedCounty]
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
    const county = next === ALL_COUNTIES_LABEL ? null : next;
    setSelectedCounty(county);
    setSelectedLocality(null);
  }, []);

  const onLocalityChange = useCallback((next: string) => {
    setSelectedLocality(next === ALL_LOCALITIES_LABEL ? null : next);
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
        <Screen title="Categorie" subtitle="Necunoscută" onBack={back}>
          <EmptyState
            icon="grid-outline"
            title="Categorie invalidă"
            description="Revino la Caută și alege o casetă din listă."
            action={
              <Button
                label="Înapoi la Caută"
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
        title={category.label}
        subtitle="Business-uri din această categorie"
        onBack={back}
        label="Se încarcă…"
      />
    );
  }

  const subtitle =
    nearMe && coords
      ? `${filtered.length} business-uri · sortate după distanță`
      : `${filtered.length} business-uri`;

  const emptyDescription = (() => {
    if (selectedLocality && selectedCounty) {
      return `Niciun business „${category.label}” în ${selectedLocality}, ${selectedCounty}.`;
    }
    if (selectedCounty) {
      return `Niciun business „${category.label}” în județul ${selectedCounty}.`;
    }
    if (q.trim()) {
      return `Niciun business „${category.label}” pentru „${q.trim()}”.`;
    }
    return `Niciun business găsit pentru „${category.label}”.`;
  })();

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
      <Screen title={category.label} subtitle={subtitle} onBack={back} scroll={false}>
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <View style={{ gap: spacing.md }}>
              <Field
                label="Caută în categorie"
                icon="search-outline"
                value={q}
                onChangeText={setQ}
                placeholder="Nume sau cod public"
                autoCapitalize="none"
                returnKeyType="search"
                onSubmitEditing={onSearch}
              />

              <PickerField
                label="Județ"
                value={selectedCounty ?? ALL_COUNTIES_LABEL}
                options={countyOptions}
                onChange={onCountyChange}
                placeholder="Alege județul"
                icon="map-outline"
                hint="Toate județele din România"
              />

              <PickerField
                label="Localitate"
                value={selectedLocality ?? ALL_LOCALITIES_LABEL}
                options={localityOptions}
                onChange={onLocalityChange}
                placeholder={
                  selectedCounty ? 'Alege localitatea' : 'Alege mai întâi județul'
                }
                icon="business-outline"
                disabled={!selectedCounty}
                hint={
                  selectedCounty
                    ? undefined
                    : 'Lista localităților apare după ce alegi județul.'
                }
              />

              <View style={styles.actions}>
                <Button
                  label="Caută"
                  icon="search-outline"
                  size="sm"
                  fullWidth={false}
                  onPress={onSearch}
                />
                <Button
                  label="Aproape de mine"
                  icon="navigate-outline"
                  variant={nearMe ? 'primary' : 'secondary'}
                  size="sm"
                  loading={locLoading}
                  fullWidth={false}
                  onPress={() => void onNearMe()}
                />
                <Button
                  label="Toate categoriile"
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
                        { value: 'distance', label: 'Distanță' },
                        { value: 'rating', label: 'Rating' },
                        { value: 'name', label: 'Nume' },
                      ]
                    : [
                        { value: 'rating', label: 'Rating' },
                        { value: 'name', label: 'Nume' },
                      ]
                }
              />
              <View style={styles.actions}>
                <Button
                  label="Deschis acum"
                  icon="time-outline"
                  variant={openOnly ? 'primary' : 'secondary'}
                  size="sm"
                  fullWidth={false}
                  onPress={() => setOpenOnly((v) => !v)}
                />
              </View>

              {locError ? (
                <Callout tone="warning" title="Locație indisponibilă">
                  {locError}
                </Callout>
              ) : null}
              {error ? (
                <Callout tone="warning" title="Listă parțială">
                  {`Nu am putut încărca tot (${error}).`}
                </Callout>
              ) : null}
            </View>
          }
          ListEmptyComponent={
            <EmptyState
              icon="storefront-outline"
              title="Niciun rezultat"
              description={emptyDescription}
              action={
                selectedCounty || selectedLocality || q.trim() ? (
                  <Button
                    label="Șterge filtrele"
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
                    label="Înapoi la Caută"
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
