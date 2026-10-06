import { useEffect, useMemo, useRef } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { radius } from '@/constants/theme';

type Props = {
  latitude: number | null;
  longitude: number | null;
  onPick: (coords: { latitude: number; longitude: number }) => void;
  height?: number;
};

function buildHtml(lat: number, lng: number, hasPin: boolean): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <style>
    html, body, #map { height: 100%; margin: 0; padding: 0; background: #e8f5f3; }
    .hint {
      position: absolute; z-index: 1000; left: 10px; right: 10px; top: 10px;
      background: rgba(255,255,255,0.95); border-radius: 10px; padding: 8px 10px;
      font: 600 13px/1.35 -apple-system, BlinkMacSystemFont, sans-serif; color: #0f172a;
      box-shadow: 0 2px 8px rgba(15,23,42,0.12);
    }
  </style>
</head>
<body>
  <div class="hint">Apasă pe hartă ca să pui pinul. Trage pinul ca să-l muți. Se salvează în app, nu pe Google Maps.</div>
  <div id="map"></div>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    const startLat = ${lat};
    const startLng = ${lng};
    const hasPin = ${hasPin ? 'true' : 'false'};
    const map = L.map('map', { zoomControl: true }).setView([startLat, startLng], hasPin ? 16 : 7);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap'
    }).addTo(map);

    let marker = null;
    function send(lat, lng) {
      const payload = JSON.stringify({ type: 'pin', latitude: lat, longitude: lng });
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(payload);
      } else if (window.parent && window.parent !== window) {
        window.parent.postMessage(payload, '*');
      }
    }
    function setPin(lat, lng, announce) {
      if (marker) marker.setLatLng([lat, lng]);
      else {
        marker = L.marker([lat, lng], { draggable: true }).addTo(map);
        marker.on('dragend', function () {
          const p = marker.getLatLng();
          send(p.lat, p.lng);
        });
      }
      if (announce) send(lat, lng);
    }
    if (hasPin) setPin(startLat, startLng, false);
    map.on('click', function (e) {
      setPin(e.latlng.lat, e.latlng.lng, true);
    });
    setTimeout(function () { map.invalidateSize(); }, 250);
  </script>
</body>
</html>`;
}

function parsePinMessage(raw: string): { latitude: number; longitude: number } | null {
  try {
    const data = JSON.parse(raw) as {
      type?: string;
      latitude?: number;
      longitude?: number;
    };
    if (
      data?.type === 'pin' &&
      typeof data.latitude === 'number' &&
      typeof data.longitude === 'number'
    ) {
      return { latitude: data.latitude, longitude: data.longitude };
    }
  } catch {
    /* ignore */
  }
  return null;
}

function WebOsmMap({ latitude, longitude, onPick, height }: Props) {
  const hasPin =
    latitude != null &&
    longitude != null &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude);
  const lat = hasPin ? latitude! : 44.4268;
  const lng = hasPin ? longitude! : 26.1025;
  const html = useMemo(
    () => buildHtml(lat, lng, hasPin),
    [hasPin, Number(lat.toFixed(5)), Number(lng.toFixed(5))]
  );

  useEffect(() => {
    function onWindowMessage(event: MessageEvent) {
      if (typeof event.data !== 'string') return;
      const pin = parsePinMessage(event.data);
      if (pin) onPick(pin);
    }
    window.addEventListener('message', onWindowMessage);
    return () => window.removeEventListener('message', onWindowMessage);
  }, [onPick]);

  return (
    <View style={[styles.wrap, { height }]}>
      {/* eslint-disable-next-line react/no-danger */}
      <iframe
        title="Hartă locație business"
        srcDoc={html}
        style={{ border: 'none', width: '100%', height: '100%' }}
      />
    </View>
  );
}

/**
 * Hartă OpenStreetMap pe care poți pune pinul.
 * Coordonatele se salvează pe business în app (nu ca pin public pe Google Maps).
 */
export function OsmMapPicker(props: Props) {
  if (Platform.OS === 'web') {
    return <WebOsmMap {...props} />;
  }

  const { latitude, longitude, onPick, height = 260 } = props;
  const webRef = useRef<WebView>(null);
  const hasPin =
    latitude != null &&
    longitude != null &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude);
  const lat = hasPin ? latitude! : 44.4268;
  const lng = hasPin ? longitude! : 26.1025;
  const html = useMemo(
    () => buildHtml(lat, lng, hasPin),
    [hasPin, Number(lat.toFixed(5)), Number(lng.toFixed(5))]
  );

  function onMessage(event: WebViewMessageEvent) {
    const pin = parsePinMessage(event.nativeEvent.data);
    if (pin) onPick(pin);
  }

  return (
    <View style={[styles.wrap, { height: height ?? 260 }]}>
      <WebView
        ref={webRef}
        originWhitelist={['*']}
        source={{ html }}
        onMessage={onMessage}
        javaScriptEnabled
        domStorageEnabled
        mixedContentMode="always"
        setSupportMultipleWindows={false}
        style={styles.web}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: radius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  web: { flex: 1, backgroundColor: '#e8f5f3' },
});
