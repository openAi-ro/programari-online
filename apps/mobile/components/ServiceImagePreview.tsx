import { useState } from 'react';
import { Image, Pressable, type ImageStyle, type StyleProp } from 'react-native';

import { ImageLightbox } from '@/components/ImageLightbox';
import { useT } from '@/lib/i18n';

/**
 * Miniatura unui serviciu în fluxul de rezervare. Atingerea pozei o deschide pe tot
 * ecranul, fără să bifeze serviciul; restul cardului rămâne pentru selectare.
 */
export function ServiceImagePreview({
  uri,
  name,
  style,
}: {
  uri: string;
  name: string;
  style?: StyleProp<ImageStyle>;
}) {
  const tr = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="imagebutton"
        accessibilityLabel={tr('book.serviceImageOpen', { name })}
        hitSlop={4}
        style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
      >
        <Image source={{ uri }} style={style} accessibilityIgnoresInvertColors />
      </Pressable>
      <ImageLightbox uri={open ? uri : null} onClose={() => setOpen(false)} />
    </>
  );
}
