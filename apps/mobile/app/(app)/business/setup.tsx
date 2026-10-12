import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { DatePickerField } from '@/components/DatePickerField';
import { PickerField } from '@/components/PickerField';
import { WorkingHoursForm } from '@/components/WorkingHoursForm';
import {
  Button,
  Callout,
  Field,
  Screen,
  SectionTitle,
  SkeletonScreen,
  Toggle,
  useTheme,
} from '@/components/ui';
import { fontSize, radius, spacing } from '@/constants/theme';
import {
  DEFAULT_AUTO_APPROVE_RETURNING,
  DEFAULT_BREAK_HOURS,
  DEFAULT_BUFFER_MINUTES,
  DEFAULT_CANCEL_NOTICE_MINUTES,
  DEFAULT_LOYALTY_EVERY,
  DEFAULT_MAX_ADVANCE_DAYS,
  DEFAULT_MIN_NOTICE_MINUTES,
  DEFAULT_NO_SHOW_BLOCK_AFTER,
  DEFAULT_TIMEZONE,
  DEFAULT_WORKING_HOURS,
} from '@/lib/defaults';
import { reverseGeocodeRo } from '@/lib/location';
import { useBack } from '@/lib/nav';
import { generatePublicCode } from '@/lib/publicCode';
import {
  JUDETE,
  adresaCompleta,
  judetCanonic,
  judetPentruLocalitate,
  localitateCanonica,
  localitatiPentruJudet,
} from '@/lib/roGeo';
import { supabase } from '@/lib/supabase';
import { withTimeout } from '@/lib/withTimeout';
import {
  BROWSE_CATEGORIES,
  categoryLabel,
  categoryLabelForKey,
} from '@/lib/browseCategories';
import { trKey, useT } from '@/lib/i18n';
import type { BreakHours, BusinessProfile, WorkingHours } from '@/lib/types';

/**
 * `getCurrentPositionAsync` nu are timeout propriu: dacă permisiunea e refuzată
 * silențios sau GPS-ul nu răspunde, promisiunea nu se închide niciodată și butonul
 * rămâne pe spinner. Îl limităm explicit.
 */

function todayYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseYmdLocal(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 12, 0, 0, 0);
}

function toYmdLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Toate zilele YYYY-MM-DD între from și to (inclusiv), indiferent de ordine. */
function eachYmdInclusive(from: string, to: string): string[] {
  let a = parseYmdLocal(from);
  let b = parseYmdLocal(to);
  if (a.getTime() > b.getTime()) {
    const t = a;
    a = b;
    b = t;
  }
  const out: string[] = [];
  const cur = new Date(a);
  while (cur.getTime() <= b.getTime()) {
    out.push(toYmdLocal(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

const GEO_TIMEOUT_MS = 15000;

/**
 * Coordonatele curente, cu timeout pe fiecare pas. Pe web folosim direct
 * `navigator.geolocation` (cu timeout propriu, ca dialogul de permisiune blocat
 * să nu lase butonul pe spinner); pe telefon, expo-location cu acuratețe echilibrată,
 * care răspunde mai repede decât High și e suficientă pentru adresă.
 */
async function getCurrentCoords(): Promise<{ lat: number; lon: number }> {
  if (Platform.OS === 'web') {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      throw new Error('location_unavailable');
    }
    return withTimeout(
      new Promise<{ lat: number; lon: number }>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
          (err) =>
            reject(
              new Error(
                err.code === err.PERMISSION_DENIED ? 'permission_denied' : 'location_failed'
              )
            ),
          { enableHighAccuracy: true, timeout: GEO_TIMEOUT_MS - 2000, maximumAge: 60000 }
        );
      }),
      GEO_TIMEOUT_MS,
      'location_timeout'
    );
  }

  const Location = await import('expo-location');
  const { status } = await withTimeout(
    Location.requestForegroundPermissionsAsync(),
    GEO_TIMEOUT_MS,
    'permission_timeout'
  );
  if (status !== 'granted') throw new Error('permission_denied');

  const pos = await withTimeout(
    Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
    GEO_TIMEOUT_MS,
    'location_timeout'
  );
  return { lat: pos.coords.latitude, lon: pos.coords.longitude };
}

export default function BusinessSetupScreen() {
  const t = useTheme();
  const back = useBack();
  const tr = useT();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [geoBusy, setGeoBusy] = useState(false);
  const [existingId, setExistingId] = useState<string | null>(null);
  const [publicCode, setPublicCode] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [timezone, setTimezone] = useState(DEFAULT_TIMEZONE);
  const [duration, setDuration] = useState('60');
  const [workingHours, setWorkingHours] = useState<WorkingHours>(DEFAULT_WORKING_HOURS);
  const [breakHours, setBreakHours] = useState<BreakHours>(DEFAULT_BREAK_HOURS);
  const [minNoticeHours, setMinNoticeHours] = useState(String(DEFAULT_MIN_NOTICE_MINUTES / 60));
  const [bufferMinutes, setBufferMinutes] = useState(String(DEFAULT_BUFFER_MINUTES));
  const [maxAdvanceDays, setMaxAdvanceDays] = useState(String(DEFAULT_MAX_ADVANCE_DAYS));
  const [cancelNoticeHours, setCancelNoticeHours] = useState(
    String(DEFAULT_CANCEL_NOTICE_MINUTES / 60)
  );
  const [autoApprove, setAutoApprove] = useState(DEFAULT_AUTO_APPROVE_RETURNING);
  const [blockAfter, setBlockAfter] = useState(String(DEFAULT_NO_SHOW_BLOCK_AFTER));
  const [loyaltyEvery, setLoyaltyEvery] = useState(String(DEFAULT_LOYALTY_EVERY));
  const [county, setCounty] = useState('');
  const [city, setCity] = useState('');
  const [address, setAddress] = useState('');
  const [mapsUrl, setMapsUrl] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [blockedDates, setBlockedDates] = useState<string[]>([]);
  const [blockDateDraft, setBlockDateDraft] = useState(todayYmd);
  const [blockRangeStart, setBlockRangeStart] = useState(todayYmd);
  const [blockRangeEnd, setBlockRangeEnd] = useState(todayYmd);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Gardă anti-blocare: dacă interogările atârnă (fără net / DNS blocat),
    // ecranul iese din loading cu mesaj în loc de schelet infinit.
    const timer = setTimeout(() => {
      if (cancelled) return;
      cancelled = true;
      setError(trKey('setup.loadFail'));
      setLoading(false);
    }, 15000);
    const done = () => {
      clearTimeout(timer);
      if (!cancelled) setLoading(false);
    };
    (async () => {
      try {
        await loadBusiness();
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : trKey('setup.loadFailShort'));
        }
      } finally {
        done();
      }
    })();
    async function loadBusiness() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!user) {
        return;
      }
      const { data } = await supabase
        .from('business_profiles')
        .select('*')
        .eq('owner_user_id', user.id)
        .maybeSingle();
      if (data) {
        const b = data as BusinessProfile;
        setExistingId(b.id);
        setPublicCode(b.public_code);
        setName(b.name);
        setCategory(typeof b.category === 'string' ? b.category : '');
        setTimezone(b.timezone || DEFAULT_TIMEZONE);
        setDuration(String(b.session_duration_minutes));
        setWorkingHours(b.working_hours);
        setBreakHours(b.break_hours ?? DEFAULT_BREAK_HOURS);
        setMinNoticeHours(String((b.min_notice_minutes ?? DEFAULT_MIN_NOTICE_MINUTES) / 60));
        setBufferMinutes(String(b.buffer_minutes ?? DEFAULT_BUFFER_MINUTES));
        setMaxAdvanceDays(String(b.max_advance_days ?? DEFAULT_MAX_ADVANCE_DAYS));
        setCancelNoticeHours(
          String((b.cancel_notice_minutes ?? DEFAULT_CANCEL_NOTICE_MINUTES) / 60)
        );
        setAutoApprove(Boolean(b.auto_approve_returning));
        setBlockAfter(String(b.no_show_block_after ?? DEFAULT_NO_SHOW_BLOCK_AFTER));
        setLoyaltyEvery(String(b.loyalty_every ?? DEFAULT_LOYALTY_EVERY));

        // Adresele vechi aveau doar orașul; deducem județul din nomenclator.
        const judet = judetCanonic(b.county) || judetPentruLocalitate(b.city);
        setCounty(judet);
        setCity(localitateCanonica(judet, b.city) || b.city || '');
        setAddress(b.address ?? '');
        setMapsUrl(b.maps_url ?? '');
        setLatitude(b.latitude != null ? String(b.latitude) : '');
        setLongitude(b.longitude != null ? String(b.longitude) : '');
        setBlockedDates(Array.isArray(b.blocked_dates) ? b.blocked_dates : []);
      }
    }
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  async function handleUseMyLocation() {
    setError(null);
    setMessage(null);
    setGeoBusy(true);
    try {
      const { lat, lon } = await getCurrentCoords();
      setLatitude(lat.toFixed(6));
      setLongitude(lon.toFixed(6));

      let geo: Awaited<ReturnType<typeof reverseGeocodeRo>> = null;
      try {
        geo = await withTimeout(
          reverseGeocodeRo(lat, lon),
          GEO_TIMEOUT_MS,
          'geocode_timeout'
        );
      } catch {
        geo = null;
      }
      if (!geo) {
        setMessage(trKey('setup.coordsOnly'));
        return;
      }

      const judet = judetCanonic(geo.judet) || judetPentruLocalitate(geo.localitate);
      // Bucureşti nu are localităţi în nomenclator, doar sectoare: extragem sectorul din adresa completă.
      const sector = geo.adresa.match(/sector(?:ul)?\s*(\d+)/i);
      const candidat = sector ? `Sector ${sector[1]}` : geo.localitate;
      const localitate = localitateCanonica(judet, candidat) || candidat;
      if (judet) setCounty(judet);
      if (localitate) setCity(localitate);
      if (geo.strada) setAddress(geo.strada);

      setMessage(trKey('setup.locTaken', { addr: adresaCompleta(judet, localitate, geo.strada) }));
    } catch (e) {
      const code = e instanceof Error ? e.message : '';
      if (code === 'permission_denied') {
        setError(
          Platform.OS === 'web' ? trKey('setup.geoPermWeb') : trKey('setup.geoPermNative')
        );
      } else if (code === 'location_timeout' || code === 'permission_timeout') {
        setError(
          Platform.OS === 'web' ? trKey('setup.geoTimeoutWeb') : trKey('setup.geoTimeoutNative')
        );
      } else if (code === 'location_unavailable') {
        setError(trKey('setup.geoUnavailable'));
      } else {
        setError(trKey('setup.geoFail'));
      }
    } finally {
      setGeoBusy(false);
    }
  }


  async function handleSave() {
    setError(null);
    setMessage(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setError(trKey('setup.nameRequired'));
      return;
    }
    const minutes = parseInt(duration, 10);
    if (!Number.isFinite(minutes) || minutes < 5 || minutes > 480) {
      setError(trKey('svc.badDuration'));
      return;
    }
    if (!timezone.trim()) {
      setError(trKey('setup.tzRequired'));
      return;
    }
    const minNotice = Math.round(Number(String(minNoticeHours).replace(',', '.')) * 60);
    const buffer = parseInt(bufferMinutes, 10);
    const maxDays = parseInt(maxAdvanceDays, 10);
    const cancelNotice = Math.round(Number(String(cancelNoticeHours).replace(',', '.')) * 60);
    if (!Number.isFinite(minNotice) || minNotice < 0 || minNotice > 10080) {
      setError(trKey('setup.badMinNotice'));
      return;
    }
    if (!Number.isFinite(buffer) || buffer < 0 || buffer > 240) {
      setError(trKey('setup.badBuffer'));
      return;
    }
    if (!Number.isFinite(maxDays) || maxDays < 1 || maxDays > 365) {
      setError(trKey('setup.badMaxDays'));
      return;
    }
    if (!Number.isFinite(cancelNotice) || cancelNotice < 0 || cancelNotice > 10080) {
      setError(trKey('setup.badCancelNotice'));
      return;
    }
    const blockN = parseInt(blockAfter, 10);
    const loyalty = parseInt(loyaltyEvery, 10);
    if (!Number.isFinite(blockN) || blockN < 0 || blockN > 20) {
      setError(trKey('setup.badBlock'));
      return;
    }
    if (!Number.isFinite(loyalty) || loyalty < 0 || loyalty > 50) {
      setError(trKey('setup.badLoyalty'));
      return;
    }
    if (loyalty === 1) {
      setError(trKey('setup.loyaltyMin'));
      return;
    }
    if (county.trim() && !city.trim()) {
      setError(trKey('setup.pickCity'));
      return;
    }

    const lat = latitude.trim() === '' ? null : Number(String(latitude).replace(',', '.'));
    const lon = longitude.trim() === '' ? null : Number(String(longitude).replace(',', '.'));
    if ((lat === null) !== (lon === null)) {
      setError(trKey('setup.bothCoords'));
      return;
    }
    if (lat !== null && (!Number.isFinite(lat) || lat < -90 || lat > 90)) {
      setError(trKey('setup.badLat'));
      return;
    }
    if (lon !== null && (!Number.isFinite(lon) || lon < -180 || lon > 180)) {
      setError(trKey('setup.badLon'));
      return;
    }

    // Nu forțăm deposit_ron: 0 la fiecare salvare — păstrăm valoarea din DB.
    // La creare, DB default e 0 (migrarea v13).
    const rules = {
      min_notice_minutes: minNotice,
      buffer_minutes: buffer,
      max_advance_days: maxDays,
      cancel_notice_minutes: cancelNotice,
      blocked_dates: blockedDates,
      auto_approve_returning: autoApprove,
      no_show_block_after: blockN,
      loyalty_every: loyalty,
    };

    setSaving(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setSaving(false);
      setError(trKey('req.notAuthed'));
      return;
    }

    if (existingId) {
      const { error: err } = await supabase
        .from('business_profiles')
        .update({
          name: trimmed,
          category: category.trim() || null,
          timezone: timezone.trim(),
          session_duration_minutes: minutes,
          working_hours: workingHours,
          break_hours: breakHours,
          county: county.trim() || null,
          city: city.trim() || null,
          address: address.trim() || null,
          maps_url: mapsUrl.trim() || null,
          latitude: lat,
          longitude: lon,
          ...rules,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingId);
      setSaving(false);
      if (err) {
        setError(err.message);
        return;
      }
      setMessage(trKey('setup.updated'));
      return;
    }

    const code = generatePublicCode();
    const { data, error: err } = await supabase
      .from('business_profiles')
      .insert({
        owner_user_id: user.id,
        name: trimmed,
        public_code: code,
        category: category.trim() || null,
        timezone: timezone.trim(),
        session_duration_minutes: minutes,
        working_hours: workingHours,
        break_hours: breakHours,
        county: county.trim() || null,
        city: city.trim() || null,
        address: address.trim() || null,
        maps_url: mapsUrl.trim() || null,
        latitude: lat,
        longitude: lon,
        ...rules,
      })
      .select('*')
      .single();
    setSaving(false);
    if (err) {
      setError(err.message);
      return;
    }
    const b = data as BusinessProfile;
    setExistingId(b.id);
    setPublicCode(b.public_code);
    setMessage(trKey('setup.created'));
    const { data: existingServices } = await supabase
      .from('services')
      .select('id')
      .eq('business_id', b.id)
      .limit(1);
    if (!existingServices?.length) {
      await supabase.from('services').insert({
        business_id: b.id,
        name: trKey('cli.session'),
        duration_minutes: minutes,
        price: 0,
        sort_order: 0,
      });
    }
    const { data: existingStaff } = await supabase
      .from('staff')
      .select('id')
      .eq('business_id', b.id)
      .limit(1);
    if (!existingStaff?.length) {
      await supabase.from('staff').insert({
        business_id: b.id,
        name: trimmed,
        color: '#5B6CFF',
        sort_order: 0,
      });
    }
  }

  if (loading) {
    return (
      <SkeletonScreen
        title={tr('setup.title')}
        onBack={back}
        blocks={5}
        label={tr('setup.loading')}
      />
    );
  }

  return (
    <Screen
      title={tr('setup.title')}
      subtitle={existingId ? tr('setup.editSub') : tr('setup.createSub')}
      onBack={back}
      footer={
        <View style={styles.footer}>
          {error ? (
            <Callout tone="danger" title={tr('setup.checkData')}>
              {error}
            </Callout>
          ) : null}
          {message ? (
            <Callout tone="success" title={tr('common.done')}>
              {message}
            </Callout>
          ) : null}
          <Button
            label={saving ? tr('cli.saving') : existingId ? tr('setup.saveChanges') : tr('setup.createBiz')}
            icon="checkmark"
            loading={saving}
            onPress={handleSave}
          />
          {publicCode ? (
            <Button
              label={tr('setup.viewQr')}
              variant="secondary"
              icon="qr-code-outline"
              onPress={() => router.push('/(app)/business/qr' as never)}
            />
          ) : null}
        </View>
      }
    >
      <Field
        label={tr('setup.bizName')}
        value={name}
        onChangeText={setName}
        placeholder="Cabinet / Salon / Barbershop"
        icon="storefront-outline"
        autoCapitalize="words"
      />
      <PickerField
        label={tr('setup.category')}
        value={categoryLabelForKey(category)}
        options={BROWSE_CATEGORIES.map(categoryLabel)}
        onChange={(label) =>
          setCategory(BROWSE_CATEGORIES.find((c) => categoryLabel(c) === label)?.key ?? '')
        }
        placeholder={tr('setup.pickCategory')}
        icon="grid-outline"
        hint={tr('setup.categoryHint')}
      />
      <Field
        label={tr('setup.sessionDur')}
        value={duration}
        onChangeText={setDuration}
        placeholder="60"
        keyboardType="number-pad"
        icon="time-outline"
        hint={tr('setup.sessionHint')}
      />
      <Field
        label="Timezone (IANA)"
        value={timezone}
        onChangeText={setTimezone}
        placeholder="Europe/Bucharest"
        icon="globe-outline"
        autoCapitalize="none"
        hint={tr('setup.tzHint')}
      />

      <SectionTitle>{tr('setup.location')}</SectionTitle>
      <Callout tone="info" title={tr('setup.bizAddress')}>
        {tr('setup.addrHint', { myLoc: tr('setup.useMyLoc') })}
      </Callout>
      <PickerField
        label={tr('setup.county')}
        value={county}
        options={JUDETE}
        onChange={(next) => {
          setCounty(next);
          if (city && !localitatiPentruJudet(next).includes(city)) setCity('');
        }}
        placeholder={tr('setup.pickCounty')}
        icon="map-outline"
      />
      <PickerField
        label={tr('setup.city')}
        value={city}
        options={localitatiPentruJudet(county)}
        onChange={setCity}
        placeholder={county ? tr('setup.pickLocality') : tr('setup.pickCountyFirst')}
        icon="business-outline"
        disabled={!county}
        hint={county ? undefined : tr('setup.localityHint')}
      />
      <Field
        label={tr('setup.street')}
        value={address}
        onChangeText={setAddress}
        placeholder={tr('setup.streetPh')}
        icon="location-outline"
      />
      <Field
        label={tr('setup.mapsLink')}
        value={mapsUrl}
        onChangeText={setMapsUrl}
        placeholder="https://maps.google.com/…"
        icon="map-outline"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        hint={tr('setup.mapsHint')}
      />
      <Button
        label={geoBusy ? tr('setup.geoBusy') : tr('setup.useMyLoc')}
        variant="secondary"
        icon="locate-outline"
        loading={geoBusy}
        onPress={handleUseMyLocation}
      />
      {(latitude.trim() && longitude.trim()) ? (
        <Text style={[styles.hint, { color: t.colors.textFaint }]}>
          {tr('setup.gpsSaved', { coords: `${latitude}, ${longitude}` })}
        </Text>
      ) : (
        <Text style={[styles.hint, { color: t.colors.textFaint }]}>
          {tr('setup.gpsHint', { myLoc: tr('setup.useMyLoc') })}
        </Text>
      )}

      <WorkingHoursForm value={workingHours} onChange={setWorkingHours} />

      <View
        style={[
          styles.breakRow,
          { backgroundColor: t.colors.surface, borderColor: t.colors.border },
        ]}
      >
        <View style={styles.breakTitles}>
          <Text style={[styles.breakTitle, { color: t.colors.text }]}>{tr('setup.breakTitle')}</Text>
          <Text style={[styles.breakSub, { color: t.colors.textMuted }]}>
            {tr('setup.breakHint')}
          </Text>
        </View>
        <Toggle
          value={breakHours.enabled}
          onValueChange={(enabled) => setBreakHours({ ...breakHours, enabled })}
          accessibilityLabel={tr('setup.breakTitle')}
        />
      </View>
      {breakHours.enabled ? (
        <View style={styles.breakTimes}>
          <View style={styles.breakCol}>
            <Field
              label={tr('setup.breakFrom')}
              value={breakHours.start}
              onChangeText={(start) => setBreakHours({ ...breakHours, start })}
              placeholder="13:00"
              maxLength={5}
              keyboardType="numbers-and-punctuation"
              style={styles.breakInput}
            />
          </View>
          <View style={styles.breakCol}>
            <Field
              label={tr('setup.breakTo')}
              value={breakHours.end}
              onChangeText={(end) => setBreakHours({ ...breakHours, end })}
              placeholder="14:00"
              maxLength={5}
              keyboardType="numbers-and-punctuation"
              style={styles.breakInput}
            />
          </View>
        </View>
      ) : null}

      <SectionTitle>{tr('setup.rules')}</SectionTitle>
      <Field
        label={tr('setup.minNotice')}
        value={minNoticeHours}
        onChangeText={setMinNoticeHours}
        placeholder="2"
        keyboardType="decimal-pad"
        icon="hourglass-outline"
        hint={tr('setup.minNoticeHint')}
      />
      <Field
        label={tr('setup.buffer')}
        value={bufferMinutes}
        onChangeText={setBufferMinutes}
        placeholder="0"
        keyboardType="number-pad"
        icon="pause-outline"
        hint={tr('setup.bufferHint')}
      />
      <Field
        label={tr('setup.maxDays')}
        value={maxAdvanceDays}
        onChangeText={setMaxAdvanceDays}
        placeholder="90"
        keyboardType="number-pad"
        icon="calendar-outline"
      />
      <Field
        label={tr('setup.cancelNotice')}
        value={cancelNoticeHours}
        onChangeText={setCancelNoticeHours}
        placeholder="2"
        keyboardType="decimal-pad"
        icon="close-circle-outline"
        hint={tr('setup.cancelHint')}
      />

      <SectionTitle>{tr('setup.discipline')}</SectionTitle>
      <View
        style={[
          styles.breakRow,
          { backgroundColor: t.colors.surface, borderColor: t.colors.border },
        ]}
      >
        <View style={styles.breakTitles}>
          <Text style={[styles.breakTitle, { color: t.colors.text }]}>
            {tr('setup.autoApprove')}
          </Text>
          <Text style={[styles.breakSub, { color: t.colors.textMuted }]}>
            {tr('setup.autoHint')}
          </Text>
        </View>
        <Toggle
          value={autoApprove}
          onValueChange={setAutoApprove}
          accessibilityLabel={tr('setup.autoApprove')}
        />
      </View>
      <Field
        label={tr('setup.blockAfter')}
        value={blockAfter}
        onChangeText={setBlockAfter}
        placeholder="2"
        keyboardType="number-pad"
        icon="ban-outline"
        hint={tr('setup.blockHint', { clients: tr('cli.title') })}
      />
      <Field
        label={tr('setup.loyalty')}
        value={loyaltyEvery}
        onChangeText={setLoyaltyEvery}
        placeholder="0"
        keyboardType="number-pad"
        icon="gift-outline"
        hint={tr('setup.loyaltyHint')}
      />

      <SectionTitle>{tr('setup.blockedTitle')}</SectionTitle>
      <Text style={[styles.hint, { color: t.colors.textMuted }]}>
        {tr('setup.blockedHint')}
      </Text>

      <DatePickerField label={tr('setup.oneDay')} value={blockDateDraft} onChange={setBlockDateDraft} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={tr('setup.blockDayBtn')}
        onPress={() => {
          if (!blockedDates.includes(blockDateDraft)) {
            setBlockedDates([...blockedDates, blockDateDraft].sort());
            setMessage(tr('setup.dayBlocked', { date: blockDateDraft }));
          } else {
            setMessage(tr('setup.dayAlreadyBlocked', { date: blockDateDraft }));
          }
        }}
        style={({ pressed }) => [
          styles.blockBtn,
          styles.blockBtnDay,
          { opacity: pressed ? 0.88 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] },
        ]}
      >
        <Ionicons name="lock-closed-outline" size={18} color="#ffffff" />
        <Text style={styles.blockBtnText} numberOfLines={1}>
          {tr('setup.blockDayBtn')}
        </Text>
      </Pressable>

      <DatePickerField
        label={tr('setup.leaveFrom')}
        value={blockRangeStart}
        onChange={(ymd) => {
          setBlockRangeStart(ymd);
          if (parseYmdLocal(ymd).getTime() > parseYmdLocal(blockRangeEnd).getTime()) {
            setBlockRangeEnd(ymd);
          }
        }}
      />
      <DatePickerField
        label={tr('setup.leaveTo')}
        value={blockRangeEnd}
        onChange={setBlockRangeEnd}
        minimumDate={parseYmdLocal(blockRangeStart)}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={tr('setup.blockLeaveBtn')}
        onPress={() => {
          const range = eachYmdInclusive(blockRangeStart, blockRangeEnd);
          if (range.length === 0) return;
          const merged = new Set(blockedDates);
          for (const d of range) merged.add(d);
          const next = [...merged].sort();
          setBlockedDates(next);
          const added = range.filter((d) => !blockedDates.includes(d)).length;
          setMessage(
            added > 0
              ? tr('setup.leaveBlocked', {
                  from: range[0],
                  to: range[range.length - 1],
                  count: added,
                })
              : tr('setup.rangeBlocked', { from: range[0], to: range[range.length - 1] })
          );
        }}
        style={({ pressed }) => [
          styles.blockBtn,
          styles.blockBtnLeave,
          { opacity: pressed ? 0.88 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] },
        ]}
      >
        <Ionicons name="calendar-outline" size={18} color="#ffffff" />
        <Text style={styles.blockBtnText} numberOfLines={1}>
          {tr('setup.blockLeaveBtn')}
        </Text>
      </Pressable>

      {blockedDates.length > 0 ? (
        <View style={styles.chipWrap}>
          {blockedDates.map((d) => (
            <Pressable
              key={d}
              onPress={() => setBlockedDates(blockedDates.filter((x) => x !== d))}
              style={({ pressed }) => [
                styles.chip,
                {
                  backgroundColor: t.colors.surface,
                  borderColor: t.colors.border,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <Text style={[styles.chipText, { color: t.colors.text }]} numberOfLines={1}>
                {d}
              </Text>
              <Ionicons name="close" size={14} color={t.colors.textMuted} />
            </Pressable>
          ))}
        </View>
      ) : (
        <Text style={[styles.hint, { color: t.colors.textFaint }]}>
          {tr('setup.noBlocked', { cal: tr('cal.title') })}
        </Text>
      )}

      {publicCode ? (
        <Callout tone="accent" title={tr('setup.pubCode', { code: publicCode ?? '' })}>
          {tr('setup.pubCodeHint')}
        </Callout>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  footer: { gap: spacing.md },
  breakRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  breakTitles: { flex: 1, gap: 2 },
  breakTitle: { fontSize: fontSize.md, fontWeight: '600' },
  breakSub: { fontSize: fontSize.sm, lineHeight: 18 },
  breakTimes: { flexDirection: 'row', gap: spacing.md },
  breakCol: { flex: 1 },
  breakInput: { textAlign: 'center' },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  chipText: { fontSize: fontSize.sm, fontWeight: '600' },
  hint: { fontSize: fontSize.sm, lineHeight: 18 },
  blockBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: 12,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    minHeight: 44,
  },
  blockBtnDay: {
    backgroundColor: '#3B82F6',
    shadowColor: '#60A5FA',
    shadowOpacity: 0.45,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  blockBtnLeave: {
    backgroundColor: '#DB2777',
    shadowColor: '#EC4899',
    shadowOpacity: 0.45,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  blockBtnText: {
    color: '#ffffff',
    fontSize: fontSize.sm,
    fontWeight: '700',
    flexShrink: 1,
  },

});