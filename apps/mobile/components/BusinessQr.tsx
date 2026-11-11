import { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View, type TextStyle } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { palette, spacing } from '@/constants/theme';

/**
 * QR-ul afacerii: același link /b/<cod>, cu logo-ul afacerii în mijloc și numele dedesubt.
 * Corecție de erori H (30%), ca logo-ul (≈22% din latură) să nu strice citirea.
 * Fără logo sau dacă imaginea nu se încarcă: QR simplu; numele apare mereu.
 */
export const QR_LOGO_RATIO = 0.22;

export function BusinessQr({
  value,
  size,
  name,
  logoUrl,
  nameStyle,
}: {
  value: string;
  size: number;
  name?: string | null;
  logoUrl?: string | null;
  nameStyle?: TextStyle;
}) {
  const logoOk = useLogoLoads(logoUrl ?? null);
  const label = name?.trim();
  return (
    <View style={styles.wrap}>
      <QRCode
        value={value}
        size={size}
        ecl="H"
        backgroundColor={palette.white}
        color={palette.ink950}
        {...(logoOk && logoUrl
          ? {
              logo: { uri: logoUrl },
              logoSize: Math.round(size * QR_LOGO_RATIO),
              logoBackgroundColor: palette.white,
              logoMargin: Math.max(2, Math.round(size * 0.015)),
              logoBorderRadius: Math.round(size * 0.03),
            }
          : {})}
      />
      {label ? (
        <Text
          style={[styles.name, { maxWidth: Math.max(size, 120) }, nameStyle]}
          numberOfLines={2}
          ellipsizeMode="tail"
          accessibilityRole="text"
        >
          {label}
        </Text>
      ) : null}
    </View>
  );
}

/** Logo-ul se pune în QR doar după ce imaginea s-a încărcat (altfel ar rămâne un pătrat gol). */
function useLogoLoads(url: string | null): boolean {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    let alive = true;
    setOk(false);
    if (!url) return;
    Image.prefetch(url)
      .then((r) => {
        if (alive) setOk(r !== false);
      })
      .catch(() => {
        if (alive) setOk(false);
      });
    return () => {
      alive = false;
    };
  }, [url]);
  return ok;
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: spacing.sm },
  name: {
    fontSize: 15,
    fontWeight: '700',
    color: palette.ink950,
    textAlign: 'center',
  },
});
