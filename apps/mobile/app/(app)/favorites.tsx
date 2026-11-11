import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BizCardRow } from '@/components/BizCardRow';
import { ClientTabBar } from '@/components/ClientTabBar';
import {
  Button,
  Callout,
  EmptyState,
  ListLoadingScreen,
  Screen,
} from '@/components/ui';
import { spacing } from '@/constants/theme';
import {
  loadFavoriteBusinesses,
  subscribeFavorites,
  syncFavoritesFromCloud,
  toggleFavorite,
} from '@/lib/favorites';
import { useBack } from '@/lib/nav';
import { useT } from '@/lib/i18n';

type FavBiz = {
  id: string;
  name: string;
  public_code: string;
  city: string | null;
  logo_url: string | null;
  is_private: boolean;
};

export default function FavoritesScreen() {
  const tr = useT();
  const router = useRouter();
  const back = useBack();
  const insets = useSafeAreaInsets();
  const [ids, setIds] = useState<string[]>([]);
  const [rows, setRows] = useState<FavBiz[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  /** Lista de id-uri e cunoscută abia după o citire reușită; până atunci nu arătăm „Niciun salon favorit”. */
  const idsKnown = useRef(false);

  useEffect(() => subscribeFavorites(setIds), []);

  const loadRows = useCallback(async (favoriteIds: string[]) => {
    setLoadFailed(false);
    if (favoriteIds.length === 0) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const loaded = await loadFavoriteBusinesses(favoriteIds);
    if (loaded) setRows(loaded);
    else setLoadFailed(true);
    setLoading(false);
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    const next = await syncFavoritesFromCloud();
    if (!next) {
      setLoadFailed(true);
      setLoading(false);
      return;
    }
    idsKnown.current = true;
    await loadRows(next);
  }, [loadRows]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload])
  );

  // Revenirea internetului (web) reîncarcă singură lista.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const onOnline = () => void reload();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [reload]);

  // Adăugat/scos din altă parte: doar după ce lista e cunoscută.
  useEffect(() => {
    if (idsKnown.current) void loadRows(ids);
  }, [ids, loadRows]);

  if (loading && rows.length === 0 && ids.length > 0) {
    return (
      <View style={{ flex: 1 }}>
        <ListLoadingScreen
          title={tr('tabs.favorites')}
          subtitle={tr('fav.saved')}
          onBack={back}
          label={tr('fav.loading')}
        />
        <ClientTabBar />
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <Screen
        title={tr('tabs.favorites')}
        subtitle={tr('fav.savedSub')}
        onBack={back}
        bottomInset={insets.bottom + spacing['3xl'] + 56}
      >
        {loadFailed ? (
          <>
            <Callout tone="danger">{tr('fav.loadFail')}</Callout>
            <Button label={tr('common.retry')} icon="refresh-outline" variant="secondary" onPress={() => void reload()} />
          </>
        ) : rows.length === 0 && loading ? null : rows.length === 0 ? (
          <EmptyState
            icon="heart-outline"
            title={tr('fav.empty')}
            description={tr('fav.emptyDesc')}
            action={
              <Button
                label={tr('fav.searchBiz')}
                icon="search-outline"
                onPress={() => router.push('/(app)/browse' as never)}
              />
            }
          />
        ) : (
          <View style={styles.list}>
            {rows.map((biz) => (
              <BizCardRow
                key={biz.id}
                title={biz.name}
                favorited
                hint={[biz.is_private ? tr('fav.private') : null, biz.city, biz.public_code ? tr('fav.code', { code: biz.public_code }) : null]
                  .filter(Boolean)
                  .join(' · ')}
                onPress={() =>
                  router.push(`/(app)/book/${biz.public_code}` as never)
                }
                onToggleFavorite={() => void toggleFavorite(biz.id)}
              />
            ))}
          </View>
        )}
      </Screen>
      <ClientTabBar />
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.md },
});
