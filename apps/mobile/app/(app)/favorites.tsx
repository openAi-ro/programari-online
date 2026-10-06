import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BizCardRow } from '@/components/BizCardRow';
import { ClientTabBar } from '@/components/ClientTabBar';
import {
  Button,
  EmptyState,
  ListLoadingScreen,
  Screen,
} from '@/components/ui';
import { spacing } from '@/constants/theme';
import {
  getFavoriteIds,
  loadFavoriteBusinesses,
  subscribeFavorites,
  syncFavoritesFromCloud,
  toggleFavorite,
} from '@/lib/favorites';
import { useBack } from '@/lib/nav';

type FavBiz = {
  id: string;
  name: string;
  public_code: string;
  city: string | null;
  logo_url: string | null;
};

export default function FavoritesScreen() {
  const router = useRouter();
  const back = useBack();
  const insets = useSafeAreaInsets();
  const [ids, setIds] = useState<string[]>([]);
  const [rows, setRows] = useState<FavBiz[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void getFavoriteIds();
    void syncFavoritesFromCloud();
    return subscribeFavorites(setIds);
  }, []);

  const loadRows = useCallback(async (favoriteIds: string[]) => {
    if (favoriteIds.length === 0) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const loaded = await loadFavoriteBusinesses(favoriteIds);
    setRows(loaded);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void syncFavoritesFromCloud().then((next) => {
        void loadRows(next);
      });
    }, [loadRows])
  );

  useEffect(() => {
    void loadRows(ids);
  }, [ids, loadRows]);

  if (loading && rows.length === 0 && ids.length > 0) {
    return (
      <View style={{ flex: 1 }}>
        <ListLoadingScreen
          title="Favorite"
          subtitle="Saloane salvate"
          onBack={back}
          label="Se încarcă favoritele…"
        />
        <ClientTabBar />
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <Screen
        title="Favorite"
        subtitle="Saloane salvate pentru rebook rapid"
        onBack={back}
        bottomInset={insets.bottom + spacing['3xl'] + 56}
      >
        {rows.length === 0 ? (
          <EmptyState
            icon="heart-outline"
            title="Niciun salon favorit"
            description="Adaugă saloane din Acasă, Caută sau după o rezervare — apar aici și în cloud."
            action={
              <Button
                label="Caută business"
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
                hint={[biz.city, biz.public_code ? `Cod ${biz.public_code}` : null]
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
