import { useEffect, useRef, useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import { ImageLightbox } from '@/components/ImageLightbox';
import { useTheme } from '@/components/ui';
import { radius } from '@/constants/theme';
import { useT } from '@/lib/i18n';

export type ServiceImage = { uri: string; name: string };

const SIZE = 64;

/**
 * Miniatura cu pozele serviciilor unei programari (cardul din Cereri).
 * Cu 2+ poze se gliseaza orizontal doar pe miniatura; punctele de dedesubt
 * arata pozitia si, apasate, trec la urmatoarea poza. Atingerea pozei o deschide pe tot ecranul.
 */
export function ServiceImageCarousel({ images }: { images: ServiceImage[] }) {
  const t = useTheme();
  const tr = useT();
  const scrollRef = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);
  const [openUri, setOpenUri] = useState<string | null>(null);
  const uriKey = images.map((i) => i.uri).join('|');

  useEffect(() => {
    setIndex(0);
    scrollRef.current?.scrollTo({ x: 0, animated: false });
  }, [uriKey]);

  if (images.length === 0) return null;
  const many = images.length > 1;

  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const next = Math.round(e.nativeEvent.contentOffset.x / SIZE);
    const clamped = Math.min(images.length - 1, Math.max(0, next));
    if (clamped !== index) setIndex(clamped);
  }

  function goNext() {
    const next = (index + 1) % images.length;
    setIndex(next);
    scrollRef.current?.scrollTo({ x: next * SIZE, animated: true });
  }

  return (
    <View style={styles.root}>
      <View style={[styles.frame, { borderColor: t.colors.border, backgroundColor: t.colors.surfaceMuted }]}>
        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          nestedScrollEnabled
          scrollEnabled={many}
          showsHorizontalScrollIndicator={false}
          decelerationRate="fast"
          snapToInterval={SIZE}
          disableIntervalMomentum
          onScroll={onScroll}
          scrollEventThrottle={16}
          style={styles.scroller}
        >
          {images.map((img) => (
            <Pressable
              key={img.uri}
              onPress={() => setOpenUri(img.uri)}
              accessibilityRole="imagebutton"
              accessibilityLabel={tr('appt.serviceImage', { name: img.name })}
              style={({ pressed }) => [styles.page, { opacity: pressed ? 0.8 : 1 }]}
            >
              <Image source={{ uri: img.uri }} style={styles.img} resizeMode="cover" accessibilityIgnoresInvertColors />
            </Pressable>
          ))}
        </ScrollView>
      </View>
      {many ? (
        <Pressable
          onPress={goNext}
          accessibilityRole="button"
          accessibilityLabel={tr('appt.nextImage')}
          hitSlop={8}
          style={styles.dots}
        >
          {images.map((img, i) => (
            <View
              key={img.uri}
              style={[
                styles.dot,
                { backgroundColor: i === index ? t.colors.accent : t.colors.border },
              ]}
            />
          ))}
        </Pressable>
      ) : null}
      <ImageLightbox uri={openUri} onClose={() => setOpenUri(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', gap: 4 },
  frame: {
    width: SIZE,
    height: SIZE,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  scroller: { width: SIZE, height: SIZE },
  page: { width: SIZE, height: SIZE },
  img: { width: SIZE, height: SIZE },
  dots: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 2 },
  dot: { width: 5, height: 5, borderRadius: 3 },
});
