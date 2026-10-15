import { createElement, useMemo } from 'react';

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

/** Web: aceeasi harta Leaflet intr-un iframe; click pe pin deschide pagina publica. */
export function BusinessMap({ points, center, height = 260 }: Props) {
  const html = useMemo(() => {
    const markers = points
      .map(
        (p) =>
          `L.marker([${p.latitude},${p.longitude}]).addTo(map).bindPopup('<a href="/b/${p.publicCode}">${esc(p.name)}</a>');`
      )
      .join('\n');
    const c = center ?? points[0] ?? { latitude: 45.94, longitude: 25.0 };
    const fit =
      points.length > 1
        ? `map.fitBounds(L.latLngBounds([${points.map((p) => `[${p.latitude},${p.longitude}]`).join(',')}]));`
        : `map.setView([${c.latitude},${c.longitude}],13);`;
    const me = center
      ? `L.circleMarker([${center.latitude},${center.longitude}],{radius:7,color:'#2563eb'}).addTo(map);`
      : '';
    return `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>html,body,#map{height:100%;margin:0}</style></head><body><div id="map"></div>
<script>
var map=L.map('map'); L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(map);
${me}
${markers}
${fit}
</script></body></html>`;
  }, [points, center]);

  if (points.length === 0) return createElement('div', { style: { height } });

  return createElement('iframe', {
    srcDoc: html,
    title: 'map',
    style: { width: '100%', height, border: 0, borderRadius: 16 },
  });
}
