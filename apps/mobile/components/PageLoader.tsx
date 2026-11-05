import { useEffect } from 'react';
import { Image, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { trKey } from '@/lib/i18n';

const LOGO = require('../assets/images/icon.png');

/** Durata unui ciclu, ca `animation: spinner 1.2s linear infinite` din CSS. */
const CYCLE_MS = 1200;
const BAR_COUNT = 12;

/**
 * Culorile lui `filter: hue-rotate(0deg → 360deg)` aplicat pe `green` (#008000),
 * calculate cu matricea CSS la fiecare 30°. `filter` nu există în React Native,
 * așa că interpolăm culoarea barei pe aceste opriri (Android, iOS și web arată la fel).
 */
const HUE_STOPS = Array.from({ length: 13 }, (_, i) => i / 12);
const HUE_COLORS = [
  '#008000',
  '#00843a',
  '#007d7d',
  '#006db7',
  '#3a59d9',
  '#7d45d9',
  '#b737b7',
  '#d9337d',
  '#d93a3a',
  '#b74a00',
  '#7d5e00',
  '#3a7200',
  '#008000',
];

type PageLoaderProps = {
  /** Latura pătratului loaderului (în HTML: 80). Iconița și barele se scalează proporțional. */
  size?: number;
  /** Ocupă tot ecranul și centrează loaderul pe `backgroundColor`. */
  fullScreen?: boolean;
  /** Fundalul variantei full-screen (de regulă `t.colors.bg`). */
  backgroundColor?: string;
  /** Text opțional sub loader. */
  label?: string;
  labelColor?: string;
  /** Eticheta pentru cititoarele de ecran; implicit „Se încarcă…”. */
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
};

/**
 * Loaderul de pagină Programări: 12 bare care se sting pe rând în cerc
 * (replica nativă a `.loader` din HTML-ul lui Rafael), cu iconița aplicației
 * fixă în centru. Animația rulează pe firul UI (Reanimated), deci nu se
 * blochează cât JS-ul încarcă datele.
 */
export function PageLoader({
  size = 80,
  fullScreen = false,
  backgroundColor,
  label,
  labelColor,
  accessibilityLabel,
  style,
}: PageLoaderProps) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withRepeat(withTiming(1, { duration: CYCLE_MS, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(progress);
  }, [progress]);

  const k = size / 80;
  const logoSize = 38 * k;

  const mark = (
    <View
      style={[{ width: size, height: size }, fullScreen ? null : style]}
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel ?? label ?? trKey('common.loading')}
    >
      {Array.from({ length: BAR_COUNT }, (_, i) => (
        <Bar key={i} index={i} size={size} progress={progress} />
      ))}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.center]}>
        <Image
          source={LOGO}
          resizeMode="cover"
          accessibilityIgnoresInvertColors
          style={{ width: logoSize, height: logoSize, borderRadius: 9 * k }}
        />
      </View>
    </View>
  );

  if (!fullScreen) {
    return (
      <>
        {mark}
        {label ? <Text style={[styles.label, labelColor ? { color: labelColor } : null]}>{label}</Text> : null}
      </>
    );
  }

  return (
    <View style={[styles.screen, backgroundColor ? { backgroundColor } : null, style]}>
      {mark}
      {label ? <Text style={[styles.label, labelColor ? { color: labelColor } : null]}>{label}</Text> : null}
    </View>
  );
}

function Bar({ index, size, progress }: { index: number; size: number; progress: SharedValue<number> }) {
  // `animation-delay` negativ în CSS: bara 1 are -1.1s, bara 12 are 0s,
  // adică bara i pornește deja la (11 - i)/12 din ciclu.
  const offset = (BAR_COUNT - 1 - index) / BAR_COUNT;
  const k = size / 80;

  const animated = useAnimatedStyle(() => {
    const p = (progress.value + offset) % 1;
    return {
      opacity: 1 - p,
      backgroundColor: interpolateColor(p, HUE_STOPS, HUE_COLORS),
    };
  });

  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { transform: [{ rotate: `${index * 30}deg` }] }]}
    >
      <Animated.View
        style={[
          {
            position: 'absolute',
            top: 3 * k,
            left: 37 * k,
            width: 6 * k,
            height: 18 * k,
            // border-radius: 20% pe 6×18 → ~1.2px orizontal; RN acceptă un singur rază.
            borderRadius: 1.2 * k,
          },
          animated,
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    marginTop: 16,
    fontSize: 15,
    textAlign: 'center',
    color: '#64748b',
  },
});
