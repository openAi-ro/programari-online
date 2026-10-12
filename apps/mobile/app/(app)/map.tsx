import { useCallback, useState } from 'react';
import {
  FlatList,
  Linking,
  Platform,
  StyleSheet,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import {
  Button,
  Callout,
  EmptyState,
  ListLoadingScreen,
  Screen,
  useTheme,
} from '@/components/ui';
import { ClientTabBar } from '@/components/ClientTabBar';
import { SalonRow } from '@/components/SalonRow';
import { spacing } from '@/constants/theme';
import {
  getDeviceCoords,
  listPublicBusinesses,
  locationErrorMessage,
  withDistances,
  type DeviceCoords,
  type PublicBusinessWithDistance,
} from '@/lib/discover';
import { isOpenNow } from '@/lib/browseList';
import { useBack } from '@/lib/nav';
import { useT } from '@/lib/i18n';

/**
 * Aproape de mine — listă sortată după distanță (fara Google Maps greu pe web).
 * Randurile sunt componenta partajată SalonRow (același rând compact ca la Caută).
 */
export default function NearMeScreen() {
  const t = useTheme();
  const tr = useT();
  const back = useBack();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<PublicBusinessWithDistance[]>([]);
  const [coords, setCoords] = useState<DeviceCoords | null>(null);
  const [locError, setLocError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLocError(null);
    setListError(null);
    setLoading(true);

    let device: DeviceCoords | null = null;
    try {
      device = await getDeviceCoords();
      setCoords(device);
    } catch (err) {
      setCoords(null);
      setLocError(locationErrorMessage(err));
    }

    const { rows: raw, error: err } = await listPublicBusinesses({ limit: 100 });
    if (err) setListError(err);
    setRows(withDistances(raw, device));
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const openInMaps = useCallback(() => {
    if (!coords) return;
    const q = `${coords.latitude},${coords.longitude}`;
    const url =
      Platform.OS === 'ios'
        ? `http://maps.apple.com/?ll=${q}&q=Eu`
        : `https://www.google.com/maps/search/?api=1&query=${q}`;
    void Linking.openURL(url);
  }, [coords]);

  if (loading && rows.length === 0) {
    return (
      <ListLoadingScreen
        title={tr('browse.nearMe')}
        subtitle={tr('near.sortedByDist')}
        onBack={back}
        label={tr('near.locating')}
      />
    );
  }

  const withGeo = rows.filter((r) => r.distanceKm != null).length;

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
      <Screen
        title={tr('browse.nearMe')}
        subtitle={
          coords
            ? withGeo > 0
              ? tr('near.countGeo', { n: withGeo })
              : tr('near.okNoGps')
            : tr('near.noLocAlpha')
        }
        onBack={back}
        scroll={false}
      >
        <FlatList
          data={rows}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <View style={{ gap: spacing.md }}>
              {locError ? (
                <Callout tone="warning" title={tr('cat.locUnavailable')}>
                  {locError}
                </Callout>
              ) : null}
              {listError ? (
                <Callout tone="danger" title={tr('near.listError')}>
                  {listError}
                </Callout>
              ) : null}
              <View style={styles.actions}>
                <Button
                  label={tr('near.retryLoc')}
                  icon="locate-outline"
                  size="sm"
                  onPress={() => void load()}
                />
                <Button
                  label={tr('near.searchCity')}
                  icon="search-outline"
                  variant="secondary"
                  size="sm"
                  onPress={() => router.push('/(app)/browse' as never)}
                />
                {coords ? (
                  <Button
                    label={tr('near.openMap')}
                    icon="map-outline"
                    variant="secondary"
                    size="sm"
                    onPress={openInMaps}
                  />
                ) : null}
              </View>
            </View>
          }
          ListEmptyComponent={
            <EmptyState
              icon="navigate-outline"
              title={tr('near.empty')}
              description={tr('near.emptyDesc')}
              action={
                <Button
                  label={tr('fav.searchBiz')}
                  icon="search-outline"
                  onPress={() => router.push('/(app)/browse' as never)}
                />
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
