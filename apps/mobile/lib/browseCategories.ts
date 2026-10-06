import type { ImageSourcePropType } from 'react-native';

/**
 * Client browse ("Caută") — 14 business/service categories.
 * Preferă `business_profiles.category` (= key). Fallback: searchTerms pe nume/cod.
 */
export type BrowseCategory = {
  key: string;
  label: string;
  /** Terms matched against business name / public_code (RO) when category e null. */
  searchTerms: string[];
  image: ImageSourcePropType;
};

export const BROWSE_CATEGORIES: BrowseCategory[] = [
  {
    key: 'coafura',
    label: 'Coafură',
    searchTerms: ['coafur', 'hairstyl', 'salon', 'par', 'hair'],
    image: require('../assets/images/categories/coafura.jpg'),
  },
  {
    key: 'frizerie',
    label: 'Frizerie',
    searchTerms: ['frizer', 'barber', 'barbier'],
    image: require('../assets/images/categories/frizerie.jpg'),
  },
  {
    key: 'cosmetica',
    label: 'Cosmetică',
    searchTerms: ['cosmetic', 'skin', 'facial', 'ten'],
    image: require('../assets/images/categories/cosmetica.jpg'),
  },
  {
    key: 'makeup',
    label: 'Makeup',
    searchTerms: ['makeup', 'make-up', 'machiaj'],
    image: require('../assets/images/categories/makeup.jpg'),
  },
  {
    key: 'epilare',
    label: 'Epilare definitivă',
    searchTerms: ['epilar', 'laser', 'ipl'],
    image: require('../assets/images/categories/epilare.jpg'),
  },
  {
    key: 'sprancene',
    label: 'Îngrijire sprâncene',
    searchTerms: ['sprancen', 'brows', 'henna', 'microblad'],
    image: require('../assets/images/categories/sprancene.jpg'),
  },
  {
    key: 'unghii',
    label: 'Unghii cu gel',
    searchTerms: ['unghii', 'manichiur', 'gel', 'nail'],
    image: require('../assets/images/categories/unghii.jpg'),
  },
  {
    key: 'medical',
    label: 'Cabinete medicale',
    searchTerms: ['medical', 'medic', 'clinic', 'cabinet medical', 'doctor'],
    image: require('../assets/images/categories/medical.jpg'),
  },
  {
    key: 'stomatologie',
    label: 'Cabinete stomatologice',
    searchTerms: ['stomatolog', 'dentar', 'dentist', 'oral'],
    image: require('../assets/images/categories/stoma.jpg'),
  },
  {
    key: 'masaj',
    label: 'Masaj / spa',
    searchTerms: ['masaj', 'spa', 'relaxare', 'wellness'],
    image: require('../assets/images/categories/masaj.jpg'),
  },
  {
    key: 'fitness',
    label: 'Fitness',
    searchTerms: ['fitness', 'antrenament', 'personal training', 'gym', 'sala'],
    image: require('../assets/images/categories/fitness.jpg'),
  },
  {
    key: 'psihologie',
    label: 'Psihologie / terapie',
    searchTerms: ['psiholog', 'terapie', 'terapeut', 'counsel'],
    image: require('../assets/images/categories/psihologie.jpg'),
  },
  {
    key: 'veterinar',
    label: 'Veterinar',
    searchTerms: ['veterinar', 'vet ', 'pet', 'animale'],
    image: require('../assets/images/categories/veterinar.jpg'),
  },
  {
    key: 'auto',
    label: 'Auto service',
    searchTerms: ['auto', 'detailing', 'spalatorie', 'service auto', 'vulcanizare'],
    image: require('../assets/images/categories/auto.jpg'),
  },
];

export const BROWSE_CATEGORY_LABELS: string[] = BROWSE_CATEGORIES.map((c) => c.label);

export function categoryLabelForKey(key: string | null | undefined): string {
  if (!key) return '';
  return BROWSE_CATEGORIES.find((c) => c.key === key)?.label ?? '';
}

export function categoryKeyForLabel(label: string): string | null {
  const hit = BROWSE_CATEGORIES.find((c) => c.label === label);
  return hit?.key ?? null;
}

export function matchesBrowseCategory(
  name: string,
  publicCode: string,
  cat: BrowseCategory
): boolean {
  const hay = `${name} ${publicCode}`.toLowerCase();
  return cat.searchTerms.some((t) => hay.includes(t.toLowerCase()));
}

/** Potrivire: category DB exactă, sau fallback pe nume/cod dacă category lipsește. */
export function businessMatchesCategory(
  biz: { name: string; public_code: string; category?: string | null },
  cat: BrowseCategory
): boolean {
  const key = biz.category?.trim();
  if (key) return key === cat.key;
  return matchesBrowseCategory(biz.name, biz.public_code, cat);
}
