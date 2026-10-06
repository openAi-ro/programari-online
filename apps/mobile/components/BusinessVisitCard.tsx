import { Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';

import { PromoVideo } from '@/components/PromoVideo';
import { useTheme } from '@/components/ui';
import { fontSize, palette, radius, spacing } from '@/constants/theme';
import { getWebBookingUrl } from '@/lib/bookingLink';
import { formatAddress, type BusinessLocation } from '@/lib/location';
import { formatPhoneDisplay } from '@/lib/phone';
import type { DayHours, DayKey, WorkingHours } from '@/lib/types';
import { formatPublicLocation } from '@/lib/visitCard';

const DAY_ORDER: { key: DayKey; short: string }[] = [
  { key: 'mon', short: 'Lun' },
  { key: 'tue', short: 'Mar' },
  { key: 'wed', short: 'Mie' },
  { key: 'thu', short: 'Joi' },
  { key: 'fri', short: 'Vin' },
  { key: 'sat', short: 'Sâm' },
  { key: 'sun', short: 'Dum' },
];

function daySignature(day: DayHours): string {
  if (day.closed) return 'closed';
  return `${day.start}-${day.end}`;
}

/** Grupări compacte tip „Lun–Vin 09:00–18:00”. */
export function summarizeWorkingHours(hours: WorkingHours): string[] {
  const lines: string[] = [];
  let i = 0;
  while (i < DAY_ORDER.length) {
    const start = i;
    const sig = daySignature(hours[DAY_ORDER[i].key]);
    i += 1;
    while (i < DAY_ORDER.length && daySignature(hours[DAY_ORDER[i].key]) === sig) {
      i += 1;
    }
    const from = DAY_ORDER[start].short;
    const to = DAY_ORDER[i - 1].short;
    const label = start === i - 1 ? from : `${from}–${to}`;
    const day = hours[DAY_ORDER[start].key];
    if (day.closed) {
      lines.push(`${label}: închis`);
    } else {
      lines.push(`${label}: ${day.start}–${day.end}`);
    }
  }
  return lines;
}

export type BusinessVisitCardProps = {
  name: string;
  phone: string | null;
  workingHours: WorkingHours;
  location: BusinessLocation;
  publicCode: string | null;
  /** Compact pe callout / modal. */
  qrSize?: number;
  /**
   * Vizualizare publica (client): cand e false si nu exista telefon
   * (RLS nu expune telefonul proprietarului), randul de telefon se ascunde
   * in loc sa arate avertismentul pentru proprietar.
   */
  showPhoneWarning?: boolean;
  /** Logo business (stânga, lângă nume) — afișat când există. */
  logoUrl?: string | null;
  /** Video de prezentare (casetă sub card, aceeași lățime). */
  videoUrl?: string | null;
  /**
   * Vizualizare publică (client la căutare): sub nume apare doar
   * orașul/județul, rândul de program dispare (în loc e video-ul).
   */
  publicMode?: boolean;
};

/**
 * Carte de vizită profesională: denumire, QR programare, telefon, program, adresă.
 */
export function BusinessVisitCard({
  name,
  phone,
  workingHours,
  location,
  publicCode,
  qrSize = 90,
  showPhoneWarning = true,
  logoUrl = null,
  videoUrl = null,
  publicMode = false,
}: BusinessVisitCardProps) {
  const t = useTheme();
  const address = formatAddress(location);
  const publicPlace = formatPublicLocation(location.city, location.county);
  const hoursLines = summarizeWorkingHours(workingHours);
  const qrValue = publicCode ? getWebBookingUrl(publicCode) : '';
  const displayName = name.trim() || 'Business fără nume';
  const phoneLabel = phone ? formatPhoneDisplay(phone) : null;

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: t.colors.surface,
          borderColor: t.colors.border,
        },
        t.shadows.md,
      ]}
    >
      <View style={styles.topRow}>
        <View style={styles.identity}>
          {logoUrl ? (
            <Image
              source={{ uri: logoUrl }}
              style={[styles.logo, { borderColor: t.colors.border }]}
              accessibilityLabel={`Logo ${displayName}`}
            />
          ) : (
            <View style={[styles.mark, { backgroundColor: t.colors.accentSoft }]}>
              <Ionicons name="business" size={18} color={t.colors.accentSoftText} />
            </View>
          )}
          <View style={styles.identityText}>
            <Text
              style={[styles.name, { color: t.colors.text }]}
              numberOfLines={2}
            >
              {displayName}
            </Text>
            {publicMode ? (
              publicPlace ? (
                <Text
                  style={[styles.meta, { color: t.colors.textMuted }]}
                  numberOfLines={2}
                >
                  {publicPlace}
                </Text>
              ) : null
            ) : address ? (
              <Text
                style={[styles.meta, { color: t.colors.textMuted }]}
                numberOfLines={3}
              >
                {address}
              </Text>
            ) : (
              <Text style={[styles.meta, { color: t.colors.warning }]}>
                Completează adresa pentru hartă
              </Text>
            )}
          </View>
        </View>

        <View style={styles.qrColumn}>
          <View
            style={[
              styles.qrWrap,
              {
                backgroundColor: palette.white,
                borderColor: t.colors.border,
              },
            ]}
          >
            {qrValue ? (
              <QRCode
                value={qrValue}
                size={qrSize}
                backgroundColor={palette.white}
                color={palette.ink950}
              />
            ) : (
              <View style={[styles.qrPlaceholder, { width: qrSize, height: qrSize }]}>
                <Ionicons name="qr-code-outline" size={28} color={t.colors.textFaint} />
                <Text style={[styles.qrHint, { color: t.colors.textFaint }]}>
                  Salvează pentru QR
                </Text>
              </View>
            )}
          </View>
          {publicCode ? (
            <Text
              style={[styles.qrCaption, { color: t.colors.textFaint }]}
              numberOfLines={2}
            >
              Scan QR → programare · cod {publicCode}
            </Text>
          ) : null}
        </View>
      </View>

      <View style={[styles.divider, { backgroundColor: t.colors.border }]} />

      <View style={styles.rows}>
        {phone || showPhoneWarning ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            phoneLabel ? `Sună ${phoneLabel}` : 'Telefon lipsă — adaugă din Setări'
          }
          disabled={!phone}
          onPress={() => {
            if (phone) void Linking.openURL(`tel:${phone}`);
          }}
          style={({ pressed }) => [
            styles.row,
            { opacity: pressed && phone ? 0.75 : 1 },
          ]}
        >
          <View style={[styles.rowIcon, { backgroundColor: t.colors.warmSoft }]}>
            <Ionicons name="call" size={16} color={t.colors.warm} />
          </View>
          <View style={styles.rowBody}>
            <Text style={[styles.rowLabel, { color: t.colors.textMuted }]}>Telefon</Text>
            <Text
              style={[
                styles.rowValue,
                { color: phoneLabel ? t.colors.text : t.colors.warning },
              ]}
              numberOfLines={1}
            >
              {phoneLabel ?? 'Adaugă telefonul din Setări'}
            </Text>
          </View>
        </Pressable>
        ) : null}

        {!publicMode ? (
          <View style={styles.row}>
            <View style={[styles.rowIcon, { backgroundColor: t.colors.accentSoft }]}>
              <Ionicons name="time" size={16} color={t.colors.accent} />
            </View>
            <View style={styles.rowBody}>
              <Text style={[styles.rowLabel, { color: t.colors.textMuted }]}>Program</Text>
              {hoursLines.map((line) => (
                <Text
                  key={line}
                  style={[styles.rowValue, { color: t.colors.text }]}
                  numberOfLines={1}
                >
                  {line}
                </Text>
              ))}
            </View>
          </View>
        ) : null}
      </View>

      {videoUrl ? (
        <View style={styles.videoWrap}>
          <PromoVideo videoUrl={videoUrl} title={`Prezentare ${displayName}`} />
        </View>
      ) : null}
    </View>
  );
}

/** Ce lipsește pentru o carte de vizită completă pe hartă. */
export function missingVisitCardFields(input: {
  name: string;
  phone: string | null;
  hasAddress: boolean;
  hasCoords: boolean;
  publicCode: string | null;
}): string[] {
  const missing: string[] = [];
  if (!input.name.trim()) missing.push('denumirea firmei');
  if (!input.phone) missing.push('numărul de telefon (Setări)');
  if (!input.hasAddress) missing.push('adresa (județ / localitate / stradă)');
  if (!input.hasCoords) missing.push('marcajul pe hartă (pin)');
  if (!input.publicCode) missing.push('salvează business-ul pentru codul QR');
  return missing;
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: radius.xl,
    padding: spacing.md,
    gap: spacing.sm,
    overflow: 'hidden',
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  identity: {
    flex: 1,
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    minWidth: 0,
  },
  mark: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  videoWrap: { width: '100%' },
  identityText: { flex: 1, flexShrink: 1, gap: 2, minWidth: 0 },
  name: {
    fontSize: fontSize.md,
    fontWeight: '800',
    letterSpacing: -0.3,
    flexShrink: 1,
  },
  meta: { fontSize: fontSize.sm, lineHeight: 16, flexShrink: 1 },
  qrColumn: {
    alignItems: 'center',
    gap: spacing.xs,
    maxWidth: 140,
  },
  qrWrap: {
    padding: spacing.xs,
    borderRadius: radius.md,
    borderWidth: 1,
    overflow: 'hidden',
  },
  qrPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  qrHint: { fontSize: fontSize.xs, textAlign: 'center', fontWeight: '600' },
  divider: { height: StyleSheet.hairlineWidth, width: '100%' },
  rows: { gap: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  rowIcon: {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  rowBody: { flex: 1, flexShrink: 1, gap: 1, minWidth: 0 },
  rowLabel: { fontSize: fontSize.xs, fontWeight: '700', textTransform: 'uppercase' },
  rowValue: { fontSize: fontSize.sm, fontWeight: '600', flexShrink: 1 },
  qrCaption: {
    fontSize: 10,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 13,
    alignSelf: 'stretch',
  },
});
