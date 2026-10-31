import { Component, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import Constants from 'expo-constants';
import MapView, { Marker, PROVIDER_GOOGLE, type Region } from 'react-native-maps';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { palette, radius } from '@/constants/theme';
import { getLanguageSync, type AppLanguage } from '@/lib/language';
import { trKey, useLanguage } from '@/lib/i18n';

type Props = {
  latitude: number | null;
  longitude: number | null;
  title?: string;
  onPick: (coords: { latitude: number; longitude: number }) => void;
  onMarkerPress?: () => void;
  height?: number;
};

/** Valoare de completat din șabloane — nu e o cheie reală. */
const MAPS_KEY_PLACEHOLDER = 'REPLACE_WITH_YOUR_GOOGLE_MAPS_KEY';

function realKey(v: string | undefined | null): string {
  const k = (v ?? '').trim();
  return k && k !== MAPS_KEY_PLACEHOLDER ? k : '';
}

/** Cheie Maps: .env EXPO_PUBLIC_GOOGLE_MAPS_API_KEY, apoi app.json extra / ios / android. Placeholder = fără cheie. */
export function getMapsApiKey(): string {
  const fromEnv = realKey(process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY);
  if (fromEnv) return fromEnv;
  const extra = Constants.expoConfig?.extra as { googleMapsApiKey?: string } | undefined;
  const fromExtra = realKey(extra?.googleMapsApiKey);
  if (fromExtra) return fromExtra;
  const ios = realKey(
    (Constants.expoConfig as { ios?: { config?: { googleMapsApiKey?: string } } } | null)?.ios
      ?.config?.googleMapsApiKey
  );
  if (ios) return ios;
  return realKey(
    (
      Constants.expoConfig as {
        android?: { config?: { googleMaps?: { apiKey?: string } } };
      } | null
    )?.android?.config?.googleMaps?.apiKey
  );
}

export function hasGoogleMapsApiKey(): boolean {
  return getMapsApiKey().length > 0;
}

/** Pași pentru generarea / activarea cheii (afișați în Configurare dacă lipsește). */
export const GOOGLE_MAPS_KEY_GUIDE = `1) Deschide Google Cloud Console → APIs & Services → Credentials
2) Create credentials → API key
3) Activează: Maps SDK for Android, Maps SDK for iOS, Maps JavaScript API + Geocoding API. Verifică și Billing (fără billing harta JS arată "Hopa! A apărut o eroare").
4) Dacă harta arată "Hopa! A apărut o eroare" + detalii în consola JS: în DevTools → Console vezi codul Google (ApiNotActivatedMapError, RefererNotAllowedMapError, InvalidKeyMapError, BillingNotEnabledMapError). Activează API-ul lipsă, adaugă referrer-ul sau activează billingul.
5) Restricții pe cheie: Android apps = com.programari.app + SHA-1 din EAS; Web: cheia folosită în WebView/iframe (origin null sau about:blank) e blocată de Website restrictions — folosește o cheie separată FĂRĂ Website restrictions (doar cu API restrictions: Maps JavaScript API) sau lasă Application restrictions = None pentru cheia JS.
6) Pune cheia în apps/mobile/.env ca EXPO_PUBLIC_GOOGLE_MAPS_API_KEY=...
   și în app.json (ios.config.googleMapsApiKey + android.config.googleMaps.apiKey + extra.googleMapsApiKey)
7) Rebuild APK (cheia nativă nu intră mereu prin OTA). Pe web/Expo Go nu e nevoie de rebuild.
Consolă: https://console.cloud.google.com/google/maps-apis/start`;

/** EN version of the key guide (shown when the app language is English). */
export const GOOGLE_MAPS_KEY_GUIDE_EN = `1) Open Google Cloud Console → APIs & Services → Credentials
2) Create credentials → API key
3) Enable: Maps SDK for Android, Maps SDK for iOS, Maps JavaScript API + Geocoding API. Also check Billing (without billing the JS map shows an error overlay).
4) If the map shows an error overlay + details in the JS console: in DevTools → Console you see the Google code (ApiNotActivatedMapError, RefererNotAllowedMapError, InvalidKeyMapError, BillingNotEnabledMapError). Enable the missing API, add the referrer or enable billing.
5) Key restrictions: Android apps = com.programari.app + SHA-1 from EAS; Web: the key used in WebView/iframe (origin null or about:blank) is blocked by Website restrictions — use a separate key WITHOUT Website restrictions (only with API restrictions: Maps JavaScript API) or leave Application restrictions = None for the JS key.
6) Put the key in apps/mobile/.env as EXPO_PUBLIC_GOOGLE_MAPS_API_KEY=...
   and in app.json (ios.config.googleMapsApiKey + android.config.googleMaps.apiKey + extra.googleMapsApiKey)
7) Rebuild the APK (the native key does not always come through OTA). On web/Expo Go no rebuild is needed.
Console: https://console.cloud.google.com/google/maps-apis/start`;

const GOOGLE_HTML_STRINGS: Record<AppLanguage, { hint: string; authFailure: string; loadError: string; markerTitle: string; noKey: string; missingTitle: string; fallbackHint: string; guide: string }> = {
  ro: {
    hint: 'Apasă pe harta Google ca să pui pinul. Trage pinul ca să-l muți.',
    authFailure: 'Google Maps a respins cheia (verifică consola JS: RefererNotAllowed / ApiNotActivated / BillingNotEnabled). Vezi ghidul cheii din ecranul Configurare.',
    loadError: 'Nu s-a putut încărca Google Maps (rețea sau restricții pe cheie). Verifică consola JS.',
    markerTitle: 'Afacerea ta',
    noKey: 'Lipsește cheia Google Maps în config.',
    missingTitle: 'Lipsește cheia Google Maps',
    fallbackHint: 'Harta nativă Google nu a pornit — folosești tot Google Maps (JS). Pinul se salvează la fel.',
    guide: GOOGLE_MAPS_KEY_GUIDE,
  },
  en: {
    hint: 'Tap the Google map to drop the pin. Drag the pin to move it.',
    authFailure: 'Google Maps rejected the key (check the JS console: RefererNotAllowed / ApiNotActivated / BillingNotEnabled). See the key guide in the Setup screen.',
    loadError: 'Couldn’t load Google Maps (network or key restrictions). Check the JS console.',
    markerTitle: 'Your business',
    noKey: 'Google Maps key missing from config.',
    missingTitle: 'Google Maps key missing',
    fallbackHint: 'Native Google map did not start — you still use Google Maps (JS). The pin saves the same.',
    guide: GOOGLE_MAPS_KEY_GUIDE_EN,
  },
};

function buildGoogleHtml(lat: number, lng: number, hasPin: boolean, apiKey: string): string {
  const keyJson = JSON.stringify(apiKey);
  const s = GOOGLE_HTML_STRINGS[getLanguageSync()];
  const hintJson = JSON.stringify(s.hint);
  const authFailureJson = JSON.stringify(s.authFailure);
  const loadErrorJson = JSON.stringify(s.loadError);
  const markerTitleJson = JSON.stringify(s.markerTitle);
  const noKeyJson = JSON.stringify(s.noKey);
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
  <style>
    html, body, #map { height: 100%; margin: 0; padding: 0; }
    .hint {
      position: absolute; z-index: 5; left: 10px; right: 10px; top: 10px;
      background: rgba(255,255,255,0.95); border-radius: 10px; padding: 8px 10px;
      font: 600 13px/1.35 -apple-system, BlinkMacSystemFont, sans-serif; color: ${palette.ink950};
      box-shadow: 0 2px 8px rgba(15,23,42,0.12);
    }
    .err {
      position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
      padding: 20px; text-align: center; font: 600 14px/1.4 sans-serif; color: ${palette.danger700};
      background: ${palette.danger50};
    }
  </style>
</head>
<body>
  <div class="hint">${s.hint.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</div>
  <div id="map"></div>
  <script>
    const API_KEY = ${keyJson};
    const startLat = ${lat};
    const startLng = ${lng};
    const hasPin = ${hasPin ? "true" : "false"};

    function post(obj) {
      const payload = JSON.stringify(obj);
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(payload);
      } else if (window.parent && window.parent !== window) {
        window.parent.postMessage(payload, '*');
      }
    }

    function showErr(msg) {
      var el = document.createElement('div');
      el.className = 'err';
      el.textContent = msg;
      document.body.appendChild(el);
    }

    // Google apelează window.initMap la încărcarea bootstrap-ului (callback=initMap).
    // gm_authFailure = cheie invalidă / restricții / billing — atunci Google
    // desenează singur overlay-ul "Hopa! A apărut o eroare", detaliile fiind
    // doar în consola JS. Îl interceptăm ca să arătăm cauza probabilă.
    (window as any).initMap = initMap;
    (window as any).gm_authFailure = function () {
      showErr(${authFailureJson});
      post({ type: 'authFailure' });
    };
    window.addEventListener('error', function (e) {
      if (e && e.message && e.message.indexOf('initMap is not a function') !== -1) {
        showErr(${loadErrorJson});
      }
    });

    function initMap() {
      var map = new google.maps.Map(document.getElementById('map'), {
        center: { lat: startLat, lng: startLng },
        zoom: hasPin ? 16 : 7,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
      });
      var marker = null;
      function setPin(lat, lng, announce) {
        var pos = { lat: lat, lng: lng };
        if (marker) marker.setPosition(pos);
        else {
          // google.maps.Marker e clasic (legacy) dar încă suportat când se cere
          // explicit librăria "marker" în bootstrap. Alternativa nouă ar fi
          // google.maps.marker.AdvancedMarkerElement (necesită mapId).
          marker = new google.maps.Marker({ position: pos, map: map, draggable: true, title: ${markerTitleJson} });
          marker.addListener('dragend', function () {
            var p = marker.getPosition();
            post({ type: 'pin', latitude: p.lat(), longitude: p.lng() });
          });
          marker.addListener('click', function () { post({ type: 'markerPress' }); });
        }
        map.panTo(pos);
        if (announce) post({ type: 'pin', latitude: lat, longitude: lng });
      }
      if (hasPin) setPin(startLat, startLng, false);
      map.addListener('click', function (e) {
        setPin(e.latLng.lat(), e.latLng.lng(), true);
      });
    }

    if (!API_KEY) {
      showErr(${noKeyJson});
    } else {
      // Bootstrap modern Google Maps JS: callback + loading=async + v=weekly.
      // Fără callback, eșecul de autentificare lasă doar overlay-ul generic
      // "Hopa! A apărut o eroare" cu detalii doar în consola JS.
      var s = document.createElement('script');
      s.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(API_KEY)
        + '&callback=initMap&loading=async&v=weekly&libraries=marker';
      s.async = true;
      s.defer = true;
      s.onerror = function () { showErr(${loadErrorJson}); };
      document.head.appendChild(s);
    }
  </script>
</body>
</html>`;
}

function parseMsg(raw: string): { type: string; latitude?: number; longitude?: number } | null {
  try {
    return JSON.parse(raw) as { type: string; latitude?: number; longitude?: number };
  } catch {
    return null;
  }
}

function handlePinMessage(
  raw: string,
  onPick: Props['onPick'],
  onMarkerPress?: Props['onMarkerPress']
) {
  const data = parseMsg(raw);
  if (!data) return;
  if (
    data.type === 'pin' &&
    typeof data.latitude === 'number' &&
    typeof data.longitude === 'number'
  ) {
    onPick({ latitude: data.latitude, longitude: data.longitude });
  }
  if (data.type === 'markerPress') onMarkerPress?.();
}

/** Google Maps JS — iframe pe web, WebView pe native (Expo Go / fallback APK). */
function WebGoogleMap({
  latitude,
  longitude,
  onPick,
  onMarkerPress,
  height = 280,
}: Props) {
  const apiKey = getMapsApiKey();
  const hasPin =
    latitude != null &&
    longitude != null &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude);
  const lat = hasPin ? (latitude as number) : 44.4268;
  const lng = hasPin ? (longitude as number) : 26.1025;
  const { lang } = useLanguage();
  const html = useMemo(
    () => buildGoogleHtml(lat, lng, hasPin, apiKey),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [apiKey, hasPin, Number(lat.toFixed(5)), Number(lng.toFixed(5)), lang]
  );

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    function onWindowMessage(event: MessageEvent) {
      if (typeof event.data !== 'string') return;
      handlePinMessage(event.data, onPick, onMarkerPress);
    }
    window.addEventListener('message', onWindowMessage);
    return () => window.removeEventListener('message', onWindowMessage);
  }, [onPick, onMarkerPress]);

  if (Platform.OS === 'web') {
    return (
      <View style={[styles.wrap, { height }]}>
        <iframe
          title={trKey('map.googleIframe')}
          srcDoc={html}
          style={{ border: 'none', width: '100%', height: '100%' }}
          allow="geolocation"
        />
      </View>
    );
  }

  return (
    <View style={[styles.wrap, { height }]}>
      <WebView
        originWhitelist={['*']}
        source={{ html }}
        onMessage={(e: WebViewMessageEvent) =>
          handlePinMessage(e.nativeEvent.data, onPick, onMarkerPress)
        }
        javaScriptEnabled
        domStorageEnabled
        mixedContentMode="always"
        setSupportMultipleWindows={false}
        style={styles.map}
      />
    </View>
  );
}

function NativeGoogleMap({
  latitude,
  longitude,
  title,
  onPick,
  onMarkerPress,
  height = 280,
}: Props) {
  const mapRef = useRef<MapView>(null);
  const hasPin =
    latitude != null &&
    longitude != null &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude);

  const initialRegion: Region = {
    latitude: hasPin ? (latitude as number) : 44.4268,
    longitude: hasPin ? (longitude as number) : 26.1025,
    latitudeDelta: hasPin ? 0.01 : 0.35,
    longitudeDelta: hasPin ? 0.01 : 0.35,
  };

  useEffect(() => {
    if (!hasPin || !mapRef.current) return;
    mapRef.current.animateToRegion(
      {
        latitude: latitude as number,
        longitude: longitude as number,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      },
      350
    );
  }, [hasPin, latitude, longitude]);

  return (
    <View style={[styles.wrap, { height }]}>
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
        initialRegion={initialRegion}
        onPress={(e) => {
          const c = e.nativeEvent.coordinate;
          onPick({ latitude: c.latitude, longitude: c.longitude });
        }}
        showsUserLocation={false}
        showsMyLocationButton={false}
        moveOnMarkerPress={false}
      >
        {hasPin ? (
          <Marker
            coordinate={{
              latitude: latitude as number,
              longitude: longitude as number,
            }}
            draggable
            title={title ?? trKey('map.yourBusiness')}
            description={trKey('map.markerHint')}
            onPress={() => onMarkerPress?.()}
            onCalloutPress={() => onMarkerPress?.()}
            onDragEnd={(e) => {
              const c = e.nativeEvent.coordinate;
              onPick({ latitude: c.latitude, longitude: c.longitude });
            }}
          />
        ) : null}
      </MapView>
    </View>
  );
}

/**
 * Dacă harta nativă crapă (ex. modulul react-native-maps lipsește din Expo Go
 * sau cheia Google nu e validă pe device), nu închidem ecranul: cădem pe
 * harta OpenStreetMap din WebView, care nu are nevoie de modul nativ.
 */
class NativeMapGuard extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: unknown): void {
    if (__DEV__) console.warn('Harta nativă indisponibilă, folosesc Google Maps JS.', error);
  }

  render(): ReactNode {
    if (this.state.failed) return this.props.fallback;
    return this.props.children;
  }
}

/** true în Expo Go — MapView nativ Google rămâne gol fără rebuild. */
function useExpoGo(): boolean {
  return Constants.appOwnership === 'expo';
}

/**
 * Hartă Google Maps în app.
 * - Web / Expo Go: Google Maps JavaScript API (WebView/iframe) — are nevoie de cheie cu Maps JS API.
 * - Dev client / APK: react-native-maps + PROVIDER_GOOGLE — are nevoie de cheie în app.json + rebuild.
 * Fără cheie: mesaj de generare (nu forțăm OSM dacă userul vrea Google).
 */
export function GoogleMapPicker(props: Props) {
  const { latitude, longitude, onPick, height = 280 } = props;
  const { lang } = useLanguage();
  const key = getMapsApiKey();

  if (!key) {
    const s = GOOGLE_HTML_STRINGS[lang];
    return (
      <View style={[styles.wrap, { height: height ?? 280, padding: 14, justifyContent: 'center' }]}>
        <Text style={styles.missingTitle}>{s.missingTitle}</Text>
        <Text style={styles.fallbackHint}>{s.guide}</Text>
      </View>
    );
  }

  // Web: mereu Google JS API
  if (Platform.OS === 'web') {
    return <WebGoogleMap {...props} />;
  }

  // Expo Go: cheia din app.json nu se aplică la MapView nativ → Google JS în WebView
  if (useExpoGo()) {
    return <WebGoogleMap {...props} />;
  }

  // APK / dev client: hartă nativă Google; dacă crapă, tot Google JS (nu OSM)
  return (
    <NativeMapGuard
      fallback={
        <View style={{ gap: 6 }}>
          <WebGoogleMap {...props} />
          <Text style={styles.fallbackHint}>
            {GOOGLE_HTML_STRINGS[getLanguageSync()].fallbackHint}
          </Text>
        </View>
      }
    >
      <NativeGoogleMap {...props} />
    </NativeMapGuard>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: radius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: palette.ink300,
    backgroundColor: palette.ink200,
  },
  map: { flex: 1 },
  missingTitle: { fontSize: 15, fontWeight: '800', color: palette.ink950, marginBottom: 8 },
  fallbackHint: { fontSize: 12, lineHeight: 17, color: palette.ink500 },
});
