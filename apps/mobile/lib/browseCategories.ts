import type { ImageSourcePropType } from 'react-native';

import { translateTo, trKey, type TrKey } from './i18n';
import type { AppLanguage } from './language';
import { GENERAL_CATEGORY_KEY } from './specialization';

/**
 * Client browse ("Caută") — 15 business/service categories (ultima: `general`,
 * unde business-ul își scrie singur specializarea).
 * Preferă `business_profiles.category` (= key). Fallback: searchTerms pe nume/cod.
 */
export type BrowseCategory = {
  key: string;
  label: string;
  labelKey: TrKey;
  /** Terms matched against business name / public_code (RO) when category e null. */
  searchTerms: string[];
  image: ImageSourcePropType;
};

export const BROWSE_CATEGORIES: BrowseCategory[] = [
  {
    key: 'coafura',
    label: 'Coafură',
    labelKey: 'cat.coafura',
    searchTerms: ['coafur', 'hairstyl', 'salon', 'par', 'hair'],
    image: require('../assets/images/categories/coafura.jpg'),
  },
  {
    key: 'frizerie',
    label: 'Frizerie',
    labelKey: 'cat.frizerie',
    searchTerms: ['frizer', 'barber', 'barbier'],
    image: require('../assets/images/categories/frizerie.jpg'),
  },
  {
    key: 'cosmetica',
    label: 'Cosmetică',
    labelKey: 'cat.cosmetica',
    searchTerms: ['cosmetic', 'skin', 'facial', 'ten'],
    image: require('../assets/images/categories/cosmetica.jpg'),
  },
  {
    key: 'makeup',
    label: 'Makeup',
    labelKey: 'cat.makeup',
    searchTerms: ['makeup', 'make-up', 'machiaj'],
    image: require('../assets/images/categories/makeup.jpg'),
  },
  {
    key: 'epilare',
    label: 'Epilare definitivă',
    labelKey: 'cat.epilare',
    searchTerms: ['epilar', 'laser', 'ipl'],
    image: require('../assets/images/categories/epilare.jpg'),
  },
  {
    key: 'sprancene',
    label: 'Îngrijire sprâncene',
    labelKey: 'cat.sprancene',
    searchTerms: ['sprancen', 'brows', 'henna', 'microblad'],
    image: require('../assets/images/categories/sprancene.jpg'),
  },
  {
    key: 'unghii',
    label: 'Unghii cu gel',
    labelKey: 'cat.unghii',
    searchTerms: ['unghii', 'manichiur', 'gel', 'nail'],
    image: require('../assets/images/categories/unghii.jpg'),
  },
  {
    key: 'medical',
    label: 'Cabinete medicale',
    labelKey: 'cat.medical',
    searchTerms: ['medical', 'medic', 'clinic', 'cabinet medical', 'doctor'],
    image: require('../assets/images/categories/medical.jpg'),
  },
  {
    key: 'stomatologie',
    label: 'Cabinete stomatologice',
    labelKey: 'cat.stomatologie',
    searchTerms: ['stomatolog', 'dentar', 'dentist', 'oral'],
    image: require('../assets/images/categories/stoma.jpg'),
  },
  {
    key: 'masaj',
    label: 'Masaj / spa',
    labelKey: 'cat.masaj',
    searchTerms: ['masaj', 'spa', 'relaxare', 'wellness'],
    image: require('../assets/images/categories/masaj.jpg'),
  },
  {
    key: 'fitness',
    label: 'Fitness',
    labelKey: 'cat.fitness',
    searchTerms: ['fitness', 'antrenament', 'personal training', 'gym', 'sala'],
    image: require('../assets/images/categories/fitness.jpg'),
  },
  {
    key: 'psihologie',
    label: 'Psihologie / terapie',
    labelKey: 'cat.psihologie',
    searchTerms: ['psiholog', 'terapie', 'terapeut', 'counsel'],
    image: require('../assets/images/categories/psihologie.jpg'),
  },
  {
    key: 'veterinar',
    label: 'Veterinar',
    labelKey: 'cat.veterinar',
    searchTerms: ['veterinar', 'vet ', 'pet', 'animale'],
    image: require('../assets/images/categories/veterinar.jpg'),
  },
  {
    key: 'auto',
    label: 'Auto service',
    labelKey: 'cat.auto',
    searchTerms: ['auto', 'detailing', 'spalatorie', 'service auto', 'vulcanizare'],
    image: require('../assets/images/categories/auto.jpg'),
  },
  {
    key: GENERAL_CATEGORY_KEY,
    label: 'General',
    labelKey: 'cat.general',
    // Fără fallback pe nume: „General” se potrivește doar cu category='general'.
    searchTerms: [],
    image: require('../assets/images/categories/general.jpg'),
  },
];

/** Imaginea dalei „Top secret” (cod de invitație la un business privat). */
export const SECRET_TILE_IMAGE: ImageSourcePropType = require('../assets/images/categories/secret.jpg');

export const BROWSE_CATEGORY_LABELS: string[] = BROWSE_CATEGORIES.map((c) => c.label);

/** Eticheta categoriei în limba curentă (pentru UI). */
export function categoryLabel(cat: BrowseCategory): string {
  return trKey(cat.labelKey);
}

/** `lang` forțează limba (ex. 'ro' pentru descrierea automată a paginii publice). */
export function categoryLabelForKey(key: string | null | undefined, lang?: AppLanguage): string {
  if (!key) return '';
  const cat = BROWSE_CATEGORIES.find((c) => c.key === key);
  if (!cat) return '';
  return lang ? translateTo(lang, cat.labelKey) : categoryLabel(cat);
}

/**
 * Textul afișat pentru categoria unui business: specializarea proprie pentru `general`,
 * altfel eticheta categoriei.
 */
export function businessCategoryText(
  biz: { category?: string | null; specialization?: string | null },
  lang?: AppLanguage
): string {
  if (biz.category === GENERAL_CATEGORY_KEY && biz.specialization?.trim()) {
    return biz.specialization.trim();
  }
  return categoryLabelForKey(biz.category, lang);
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
