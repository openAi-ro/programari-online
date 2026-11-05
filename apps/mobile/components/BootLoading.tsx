import { useEffect, useRef } from 'react';
import { Animated, Easing, Image, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';

import { trKey } from '@/lib/i18n';

const LOGO = require('../assets/images/icon.png');

/**
 * Ecran de pornire (boot), replică nativă a animației din
 * `assets/images/index.html`: inel gradient (#9b59b6 → #84cdfa → #5ad1cd)
 * care se rotește la 1,2s, și iconița aplicației (nu tăiată rotund) în centru,
 * pe fundal #f1f5f9. Splash-ul nativ Android este static, deci animația
 * rulează aici, imediat după ce splash-ul se ascunde.
 */
export function BootLoading({ label, sublabel }: { label?: string; sublabel?: string }) {
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 1200,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [spin]);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <View
      style={styles.screen}
      accessibilityRole="progressbar"
      accessibilityLabel={label ?? trKey('common.loading')}
    >
      <View style={styles.circleWrap}>
        {/* Straturi de strălucire (înlocuiesc blur-ul 10/25/50px din HTML). */}
        <View style={[styles.glow, styles.glowFar]} />
        <View style={[styles.glow, styles.glowMid]} />
        <View style={[styles.glow, styles.glowNear]} />

        <Animated.View style={[styles.ring, { transform: [{ rotate }] }]}>
          <Svg width={120} height={120} viewBox="0 0 120 120">
            <Defs>
              <LinearGradient id="bootRingGradient" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor="#9b59b6" />
                <Stop offset="0.5" stopColor="#84cdfa" />
                <Stop offset="1" stopColor="#5ad1cd" />
              </LinearGradient>
            </Defs>
            <Circle cx="60" cy="60" r="60" fill="url(#bootRingGradient)" />
          </Svg>
        </Animated.View>

        <Image source={LOGO} style={styles.logo} resizeMode="contain" accessibilityIgnoresInvertColors />
      </View>

      {label ? <Text style={styles.label}>{label}</Text> : null}
      {sublabel ? <Text style={styles.sublabel}>{sublabel}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 32,
  },
  circleWrap: {
    width: 120,
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glow: {
    position: 'absolute',
    borderRadius: 999,
  },
  glowFar: {
    width: 170,
    height: 170,
    backgroundColor: '#5ad1cd',
    opacity: 0.1,
  },
  glowMid: {
    width: 148,
    height: 148,
    backgroundColor: '#84cdfa',
    opacity: 0.16,
  },
  glowNear: {
    width: 130,
    height: 130,
    backgroundColor: '#9b59b6',
    opacity: 0.14,
  },
  ring: {
    position: 'absolute',
    width: 120,
    height: 120,
  },
  logo: {
    width: 80,
    height: 80,
    borderRadius: 18,
  },
  label: {
    marginTop: 24,
    color: '#0f172a',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  sublabel: {
    marginTop: 6,
    color: '#64748b',
    fontSize: 13,
    textAlign: 'center',
  },
});
