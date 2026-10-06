import { useCallback, useMemo, useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import {
  Button,
  Callout,
  Field,
  ListLoadingScreen,
  Screen,
  useTheme,
} from '@/components/ui';
import { ClientTabBar } from '@/components/ClientTabBar';
import { PickerField } from '@/components/PickerField';
import { SalonRow } from '@/components/SalonRow';
import { fontSize, radius, spacing } from '@/constants/theme';
import { isOpenNow, sortBusinesses } from '@/lib/browseList';
import {
  listPublicBusinesses,
  type PublicBusiness,
} from '@/lib/discover';
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

const ALL_COUNTIES = 'Toate județele';
const ALL_LOCALITIES = 'Toate localitățile';

function CategoryTile({
  cat,
  selected,
  count,
  onPress,
}: {
  cat: BrowseCategory;
  selected: boolean;
  count: number;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Categorie ${cat.label}, ${count} business-uri`}
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.catTile,
        {
          borderColor: selected ? t.colors.accent : t.colors.border,
          backgroundColor: t.colors.surface,
          opacity: pressed ? 0.9 : 1,
        },
        t.shadows.sm,
      ]}
    >
      <Image
        source={cat.image}
        style={styles.catImage}
        resizeMode="cover"
        accessibilityIgnoresInvertColors
      />
      <View
        style={[
          styles.catCountBadge,
          {
            backgroundColor: count > 0 ? t.colors.accent : 'rgba(15,23,42,0.55)',
          },
        ]}
      >
        <Text style={styles.catCountText}>{count}</Text>
      </View>
      <View
        style={[
          styles.catLabelWrap,
          {
            backgroundColor: selected ? 'rgba(37,99,235,0.88)' : 'rgba(15,23,42,0.62)',
          },
        ]}
      >
        <Text
          style={[styles.catLabel, { color: '#ffffff' }]}
          numberOfLines={2}
        >
          {cat.label}
        </Text>
      </View>
    </Pressable>
  );
}

function CategoryGrid({
  counts,
  onSelect,
}: {
  counts: Record<string, number>;
  onSelect: (cat: BrowseCategory) => void;
}) {
  const t = useTheme();
  return (
    <View style={styles.catSection}>
      <Text style={[styles.catSectionTitle, { color: t.colors.text }]}>Categorii</Text>
      <Text style={[styles.catSectionHint, { color: t.colors.textMuted }]}>
        Alege o categorie — deschide lista de business-uri
      </Text>
      <View style={styles.catGrid}>
        {BROWSE_CATEGORIES.map((cat) => (
          <CategoryTile
            key={cat.key}
            cat={cat}
            selected={false}
            count={counts[cat.key] ?? 0}
            onPress={() => onSelect(cat)}
          />
        ))}
      </View>
    </View>
  );
}

/**
 * Descoperire — hub de categorii.
 * Căutare / județ / localitate ajustează contorii; lista de business-uri e pe [categoryId].
 */
export default function BrowseScreen() {
  const t = useTheme();
  const back = useBack();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<PublicBusiness[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [selectedCounty, setSelectedCounty] = useState<string | null>(null);
  const [selectedLocality, setSelectedLocality] = useState<string | null>(null);

  // Nomenclator complet RO (nu doar județele din business-urile încărcate).
  const countyOptions = useMemo(() => [ALL_COUNTIES, ...JUDETE], []);
  const localityOptions = useMemo(
    () =>
      selectedCounty
        ? [ALL_LOCALITIES, ...localitatiPentruJudet(selectedCounty)]
        : [ALL_LOCALITIES],
    [selectedCounty]
  );

  const matchesFilters = useCallback(
    (r: PublicBusiness) => {
      const qq = q.trim().toLowerCase();
      if (
        qq &&
        !r.name.toLowerCase().includes(qq) &&
        !r.public_code.toLowerCase().includes(qq)
      ) {
        return false;
      }
      if (selectedCounty) {
        if (normalizeRo(r.county) !== normalizeRo(selectedCounty)) return false;
      }
      if (selectedLocality) {
        if (normalizeRo(r.city) !== normalizeRo(selectedLocality)) return false;
      }
      return true;
    },
    [q, selectedCounty, selectedLocality]
  );

  const categoryCounts = useMemo(() => {
    const base = rows.filter(matchesFilters);
    const map: Record<string, number> = {};
    for (const cat of BROWSE_CATEGORIES) {
      map[cat.key] = base.filter((r) => businessMatchesCategory(r, cat)).length;
    }
    return map;
  }, [rows, matchesFilters]);

  const hasActiveFilters = q.trim() !== '' || selectedCounty != null || selectedLocality != null;

  const searchResults = useMemo(() => {
    if (!hasActiveFilters) return [] as PublicBusiness[];
    return sortBusinesses(rows.filter(matchesFilters), 'name');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hasActiveFilters derives from same inputs
  }, [rows, matchesFilters, hasActiveFilters]);

  const load = useCallback(
    async (opts?: { q?: string; city?: string; county?: string }) => {
      setError(null);
      const { rows: next, error: err } = await listPublicBusinesses({
        q: opts?.q,
        city: opts?.city,
        county: opts?.county,
        limit: 100,
      });
      setRows(next);
      if (err) setError(err);
      setLoading(false);
    },
    []
  );

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      // Încărcăm lista largă pentru contori categorii; filtrele se aplică local.
      void load({});
      // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh on focus
    }, [load])
  );

  const onSearch = useCallback(() => {
    setLoading(true);
    // Doar q pe server; judet/localitate raman filtre client pe lista incarcata.
    void load({
      q: q.trim() || undefined,
    });
  }, [load, q]);

  const onSelectCategory = useCallback(
    (cat: BrowseCategory) => {
      router.push(`/(app)/browse/${cat.key}` as never);
    },
    [router]
  );

  const onCountyChange = useCallback((next: string) => {
    const county = next === ALL_COUNTIES ? null : next;
    setSelectedCounty(county);
    setSelectedLocality(null);
  }, []);

  const onLocalityChange = useCallback((next: string) => {
    setSelectedLocality(next === ALL_LOCALITIES ? null : next);
  }, []);

  if (loading && rows.length === 0 && !error) {
    return (
      <ListLoadingScreen
        title="Caută business"
        subtitle="Alege o categorie"
        onBack={back}
        label="Se încarcă…"
      />
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
      <Screen
        title="Caută business"
        subtitle="Alege o categorie — sau filtrează după nume, județ și localitate"
        onBack={back}
        scroll={false}
      >
        <ScrollView
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
        >
          <View style={{ gap: spacing.md }}>
            <Field
              label="Caută business"
              icon="search-outline"
              value={q}
              onChangeText={setQ}
              placeholder="Nume sau cod public (ex. Salon Ana / salon12)"
              autoCapitalize="none"
              returnKeyType="search"
              onSubmitEditing={onSearch}
            />

            <PickerField
              label="Județ"
              value={selectedCounty ?? ALL_COUNTIES}
              options={countyOptions}
              onChange={onCountyChange}
              placeholder="Alege județul"
              icon="map-outline"
              hint="Toate județele din România"
            />

            <PickerField
              label="Localitate"
              value={selectedLocality ?? ALL_LOCALITIES}
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
              <Button label="Caută" icon="search-outline" onPress={onSearch} size="sm" />
              <Button
                label="Aproape de mine"
                icon="navigate-outline"
                variant="secondary"
                size="sm"
                onPress={() => router.push('/(app)/map' as never)}
              />
              <Button
                label="QR"
                icon="qr-code-outline"
                variant="secondary"
                size="sm"
                onPress={() => router.push('/(app)/scan' as never)}
              />
            </View>

            <CategoryGrid
              counts={categoryCounts}
              onSelect={onSelectCategory}
            />

            {hasActiveFilters ? (
              <View style={styles.catSection}>
                <Text style={[styles.catSectionTitle, { color: t.colors.text }]}>
                  Rezultate ({searchResults.length})
                </Text>
                <Text style={[styles.catSectionHint, { color: t.colors.textMuted }]}>
                  {searchResults.length === 0
                    ? 'Niciun business pentru filtrele alese — apasă o categorie sau șterge filtrele.'
                    : 'Apasă un rând pentru rezervare. Detaliile complete sunt pe ecranul de rezervare.'}
                </Text>
                {searchResults.slice(0, 20).map((r) => (
                  <SalonRow
                    key={r.id}
                    item={r}
                    openNow={isOpenNow(r.working_hours, r.timezone)}
                    onPress={() => router.push(`/(app)/book/${r.public_code}` as never)}
                  />
                ))}
                {searchResults.length > 20 ? (
                  <Text style={[styles.catSectionHint, { color: t.colors.textMuted }]}>
                    Primele 20 din {searchResults.length} — restrânge căutarea sau alege o categorie.
                  </Text>
                ) : null}
                <Button
                  label="Șterge filtrele"
                  icon="close-outline"
                  variant="secondary"
                  size="sm"
                  onPress={() => {
                    setQ('');
                    setSelectedCounty(null);
                    setSelectedLocality(null);
                  }}
                />
              </View>
            ) : null}

            {error ? (
              <Callout tone="warning" title="Listă parțială">
                {`Nu am putut încărca tot (${error}). Folosește QR sau codul public de pe Acasă.`}
              </Callout>
            ) : null}
          </View>
        </ScrollView>
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
  catSection: { gap: spacing.sm, marginBottom: spacing.sm },
  catSectionTitle: { fontSize: fontSize.lg, fontWeight: '700' },
  catSectionHint: { fontSize: fontSize.sm, marginBottom: spacing.xs },
  catGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: spacing.sm,
  },
  catTile: {
    width: '48%',
    aspectRatio: 1,
    borderRadius: radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  catImage: {
    width: '100%',
    height: '100%',
    backgroundColor: '#e1e8f1',
  },
  catLabelWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    minHeight: 40,
    justifyContent: 'center',
  },
  catLabel: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    textAlign: 'center',
  },
  catCountBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    minWidth: 26,
    height: 26,
    paddingHorizontal: 6,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  catCountText: {
    color: '#ffffff',
    fontSize: fontSize.sm,
    fontWeight: '800',
  },
});
