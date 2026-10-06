import { Linking, Platform, Share } from 'react-native';

import type { BusinessProfile } from '@/lib/types';

export type BusinessLocation = {
  county: string | null;
  city: string | null;
  address: string | null;
  mapsUrl: string | null;
  latitude: number | null;
  longitude: number | null;
};

/**
 * Adresa completă, o singură linie: „Strada Memorandumului 12, Cluj-Napoca, Jud. Cluj”.
 * Ordinea e cea care se citește natural pe hartă; județul vine ultimul.
 */
export function formatAddress(location: BusinessLocation): string | null {
  const county = location.county?.trim() ?? '';
  const parts = [
    location.address?.trim(),
    location.city?.trim(),
    county ? `Jud. ${county}` : '',
  ].filter((p): p is string => Boolean(p && p.length > 0));
  if (parts.length === 0) return null;
  return parts.join(', ');
}

/**
 * Link către hartă. Ordinea preferințelor:
 * 1. `maps_url` completat manual de business (poate fi orice link: Google, Waze, site propriu)
 * 2. coordonate GPS (cele mai precise)
 * 3. adresa căutată pe Google Maps
 */
export function buildMapsUrl(location: BusinessLocation): string | null {
  const manual = location.mapsUrl?.trim();
  if (manual) {
    if (/^https?:\/\//i.test(manual)) return manual;
    return `https://${manual}`;
  }

  const { latitude, longitude } = location;
  if (
    typeof latitude === 'number' &&
    typeof longitude === 'number' &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude)
  ) {
    return `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
  }

  const address = formatAddress(location);
  if (address) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
  }

  return null;
}

export function hasLocation(location: BusinessLocation): boolean {
  return Boolean(formatAddress(location) || buildMapsUrl(location));
}

/** Coordonate GPS valide — necesare pentru „Condu acum”. */
export function hasCoordinates(location: BusinessLocation): boolean {
  const { latitude, longitude } = location;
  return (
    typeof latitude === 'number' &&
    typeof longitude === 'number' &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude)
  );
}

export function locationFromBusiness(biz: BusinessProfile): BusinessLocation {
  return {
    county: biz.county ?? null,
    city: biz.city ?? null,
    address: biz.address ?? null,
    mapsUrl: biz.maps_url ?? null,
    latitude: typeof biz.latitude === 'number' ? biz.latitude : null,
    longitude: typeof biz.longitude === 'number' ? biz.longitude : null,
  };
}

/**
 * Link HTTPS pentru navigare (indicații de condus) de la poziția curentă până la business.
 * Doar când există coordonate GPS.
 */
export function buildDriveUrl(location: BusinessLocation): string | null {
  if (!hasCoordinates(location)) return null;
  const { latitude, longitude } = location;
  return (
    `https://www.google.com/maps/dir/?api=1` +
    `&destination=${latitude},${longitude}` +
    `&travelmode=driving`
  );
}

/**
 * Link nativ pentru turn-by-turn: Google Navigation pe Android, Apple Maps pe iOS.
 * Doar când există coordonate GPS.
 */
export function buildNativeDriveUrl(location: BusinessLocation): string | null {
  if (!hasCoordinates(location)) return null;
  const { latitude, longitude } = location;
  if (Platform.OS === 'android') {
    return `google.navigation:q=${latitude},${longitude}`;
  }
  if (Platform.OS === 'ios') {
    return `http://maps.apple.com/?daddr=${latitude},${longitude}&dirflg=d`;
  }
  return null;
}

/**
 * Link care deschide aplicația de hărți instalată pe telefon: chooser-ul Android
 * (Google Maps, Waze, orice altă aplicație) sau Apple Maps pe iOS.
 * Se folosește doar când business-ul nu are link manual — altfel respectăm link-ul lui.
 */
export function buildNativeMapsUrl(location: BusinessLocation): string | null {
  if (location.mapsUrl?.trim()) return null;
  if (!hasCoordinates(location)) return null;

  const { latitude, longitude } = location;
  const label = encodeURIComponent(formatAddress(location) ?? `${latitude},${longitude}`);
  if (Platform.OS === 'android') {
    return `geo:${latitude},${longitude}?q=${latitude},${longitude}(${label})`;
  }
  if (Platform.OS === 'ios') {
    return `http://maps.apple.com/?ll=${latitude},${longitude}&q=${label}`;
  }
  return null;
}

/** Apple Maps directions URL (iOS share / web fallback). */
export function buildAppleMapsUrl(location: BusinessLocation): string | null {
  if (!hasCoordinates(location)) return null;
  const { latitude, longitude } = location;
  return `http://maps.apple.com/?daddr=${latitude},${longitude}&dirflg=d`;
}

/**
 * Intent `geo:` pe Android — sistemul afișează chooser-ul cu aplicațiile de navigație instalate
 * (Maps, Waze, etc.), nu o listă custom din app.
 */
function buildAndroidGeoDriveUrl(location: BusinessLocation): string | null {
  if (!hasCoordinates(location)) return null;
  const { latitude, longitude } = location;
  const label = encodeURIComponent(formatAddress(location) ?? `${latitude},${longitude}`);
  return `geo:${latitude},${longitude}?q=${latitude},${longitude}(${label})`;
}

/** HTTPS directions — fallback Android / web când geo: nu e disponibil. */
function buildHttpsDriveUrl(location: BusinessLocation): string | null {
  return (
    buildDriveUrl(location) ??
    (hasCoordinates(location)
      ? `https://maps.google.com/maps?daddr=${location.latitude},${location.longitude}`
      : buildMapsUrl(location))
  );
}

/** Deschide navigarea prin meniul nativ al telefonului (nu banner custom Waze/Google). */
export async function openDrive(location: BusinessLocation): Promise<boolean> {
  return openDriveChooser(location);
}

/**
 * „Condu acum”: meniul nativ al OS-ului (share / intent maps), nu listă custom Waze+Google.
 * - iOS: Share.share cu URL Apple Maps directions → sheet-ul de sistem (Open in / apps).
 * - Android: Linking.openURL(geo:…) → app chooser; fallback Share / HTTPS.
 * - Web: navigator.share dacă există, altfel tab nou cu Google Maps.
 */
export async function openDriveChooser(location: BusinessLocation): Promise<boolean> {
  if (!hasLocation(location)) return false;

  const addressLabel = formatAddress(location) ?? 'Navighează către business';
  const httpsUrl = buildHttpsDriveUrl(location);
  const appleUrl = buildAppleMapsUrl(location);
  const geoUrl = buildAndroidGeoDriveUrl(location);

  if (Platform.OS === 'ios') {
    const shareUrl = appleUrl ?? httpsUrl;
    if (!shareUrl) return false;
    try {
      await Share.share({
        url: shareUrl,
        message: addressLabel,
      });
      return true;
    } catch {
      return openMaps(httpsUrl, appleUrl);
    }
  }

  if (Platform.OS === 'android') {
    if (geoUrl) {
      try {
        await Linking.openURL(geoUrl);
        return true;
      } catch {
        // Continuă cu Share / HTTPS.
      }
    }
    if (httpsUrl) {
      try {
        await Share.share({
          message: `${addressLabel}\n${httpsUrl}`,
          title: 'Condu acum',
        });
        return true;
      } catch {
        return openMaps(httpsUrl);
      }
    }
    return false;
  }

  // Web: share nativ dacă e disponibil, altfel tab nou — fără banner fake cu 2 app-uri.
  const webNav = typeof navigator !== 'undefined' ? (navigator as Navigator & {
    share?: (data: { title?: string; text?: string; url?: string }) => Promise<void>;
  }) : null;
  if (webNav?.share && httpsUrl) {
    try {
      await webNav.share({
        title: 'Condu acum',
        text: addressLabel,
        url: httpsUrl,
      });
      return true;
    } catch {
      // Anulat de utilizator sau unsupported — deschidem tab.
    }
  }
  return openMaps(httpsUrl ?? appleUrl);
}

/**
 * Deschide harta: pe telefon încearcă întâi aplicația de hărți instalată, apoi link-ul web.
 * Nu filtrăm cu `canOpenURL` — pe Android 11+ aceasta întoarce false pentru link-uri https
 * dacă manifestul nu declară `<queries>`, deși link-ul se deschide corect.
 */
export async function openMaps(
  webUrl: string | null | undefined,
  nativeUrl?: string | null
): Promise<boolean> {
  if (Platform.OS === 'web') {
    if (!webUrl || typeof window === 'undefined') return false;
    window.open(webUrl, '_blank', 'noopener,noreferrer');
    return true;
  }

  const targets = [nativeUrl, webUrl].filter((u): u is string => Boolean(u));
  for (const target of targets) {
    try {
      await Linking.openURL(target);
      return true;
    } catch {
      // `geo:` fără handler pe dispozitiv — trecem la link-ul https.
    }
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Locația curentă (stil WhatsApp „share location”)                    */
/* ------------------------------------------------------------------ */

export type RezultatLocatie = {
  latitude: number;
  longitude: number;
  /** Adresa completă gata de afișat, ex. „Strada Franceză 12, Sector 3, Bucureşti”. */
  adresa: string;
  /** Doar partea de stradă + număr, pentru câmpul „Stradă”. */
  strada: string;
  /** Numele localității, dacă serviciul de geocodare l-a putut determina. */
  localitate: string;
  /** Numele județului, dacă serviciul de geocodare l-a putut determina. */
  judet: string;
};

type NominatimAddress = Record<string, string | undefined>;

function curataStrada(addr: NominatimAddress): string {
  const road = addr.road ?? addr.pedestrian ?? addr.footway ?? addr.path ?? '';
  const numar = addr.house_number ?? '';
  return [road, numar].filter(Boolean).join(' ').trim();
}

/**
 * Rezolvă coordonatele într-o adresă românească, prin Nominatim (OpenStreetMap).
 * Serviciul e gratuit și fără cheie, dar cere un User-Agent descriptiv și cel mult
 * o cerere pe secundă. Dacă răspunsul nu e OK, întoarce null și rămân doar coordonatele.
 */
export async function reverseGeocodeRo(
  latitude: number,
  longitude: number
): Promise<RezultatLocatie | null> {
  try {
    const url =
      'https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1' +
      `&accept-language=ro&lat=${latitude}&lon=${longitude}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;

    const json = (await res.json()) as { address?: NominatimAddress; display_name?: string };
    const addr = json.address ?? {};
    const judet = addr.county ?? '';
    const localitate =
      addr.city ?? addr.town ?? addr.village ?? addr.municipality ?? addr.suburb ?? '';
    const strada = curataStrada(addr);

    const adresa =
      [strada, localitate, judet].filter(Boolean).join(', ') ||
      (json.display_name ?? '').split(',').slice(0, 3).join(',').trim();

    return { latitude, longitude, adresa, strada, localitate, judet };
  } catch {
    return null;
  }
}