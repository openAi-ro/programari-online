import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { DatePickerField } from '@/components/DatePickerField';
import { PickerField } from '@/components/PickerField';
import { TimePickerField } from '@/components/TimePickerField';
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
import { fontSize, palette, radius, spacing } from '@/constants/theme';
import {
  DEFAULT_AUTO_APPROVE_RETURNING,
  DEFAULT_BREAK_HOURS,
  DEFAULT_DEPOSIT_RON,
  DEFAULT_BUFFER_MINUTES,
  DEFAULT_CANCEL_NOTICE_MINUTES,
  DEFAULT_LOYALTY_EVERY,
  DEFAULT_MAX_ADVANCE_DAYS,
  DEFAULT_MIN_NOTICE_MINUTES,
  DEFAULT_NO_SHOW_BLOCK_AFTER,
  DEFAULT_TIMEZONE,
  DEFAULT_WORKING_HOURS,
} from '@/lib/defaults';
import { STAFF_COLORS } from '@/lib/defaults';
import { reverseGeocodeRo } from '@/lib/location';
import { useBack } from '@/lib/nav';
import { generatePublicCode } from '@/lib/publicCode';
import * as Clipboard from 'expo-clipboard';
import {
  buildBioText,
  normalizeFacebookUrl,
  normalizeInstagramUrl,
} from '@/lib/socialLinks';
import { getWebBookingUrl } from '@/lib/bookingLink';
import {
  JUDETE,
  adresaCompleta,
  judetCanonic,
  judetPentruLocalitate,
  localitateCanonica,
  localitatiPentruJudet,
} from '@/lib/roGeo';
import { getSelectedBusinessId, setSelectedBusinessId } from '@/lib/myBusiness';
import { validateSchedule } from '@/lib/workingHoursRules';
import { isValidTimeZone } from '@/lib/timezone';
import { supabase } from '@/lib/supabase';
import { getCurrentUser } from '@/lib/currentUser';
import { withTimeout } from '@/lib/withTimeout';
import {
  BROWSE_CATEGORIES,
  categoryLabel,
  categoryLabelForKey,
} from '@/lib/browseCategories';
import { COUNTRY_TIMEZONES, countryByCode, countryByName, countryCodeOf, countryNames, DEFAULT_COUNTRY_CODE } from '@/lib/countries';
import { getDeviceCoords } from '@/lib/discover';
import { trKey, useLanguage, useT } from '@/lib/i18n';
import type { BreakHours, BusinessProfile, WorkingHours } from '@/lib/types';
import { useTransientMessage } from '@/lib/useTransientMessage';
import { managerOnly } from '@/components/ManagerOnly';
import {
  GENERAL_CATEGORY_KEY,
  normalizeSpecialization,
  SPECIALIZATION_MAX,
  specializationError,
} from '@/lib/specialization';

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

function BusinessSetupScreen() {
  const t = useTheme();
  const back = useBack();
  const tr = useT();
  const router = useRouter();
  const { lang } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [geoBusy, setGeoBusy] = useState(false);
  const [existingId, setExistingId] = useState<string | null>(null);
  const [publicCode, setPublicCode] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [specialization, setSpecialization] = useState('');
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
  const [referralOn, setReferralOn] = useState(false);
  const [referralReward, setReferralReward] = useState('');
  const [depositRon, setDepositRon] = useState(String(DEFAULT_DEPOSIT_RON));
  const [offpeakPercent, setOffpeakPercent] = useState('');
  const [offpeakHours, setOffpeakHours] = useState('');
  const [myBusinesses, setMyBusinesses] = useState<BusinessProfile[]>([]);
  const [country, setCountry] = useState(DEFAULT_COUNTRY_CODE);
  const [county, setCounty] = useState('');
  const [city, setCity] = useState('');
  const [address, setAddress] = useState('');
  const [mapsUrl, setMapsUrl] = useState('');
  const [instagramInput, setInstagramInput] = useState('');
  const [facebookInput, setFacebookInput] = useState('');
  const [googleReviewUrl, setGoogleReviewUrl] = useState('');

  useEffect(() => {
    if (!existingId) return;
    let cancelled = false;
    void supabase
      .from('business_profiles')
      .select('google_review_url, instagram_url, facebook_url')
      .eq('id', existingId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled || !data) return;
        setGoogleReviewUrl(data.google_review_url ?? '');
        setInstagramInput(data.instagram_url ?? '');
        setFacebookInput(data.facebook_url ?? '');
      });
    return () => {
      cancelled = true;
    };
  }, [existingId]);
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [blockedDates, setBlockedDates] = useState<string[]>([]);
  const [openSections, setOpenSections] = useState({ schedule: true, booking: true, more: false });
  const [blockDateDraft, setBlockDateDraft] = useState(todayYmd);
  const [blockRangeStart, setBlockRangeStart] = useState(todayYmd);
  const [blockRangeEnd, setBlockRangeEnd] = useState(todayYmd);
  const [error, setError] = useTransientMessage();
  const [loadFailed, setLoadFailed] = useState(false);
  const [message, setMessage] = useTransientMessage();

  useEffect(() => {
    let cancelled = false;
    // Gardă anti-blocare: dacă interogările atârnă (fără net / DNS blocat),
    // ecranul iese din loading cu mesaj în loc de schelet infinit.
    const timer = setTimeout(() => {
      if (cancelled) return;
      cancelled = true;
      setError(trKey('setup.loadFail'), { sticky: true });
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
          setError(e instanceof Error ? e.message : trKey('setup.loadFailShort'), { sticky: true });
        }
      } finally {
        done();
      }
    })();
    async function loadBusiness() {
      const user = await getCurrentUser();
      if (cancelled) return;
      if (!user) {
        return;
      }
      const { data, error: loadErr } = await supabase
        .from('business_profiles')
        .select('*')
        .eq('owner_user_id', user.id)
        .order('created_at', { ascending: true });
      if (loadErr) {
        if (!cancelled) {
          setLoadFailed(true);
          setError(trKey('setup.loadFail'), { sticky: true });
        }
        return;
      }
      if (data) {
        const rows = (data ?? []) as BusinessProfile[];
        setMyBusinesses(rows);
        const selectedBizId = await getSelectedBusinessId();
        const b = rows.find((r) => r.id === selectedBizId) ?? rows[0];
        if (b) {
        setExistingId(b.id);
        setPublicCode(b.public_code);
        setName(b.name);
        setCategory(typeof b.category === 'string' ? b.category : '');
        setSpecialization(b.specialization ?? '');
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
        setReferralOn(Boolean(b.referral_enabled));
        setReferralReward(b.referral_reward_text ?? '');
        setDepositRon(String(b.deposit_ron ?? DEFAULT_DEPOSIT_RON));
        setOffpeakPercent(b.offpeak_discount_percent ? String(b.offpeak_discount_percent) : '');
        setOffpeakHours(
          b.offpeak_start_hour != null && b.offpeak_end_hour != null
            ? `${b.offpeak_start_hour}-${b.offpeak_end_hour}`
            : ''
        );

        // Adresele vechi aveau doar orașul; deducem județul din nomenclator.
        setCountry(countryCodeOf(b.country));
    const judet = judetCanonic(b.county) || judetPentruLocalitate(b.city);
        setCountry(countryCodeOf(b.country));
        setCounty(judet);
        setCity(localitateCanonica(judet, b.city) || b.city || '');
        setAddress(b.address ?? '');
        setMapsUrl(b.maps_url ?? '');
        setGoogleReviewUrl(b.google_review_url ?? '');
        setInstagramInput(b.instagram_url ?? '');
        setFacebookInput(b.facebook_url ?? '');
        setLatitude(b.latitude != null ? String(b.latitude) : '');
        setLongitude(b.longitude != null ? String(b.longitude) : '');
        setBlockedDates(Array.isArray(b.blocked_dates) ? b.blocked_dates : []);
        }
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
      // Timeout-ul pornește doar după acordarea permisiunii (lib/locateTiming).
      const { latitude: lat, longitude: lon } = await getDeviceCoords();
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


  function switchBusiness(b: BusinessProfile) {
    void setSelectedBusinessId(b.id);
    setExistingId(b.id);
    setPublicCode(b.public_code);
    setName(b.name);
    setCategory(typeof b.category === 'string' ? b.category : '');
    setSpecialization(b.specialization ?? '');
    setTimezone(b.timezone || DEFAULT_TIMEZONE);
    setDuration(String(b.session_duration_minutes));
    setWorkingHours(b.working_hours);
    setBreakHours(b.break_hours ?? DEFAULT_BREAK_HOURS);
    setMinNoticeHours(String((b.min_notice_minutes ?? DEFAULT_MIN_NOTICE_MINUTES) / 60));
    setBufferMinutes(String(b.buffer_minutes ?? DEFAULT_BUFFER_MINUTES));
    setMaxAdvanceDays(String(b.max_advance_days ?? DEFAULT_MAX_ADVANCE_DAYS));
    setCancelNoticeHours(String((b.cancel_notice_minutes ?? DEFAULT_CANCEL_NOTICE_MINUTES) / 60));
    setAutoApprove(Boolean(b.auto_approve_returning));
    setBlockAfter(String(b.no_show_block_after ?? DEFAULT_NO_SHOW_BLOCK_AFTER));
    setLoyaltyEvery(String(b.loyalty_every ?? DEFAULT_LOYALTY_EVERY));
    setReferralOn(Boolean(b.referral_enabled));
    setReferralReward(b.referral_reward_text ?? '');
    setOffpeakPercent(b.offpeak_discount_percent ? String(b.offpeak_discount_percent) : '');
    setOffpeakHours(
      b.offpeak_start_hour != null && b.offpeak_end_hour != null
        ? `${b.offpeak_start_hour}-${b.offpeak_end_hour}`
        : ''
    );
    setDepositRon(String(b.deposit_ron ?? DEFAULT_DEPOSIT_RON));
    setCountry(countryCodeOf(b.country));
    const judet = judetCanonic(b.county) || judetPentruLocalitate(b.city);
    setCounty(judet);
    setCity(localitateCanonica(judet, b.city) || b.city || '');
    setAddress(b.address ?? '');
    setMapsUrl(b.maps_url ?? '');
    setGoogleReviewUrl(b.google_review_url ?? '');
    setInstagramInput(b.instagram_url ?? '');
    setFacebookInput(b.facebook_url ?? '');
    setLatitude(b.latitude != null ? String(b.latitude) : '');
    setLongitude(b.longitude != null ? String(b.longitude) : '');
    setBlockedDates(Array.isArray(b.blocked_dates) ? b.blocked_dates : []);
    setMessage(null);
    setError(null);
  }

  /** Specializarea există doar la categoria General (obligatorie acolo); altfel null. */
  function specializationValue(): { ok: true; value: string | null } | { ok: false } {
    if (category !== GENERAL_CATEGORY_KEY) return { ok: true, value: null };
    const err = specializationError(specialization);
    if (err) {
      setError(trKey(err === 'tooLong' ? 'spec.tooLong' : err === 'tooShort' ? 'spec.tooShort' : 'spec.empty'));
      return { ok: false };
    }
    return { ok: true, value: normalizeSpecialization(specialization) };
  }

  async function handleSave() {
    if (loadFailed) {
      // Încărcarea firmei a eșuat: nu salvăm, ca să nu creăm un duplicat.
      setError(trKey('setup.loadFail'));
      return;
    }
    setError(null);
    setMessage(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setError(trKey('setup.nameRequired'));
      return;
    }
    const spec = specializationValue();
    if (!spec.ok) return;
    const minutes = parseInt(duration, 10);
    if (!Number.isFinite(minutes) || minutes < 5 || minutes > 480) {
      setError(trKey('svc.badDuration'));
      return;
    }
    if (!timezone.trim()) {
      setError(trKey('setup.tzRequired'));
      return;
    }
    if (!isValidTimeZone(timezone.trim())) {
      setError(trKey('setup.badTimezone'));
      return;
    }
    const scheduleErr = validateSchedule(workingHours, breakHours);
    if (scheduleErr) {
      setError(trKey(scheduleErr === 'hours' ? 'setup.badHours' : 'setup.badBreak'));
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
    const deposit = Number(String(depositRon).replace(',', '.'));
    if (!Number.isFinite(deposit) || deposit < 0 || deposit > 100000) {
      setError(trKey('svc.badPrice'));
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

    const offpeakPctRaw = offpeakPercent.trim();
    const offpeakPct = offpeakPctRaw === '' ? 0 : parseInt(offpeakPctRaw, 10);
    const hoursParts = offpeakHours.trim() === '' ? [] : offpeakHours.trim().split('-');
    const offpeakStartRaw = (hoursParts[0] ?? '').trim();
    const offpeakEndRaw = (hoursParts[1] ?? '').trim();
    const offpeakStartH = offpeakStartRaw === '' ? null : parseInt(offpeakStartRaw, 10);
    const offpeakEndH = offpeakEndRaw === '' ? null : parseInt(offpeakEndRaw, 10);
    if (
      hoursParts.length > 2 ||
      !Number.isFinite(offpeakPct) ||
      offpeakPct < 0 ||
      offpeakPct > 90 ||
      (offpeakStartH !== null && (!Number.isFinite(offpeakStartH) || offpeakStartH < 0 || offpeakStartH > 23)) ||
      (offpeakEndH !== null && (!Number.isFinite(offpeakEndH) || offpeakEndH < 0 || offpeakEndH > 23)) ||
      ((offpeakStartH === null) !== (offpeakEndH === null)) ||
      (offpeakPct === 0 && (offpeakStartH !== null || offpeakEndH !== null))
    ) {
      setError(trKey('setup.badOffpeak'));
      return;
    }
    if (
      (instagramInput.trim() && !normalizeInstagramUrl(instagramInput)) ||
      (facebookInput.trim() && !normalizeFacebookUrl(facebookInput))
    ) {
      setError(trKey('setup.badSocial'));
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
      referral_enabled: referralOn,
      referral_reward_text: referralReward.trim() || null,
      deposit_ron: deposit,
      google_review_url: googleReviewUrl.trim() || null,
      instagram_url: normalizeInstagramUrl(instagramInput),
      facebook_url: normalizeFacebookUrl(facebookInput),
      offpeak_discount_percent: offpeakPct,
      offpeak_start_hour: offpeakStartH,
      offpeak_end_hour: offpeakEndH,
    };

    setSaving(true);
    const user = await getCurrentUser();
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
          specialization: spec.value,
          timezone: timezone.trim(),
          session_duration_minutes: minutes,
          working_hours: workingHours,
          break_hours: breakHours,
          country,
          county: country === 'RO' ? county.trim() || null : null,
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
        specialization: spec.value,
        timezone: timezone.trim(),
        session_duration_minutes: minutes,
        working_hours: workingHours,
        break_hours: breakHours,
        country,
        county: country === 'RO' ? county.trim() || null : null,
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
    let seedFailed = false;
    const { data: existingServices, error: svcCheckErr } = await supabase
      .from('services')
      .select('id')
      .eq('business_id', b.id)
      .limit(1);
    if (svcCheckErr) {
      seedFailed = true;
    } else if (!existingServices?.length) {
      const { error: svcErr } = await supabase.from('services').insert({
        business_id: b.id,
        name: trKey('cli.session'),
        duration_minutes: minutes,
        price: 0,
        sort_order: 0,
      });
      if (svcErr) seedFailed = true;
    }
    const { data: existingStaff, error: staffCheckErr } = await supabase
      .from('staff')
      .select('id')
      .eq('business_id', b.id)
      .limit(1);
    if (staffCheckErr) {
      seedFailed = true;
    } else if (!existingStaff?.length) {
      const { error: staffErr } = await supabase.from('staff').insert({
        business_id: b.id,
        name: trimmed,
        color: STAFF_COLORS[0],
        sort_order: 0,
      });
      if (staffErr) seedFailed = true;
    }
    if (seedFailed) {
      setError(trKey('setup.defaultSeedFail'));
    } else {
      setMessage(trKey('setup.created'));
    }
  }

  type SetupSection = 'identity' | 'location' | 'schedule' | 'booking' | 'more';

  /** Salvare separata pe sectiune (doar coloanele sectiunii); la creare foloseste salvarea completa. */
  async function saveSection(section: SetupSection) {
    if (!existingId) {
      await handleSave();
      return;
    }
    setError(null);
    setMessage(null);
    let columns: Record<string, unknown> = {};
    if (section === 'identity') {
      const trimmed = name.trim();
      if (!trimmed) { setError(trKey('setup.nameRequired')); return; }
      const minutes = parseInt(duration, 10);
      if (!Number.isFinite(minutes) || minutes < 5 || minutes > 480) { setError(trKey('svc.badDuration')); return; }
      if (!timezone.trim()) { setError(trKey('setup.tzRequired')); return; }
      if (!isValidTimeZone(timezone.trim())) { setError(trKey('setup.badTimezone')); return; }
      const spec = specializationValue();
      if (!spec.ok) return;
      columns = { name: trimmed, category: category.trim() || null, specialization: spec.value, timezone: timezone.trim(), session_duration_minutes: minutes };
    } else if (section === 'location') {
      if (county.trim() && !city.trim()) { setError(trKey('setup.pickCity')); return; }
      const lat = latitude.trim() === '' ? null : Number(String(latitude).replace(',', '.'));
      const lon = longitude.trim() === '' ? null : Number(String(longitude).replace(',', '.'));
      if ((lat === null) !== (lon === null)) { setError(trKey('setup.bothCoords')); return; }
      if (lat !== null && (!Number.isFinite(lat) || lat < -90 || lat > 90)) { setError(trKey('setup.badLat')); return; }
      if (lon !== null && (!Number.isFinite(lon) || lon < -180 || lon > 180)) { setError(trKey('setup.badLon')); return; }
      if ((instagramInput.trim() && !normalizeInstagramUrl(instagramInput)) || (facebookInput.trim() && !normalizeFacebookUrl(facebookInput))) { setError(trKey('setup.badSocial')); return; }
      columns = {
        country, county: country === 'RO' ? county.trim() || null : null, city: city.trim() || null,
        address: address.trim() || null, maps_url: mapsUrl.trim() || null, latitude: lat, longitude: lon,
        google_review_url: googleReviewUrl.trim() || null,
        instagram_url: normalizeInstagramUrl(instagramInput),
        facebook_url: normalizeFacebookUrl(facebookInput),
      };
    } else if (section === 'schedule') {
      const scheduleErr = validateSchedule(workingHours, breakHours);
      if (scheduleErr) { setError(trKey(scheduleErr === 'hours' ? 'setup.badHours' : 'setup.badBreak')); return; }
      const deposit = Number(String(depositRon).replace(',', '.'));
      if (!Number.isFinite(deposit) || deposit < 0 || deposit > 100000) { setError(trKey('svc.badPrice')); return; }
      const offpeakPctRaw = offpeakPercent.trim();
      const offpeakPct = offpeakPctRaw === '' ? 0 : parseInt(offpeakPctRaw, 10);
      const hoursParts = offpeakHours.trim() === '' ? [] : offpeakHours.trim().split('-');
      const offpeakStartH = (hoursParts[0] ?? '').trim() === '' ? null : parseInt((hoursParts[0] ?? '').trim(), 10);
      const offpeakEndH = (hoursParts[1] ?? '').trim() === '' ? null : parseInt((hoursParts[1] ?? '').trim(), 10);
      if (hoursParts.length > 2 || !Number.isFinite(offpeakPct) || offpeakPct < 0 || offpeakPct > 90 || (offpeakStartH !== null && (!Number.isFinite(offpeakStartH) || offpeakStartH < 0 || offpeakStartH > 23)) || (offpeakEndH !== null && (!Number.isFinite(offpeakEndH) || offpeakEndH < 0 || offpeakEndH > 23)) || ((offpeakStartH === null) !== (offpeakEndH === null)) || (offpeakPct === 0 && (offpeakStartH !== null || offpeakEndH !== null))) { setError(trKey('setup.badOffpeak')); return; }
      columns = { working_hours: workingHours, break_hours: breakHours, deposit_ron: deposit, offpeak_discount_percent: offpeakPct, offpeak_start_hour: offpeakStartH, offpeak_end_hour: offpeakEndH };
    } else if (section === 'booking') {
      const minNotice = Math.round(Number(String(minNoticeHours).replace(',', '.')) * 60);
      const buffer = parseInt(bufferMinutes, 10);
      const maxDays = parseInt(maxAdvanceDays, 10);
      const cancelNotice = Math.round(Number(String(cancelNoticeHours).replace(',', '.')) * 60);
      if (!Number.isFinite(minNotice) || minNotice < 0 || minNotice > 10080) { setError(trKey('setup.badMinNotice')); return; }
      if (!Number.isFinite(buffer) || buffer < 0 || buffer > 240) { setError(trKey('setup.badBuffer')); return; }
      if (!Number.isFinite(maxDays) || maxDays < 1 || maxDays > 365) { setError(trKey('setup.badMaxDays')); return; }
      if (!Number.isFinite(cancelNotice) || cancelNotice < 0 || cancelNotice > 10080) { setError(trKey('setup.badCancelNotice')); return; }
      columns = { min_notice_minutes: minNotice, buffer_minutes: buffer, max_advance_days: maxDays, cancel_notice_minutes: cancelNotice };
    } else {
      const blockN = parseInt(blockAfter, 10);
      const loyalty = parseInt(loyaltyEvery, 10);
      if (!Number.isFinite(blockN) || blockN < 0 || blockN > 20) { setError(trKey('setup.badBlock')); return; }
      if (!Number.isFinite(loyalty) || loyalty < 0 || loyalty > 50) { setError(trKey('setup.badLoyalty')); return; }
      if (loyalty === 1) { setError(trKey('setup.loyaltyMin')); return; }
      columns = { auto_approve_returning: autoApprove, no_show_block_after: blockN, loyalty_every: loyalty, referral_enabled: referralOn, referral_reward_text: referralReward.trim() || null, blocked_dates: blockedDates };
    }
    setSaving(true);
    const { error: err } = await supabase.from('business_profiles').update({ ...columns, updated_at: new Date().toISOString() }).eq('id', existingId);
    setSaving(false);
    if (err) { setError(err.message); return; }
    setMessage(trKey('setup.updated'));
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
            <Callout onClose={() => setError(null)} tone="danger" title={tr('setup.checkData')}>
              {error}
            </Callout>
          ) : null}
          {message ? (
            <Callout onClose={() => setMessage(null)} tone="success" title={tr('common.done')}>
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
          {existingId ? (
            <Button
              label={tr('priv.openFromSetup')}
              variant="secondary"
              icon="lock-closed-outline"
              onPress={() => router.push('/(app)/business/private-codes' as never)}
            />
          ) : null}
        </View>
      }
    >
      {myBusinesses.length > 1 ? (
        <PickerField
          label={tr('biz.activeBusiness')}
          value={myBusinesses.find((b) => b.id === existingId)?.name ?? ''}
          options={myBusinesses.map((b) => b.name)}
          onChange={(label) => { const b = myBusinesses.find((x) => x.name === label); if (b) switchBusiness(b); }}
          placeholder={tr('biz.activeBusiness')}
          icon="swap-horizontal-outline"
        />
      ) : null}
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
      {category === GENERAL_CATEGORY_KEY ? (
        <Field
          label={tr('spec.label')}
          value={specialization}
          onChangeText={(v) => setSpecialization(v.slice(0, SPECIALIZATION_MAX + 10))}
          placeholder={tr('spec.placeholder')}
          icon="pricetag-outline"
          hint={tr('spec.hint')}
          autoCapitalize="sentences"
        />
      ) : null}
      <Field
        label={tr('setup.sessionDur')}
        value={duration}
        onChangeText={setDuration}
        placeholder="60"
        keyboardType="number-pad"
        icon="time-outline"
        hint={tr('setup.sessionHint')}
      />

      <PickerField
        label={tr('setup.timezone')}
        value={timezone}
        options={COUNTRY_TIMEZONES}
        onChange={setTimezone}
        placeholder="Europe/Bucharest"
        icon="globe-outline"
                hint={tr('setup.tzHint')}
      />

            {existingId ? <Button label={tr('setup.saveSection')} variant="secondary" size="sm" loading={saving} onPress={() => void saveSection('identity')} /> : null}
      <SectionTitle>{tr('setup.location')}</SectionTitle>
      <Callout tone="info" title={tr('setup.bizAddress')}>
        {tr('setup.addrHint', { myLoc: tr('setup.useMyLoc') })}
      </Callout>
      <PickerField
        label={tr('setup.country')}
        value={(lang === 'en' ? countryByCode(country)?.nameEn : countryByCode(country)?.nameRo) ?? ''}
        options={countryNames(lang)}
        onChange={(label) => {
          const next = countryByName(label, lang);
          if (!next) return;
          setCountry(next.code);
          setTimezone(next.timezone);
          if (next.code !== 'RO') setCounty('');
        }}
        placeholder={tr('setup.country')}
        icon="flag-outline"
        hint={tr('setup.countryHint')}
      />
      {country === 'RO' ? (
        <>
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
        </>
      ) : (
        <Field
          label={tr('setup.cityFree')}
          value={city}
          onChangeText={setCity}
          placeholder="London / Berlin / Chișinău"
          icon="business-outline"
          autoCapitalize="words"
        />
      )}
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
      <Field
        label={tr('setup.reviewLink')}
        value={googleReviewUrl}
        onChangeText={setGoogleReviewUrl}
        placeholder="https://g.page/…"
        icon="star-outline"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        hint={tr('setup.reviewHint')}
      />
      <Field
        label={tr('setup.instagram')}
        value={instagramInput}
        onChangeText={setInstagramInput}
        placeholder="@salonul.tau"
        icon="logo-instagram"
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Field
        label={tr('setup.facebook')}
        value={facebookInput}
        onChangeText={setFacebookInput}
        placeholder="SalonulTau"
        icon="logo-facebook"
        autoCapitalize="none"
        autoCorrect={false}
      />
      {publicCode ? (
        <Button
          label={tr('setup.copyBio')}
          variant="secondary"
          icon="copy-outline"
          onPress={() =>
            void (async () => {
              const bizName =
                myBusinesses.find((b) => b.id === existingId)?.name ?? name;
              await Clipboard.setStringAsync(buildBioText(bizName, getWebBookingUrl(publicCode)));
              setMessage(trKey('setup.bioCopied'));
            })()
          }
        />
      ) : null}
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

      {existingId ? <Button label={tr('setup.saveSection')} variant="secondary" size="sm" loading={saving} onPress={() => void saveSection('location')} /> : null}
            <Pressable onPress={() => setOpenSections((s) => ({ ...s, schedule: !s.schedule }))} accessibilityRole="button">
        <SectionTitle>{tr('setup.secSchedule')}</SectionTitle>
      </Pressable>
      {openSections.schedule ? (
        <>
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
            <TimePickerField
              label={tr('setup.breakFrom')}
              value={breakHours.start}
              onChange={(start) => setBreakHours({ ...breakHours, start })}
              placeholder="13:00"
            />
          </View>
          <View style={styles.breakCol}>
            <TimePickerField
              label={tr('setup.breakTo')}
              value={breakHours.end}
              onChange={(end) => setBreakHours({ ...breakHours, end })}
              placeholder="14:00"
            />
          </View>
        </View>
      ) : null}

      <Field
        label={tr('setup.depositLabel')}
        value={depositRon}
        onChangeText={setDepositRon}
        placeholder={tr('setup.depositPh')}
        keyboardType="decimal-pad"
        icon="cash-outline"
        hint={tr('setup.depositHint')}
      />
      <Field
        label={tr('setup.offpeakPercent')}
        value={offpeakPercent}
        onChangeText={setOffpeakPercent}
        placeholder="10"
        keyboardType="number-pad"
        icon="pricetag-outline"
        hint={tr('setup.offpeakHint')}
      />
      <Field
        label={tr('setup.offpeakHours')}
        value={offpeakHours}
        onChangeText={(v) => setOffpeakHours(v.replace(/[^0-9-]/g, ''))}
        placeholder="10-14"
        keyboardType="numbers-and-punctuation"
        icon="time-outline"
      />

      
        </>
      ) : null}
      {existingId ? <Button label={tr('setup.saveSection')} variant="secondary" size="sm" loading={saving} onPress={() => void saveSection('schedule')} /> : null}
      <Pressable onPress={() => setOpenSections((s) => ({ ...s, booking: !s.booking }))} accessibilityRole="button">
        <SectionTitle>{tr('setup.secBooking')}</SectionTitle>
      </Pressable>
      {openSections.booking ? (
        <>
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

      
        </>
      ) : null}
      {existingId ? <Button label={tr('setup.saveSection')} variant="secondary" size="sm" loading={saving} onPress={() => void saveSection('booking')} /> : null}
      <Pressable onPress={() => setOpenSections((s) => ({ ...s, more: !s.more }))} accessibilityRole="button">
        <SectionTitle>{tr('setup.secMore')}</SectionTitle>
      </Pressable>
      {openSections.more ? (
        <>
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
      <View
        style={[
          styles.breakRow,
          { backgroundColor: t.colors.surface, borderColor: t.colors.border },
        ]}
      >
        <View style={styles.breakTitles}>
          <Text style={[styles.breakTitle, { color: t.colors.text }]}>
            {tr('setup.referral')}
          </Text>
          <Text style={[styles.breakSub, { color: t.colors.textMuted }]}>
            {tr('setup.referralHint')}
          </Text>
        </View>
        <Toggle
          value={referralOn}
          onValueChange={setReferralOn}
          accessibilityLabel={tr('setup.referral')}
        />
      </View>
      {referralOn ? (
        <Field
          label={tr('setup.referralReward')}
          value={referralReward}
          onChangeText={setReferralReward}
          placeholder="10% reducere"
          icon="gift-outline"
        />
      ) : null}

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
        <Ionicons name="lock-closed-outline" size={18} color={palette.white} />
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
        <Ionicons name="calendar-outline" size={18} color={palette.white} />
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
      ) : null}


        </>
      ) : null}
      {existingId ? <Button label={tr('setup.saveSection')} variant="secondary" size="sm" loading={saving} onPress={() => void saveSection('more')} /> : null}
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
    backgroundColor: palette.sky600,
    shadowColor: palette.sky500,
    shadowOpacity: 0.45,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  blockBtnLeave: {
    backgroundColor: palette.danger600,
    shadowColor: palette.danger600,
    shadowOpacity: 0.45,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  blockBtnText: {
    color: palette.white,
    fontSize: fontSize.sm,
    fontWeight: '700',
    flexShrink: 1,
  },

});

export default managerOnly(BusinessSetupScreen);
