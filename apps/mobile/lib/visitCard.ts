import type { BusinessVisitCardProps } from '../components/BusinessVisitCard';
import { DEFAULT_WORKING_HOURS } from './defaults';
import type { BusinessProfile, WorkingHours } from './types';

/** Rând minim necesar din business_profiles pentru cartea de vizită de pe hartă. */
export type BusinessCardRow = Pick<
  BusinessProfile,
  | 'name'
  | 'public_code'
  | 'working_hours'
  | 'county'
  | 'city'
  | 'address'
  | 'maps_url'
  | 'latitude'
  | 'longitude'
>;

/** Pin de hartă (punct verde) → carte de vizită + QR. Pur — testabil în node. */
export function businessToVisitCardProps(
  row: BusinessCardRow,
  ownerPhone: string | null
): BusinessVisitCardProps {
  const wh: WorkingHours =
    row.working_hours && typeof row.working_hours === 'object'
      ? row.working_hours
      : DEFAULT_WORKING_HOURS;
  return {
    name: row.name ?? '',
    phone: ownerPhone,
    workingHours: wh,
    location: {
      county: row.county ?? null,
      city: row.city ?? null,
      address: row.address ?? null,
      mapsUrl: row.maps_url ?? null,
      latitude: typeof row.latitude === 'number' ? row.latitude : null,
      longitude: typeof row.longitude === 'number' ? row.longitude : null,
    },
    publicCode: row.public_code ?? null,
  };
}

/** „Oraș, Județ” pentru cartea publică — fără stradă. Null când lipsesc ambele. */
export function formatPublicLocation(
  city: string | null | undefined,
  county: string | null | undefined
): string | null {
  const parts = [city?.trim(), county?.trim()].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : null;
}

/** externalId de tip `biz-<id>` → id-ul business-ului, altfel null. */
export function businessIdFromExternalId(externalId: string | null | undefined): string | null {
  if (!externalId || !externalId.startsWith('biz-') || externalId.length <= 4) return null;
  return externalId.slice(4);
}
