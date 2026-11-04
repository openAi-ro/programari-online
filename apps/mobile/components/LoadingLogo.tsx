import { useEffect, useRef } from 'react';
import { Animated } from 'react-native';
import Svg, { Circle, Defs, Line, LinearGradient, Path, Polyline, Rect, Stop } from 'react-native-svg';

export type LoadingLogoVariant = 1 | 2 | 3;

/**
 * Logo animat pentru ecranele de încărcare (intrare în aplicație).
 * Varianta se alege din pagina `logo-variante.html`, apoi se setează aici.
 */
export function LoadingLogo({ variant = 1, size = 132 }: { variant?: LoadingLogoVariant; size?: number }) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] });
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] });

  return (
    <Animated.View style={{ transform: [{ scale }], opacity }} accessibilityRole="image" accessibilityLabel="Programări">
      <Svg width={size} height={size} viewBox="0 0 1024 1024">
        <Defs>
          <LinearGradient id="loadingLogoGradient" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#14b8a6" />
            <Stop offset="1" stopColor="#0ea5e9" />
          </LinearGradient>
        </Defs>
        {variant === 1 ? <Variant1 /> : variant === 2 ? <Variant2 /> : <Variant3 />}
      </Svg>
    </Animated.View>
  );
}

function Variant1() {
  return (
    <>
      <Rect x="96" y="96" width="832" height="832" rx="200" fill="url(#loadingLogoGradient)" />
      <Rect x="348" y="218" width="38" height="118" rx="19" fill="#ffffff" />
      <Rect x="638" y="218" width="38" height="118" rx="19" fill="#ffffff" />
      <Rect x="264" y="284" width="496" height="456" rx="44" fill="#ffffff" />
      <Path d="M264 328 a44 44 0 0 1 44-44 h408 a44 44 0 0 1 44 44 v74 H264 z" fill="#0f766e" />
      <Polyline points="372,556 476,656 660,468" fill="none" stroke="#0f766e" strokeWidth="56" strokeLinecap="round" strokeLinejoin="round" />
      <Circle cx="772" cy="760" r="58" fill="#f97316" stroke="#ffffff" strokeWidth="18" />
    </>
  );
}

function Variant2() {
  return (
    <>
      <Circle cx="512" cy="512" r="416" fill="url(#loadingLogoGradient)" />
      <Path
        d="M392 736 V288 h144 a136 136 0 0 1 0 272 H392"
        fill="none"
        stroke="#ffffff"
        strokeWidth="72"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Circle cx="676" cy="692" r="46" fill="#f97316" stroke="#ffffff" strokeWidth="14" />
    </>
  );
}

function Variant3() {
  return (
    <>
      <Circle cx="472" cy="472" r="336" fill="#ffffff" stroke="url(#loadingLogoGradient)" strokeWidth="64" />
      <Line x1="472" y1="472" x2="472" y2="306" stroke="#0f766e" strokeWidth="48" strokeLinecap="round" />
      <Line x1="472" y1="472" x2="600" y2="548" stroke="#0f766e" strokeWidth="48" strokeLinecap="round" />
      <Circle cx="472" cy="472" r="38" fill="#f97316" />
      <Circle cx="728" cy="728" r="132" fill="#f97316" />
      <Polyline points="660,728 712,780 800,680" fill="none" stroke="#ffffff" strokeWidth="44" strokeLinecap="round" strokeLinejoin="round" />
    </>
  );
}
