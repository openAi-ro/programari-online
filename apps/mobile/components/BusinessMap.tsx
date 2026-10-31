import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { palette } from '@/constants/theme';

export type BusinessMapPoint = {
  publicCode: string;
  name: string;
  latitude: number;
  longitude: number;
};

type Props = {
  points: BusinessMapPoint[];
  center: { latitude: number; longitude: number } | null;
  onSelect: (publicCode: string) => void;
  height?: number;
};

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

/** Harta Leaflet (WebView) cu pini pentru business-uri; tap pe pin -> onSelect. */
export function BusinessMap({ points, center, onSelect, height = 260 }: Props) {
  const html = useMemo(() => {
    const markers = points
      .map(
        (p) =>
          `L.marker([${p.latitude},${p.longitude}]).addTo(map).bindPopup("${esc(p.name)}").on('click',function(){send('${p.publicCode}')});`
      )
      .join('\n');
    const c = center ?? points[0] ?? { latitude: 45.94, longitude: 25.0 };
    const fit =
      points.length > 1
        ? `map.fitBounds(L.latLngBounds([${points.map((p) => `[${p.latitude},${p.longitude}]`).join(',')}]));`
        : `map.setView([${c.latitude},${c.longitude}],13);`;
    const me = center
      ? `L.circleMarker([${center.latitude},${center.longitude}],{radius:7,color:'${palette.accent700}'}).addTo(map);`
      : '';
    return `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>html,body,#map{height:100%;margin:0}</style></head><body><div id="map"></div>
<script>
function send(code){ if(window.ReactNativeWebView) window.ReactNativeWebView.postMessage(code); }
var map=L.map('map'); L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(map);
${me}
${markers}
${fit}
</script></body></html>`;
  }, [points, center]);

  function onMessage(e: WebViewMessageEvent) {
    const code = (e.nativeEvent.data ?? '').trim();
    if (code) onSelect(code);
  }

  if (points.length === 0) return <View style={{ height }} />;

  return (
    <View style={[styles.wrap, { height }]}>
      <WebView source={{ html }} onMessage={onMessage} style={styles.web} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: 16, overflow: 'hidden' },
  web: { flex: 1 },
});
