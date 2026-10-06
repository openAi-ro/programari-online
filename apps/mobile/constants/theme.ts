import { Platform } from 'react-native';

export type Scheme = 'light' | 'dark';

/**
 * Tema „Programări Aurora” — construită pe brandul din icon:
 * calendar + QR pe gradient teal → sky, cu accent cald orange.
 * Calmă (încredere pentru programări locale), clară pe light/dark,
 * aliniată splash + adaptive icon.
 */
export const palette = {
  white: '#ffffff',

  // Neutre — slate cald (mai puțin „rece” decât ink pur)
  ink950: '#0c1222',
  ink900: '#121a2b',
  ink800: '#1c273c',
  ink700: '#2c3b55',
  ink500: '#5a6b84',
  ink400: '#8496ae',
  ink300: '#c2cedd',
  ink200: '#e1e8f1',
  ink100: '#eef3f8',
  ink50: '#f5f8fb',

  // Accent principal — teal (stânga iconului)
  accent700: '#0f766e',
  accent600: '#0d9488',
  accent500: '#14b8a6',
  accent400: '#2dd4bf',
  accent100: '#ccfbf1',
  accent50: '#f0fdfa',

  // Accent cald — colțul orange din icon (folosit rar: badge / highlight)
  warm700: '#c2410c',
  warm600: '#ea580c',
  warm500: '#f97316',
  warm100: '#ffedd5',
  warm50: '#fff7ed',

  // Sky — dreapta iconului / info
  sky700: '#0369a1',
  sky600: '#0284c7',
  sky500: '#0ea5e9',
  sky100: '#e0f2fe',
  sky50: '#f0f9ff',

  // Semantice
  success700: '#15803d',
  success600: '#16a34a',
  success100: '#dcfce7',
  success50: '#f0fdf4',

  warning700: '#a35a06',
  warning600: '#d97706',
  warning100: '#fef3c7',
  warning50: '#fffbeb',

  danger700: '#b91c1c',
  danger600: '#dc2626',
  danger100: '#fee2e2',
  danger50: '#fef2f2',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  '2xl': 24,
  '3xl': 32,
  '4xl': 48,
  /** Minimum pressable hit area (a11y / Apple HIG). */
  touchTarget: 44,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 22,
  '2xl': 28,
  pill: 999,
} as const;

export const fontSize = {
  xs: 12,
  sm: 13,
  md: 15,
  lg: 17,
  xl: 20,
  '2xl': 24,
  '3xl': 30,
} as const;

export type Shadow = ReturnType<typeof shadow>;

function shadow(css: string, androidElevation: number) {
  const base = { boxShadow: css };
  if (Platform.OS === 'android') {
    return { ...base, elevation: androidElevation };
  }
  return base;
}

export const shadows = {
  none: {},
  sm: shadow('0 1px 2px rgba(12,18,34,0.06)', 1),
  md: shadow('0 2px 10px rgba(12,18,34,0.08)', 3),
  lg: shadow('0 12px 28px rgba(12,18,34,0.14)', 8),
  accent: shadow('0 8px 22px rgba(20,184,166,0.35)', 6),
};

export type Theme = {
  scheme: Scheme;
  /** Numele temei — pentru debug / Setări. */
  name: 'programari-aurora';
  colors: {
    bg: string;
    bgElevated: string;
    surface: string;
    surfaceMuted: string;
    border: string;
    borderStrong: string;
    text: string;
    textMuted: string;
    textFaint: string;
    onAccent: string;

    accent: string;
    accentPressed: string;
    accentSoft: string;
    accentSoftText: string;

    /** Orange din icon — CTA secundar / highlight. */
    warm: string;
    warmSoft: string;
    warmSoftText: string;

    success: string;
    successSoft: string;
    successSoftText: string;
    warning: string;
    warningSoft: string;
    warningSoftText: string;
    danger: string;
    dangerSoft: string;
    dangerSoftText: string;
    info: string;
    infoSoft: string;
    infoSoftText: string;

    overlay: string;
    skeleton: string;
  };
  shadows: typeof shadows;
};

const light: Theme['colors'] = {
  bg: palette.ink50,
  bgElevated: palette.white,
  surface: palette.white,
  surfaceMuted: palette.ink100,
  border: palette.ink200,
  borderStrong: palette.ink300,
  text: palette.ink950,
  textMuted: palette.ink500,
  textFaint: palette.ink400,
  onAccent: palette.white,

  accent: palette.accent600,
  accentPressed: palette.accent700,
  accentSoft: palette.accent100,
  accentSoftText: palette.accent700,

  warm: palette.warm500,
  warmSoft: palette.warm100,
  warmSoftText: palette.warm700,

  success: palette.success600,
  successSoft: palette.success100,
  successSoftText: palette.success700,
  warning: palette.warning600,
  warningSoft: palette.warning100,
  warningSoftText: palette.warning700,
  danger: palette.danger600,
  dangerSoft: palette.danger100,
  dangerSoftText: palette.danger700,
  info: palette.sky600,
  infoSoft: palette.sky100,
  infoSoftText: palette.sky700,

  overlay: 'rgba(12,18,34,0.45)',
  skeleton: palette.ink200,
};

const dark: Theme['colors'] = {
  bg: palette.ink950,
  bgElevated: palette.ink900,
  surface: palette.ink900,
  surfaceMuted: palette.ink800,
  border: palette.ink700,
  borderStrong: palette.ink500,
  text: '#f1f5f9',
  textMuted: palette.ink400,
  textFaint: palette.ink500,
  onAccent: palette.white,

  accent: palette.accent400,
  accentPressed: palette.accent500,
  accentSoft: 'rgba(45,212,191,0.16)',
  accentSoftText: '#99f6e4',

  warm: '#fb923c',
  warmSoft: 'rgba(249,115,22,0.16)',
  warmSoftText: '#fdba74',

  success: '#4ade80',
  successSoft: 'rgba(74,222,128,0.16)',
  successSoftText: '#a7f3c4',
  warning: '#fbbf24',
  warningSoft: 'rgba(251,191,36,0.16)',
  warningSoftText: '#fde68a',
  danger: '#f87171',
  dangerSoft: 'rgba(248,113,113,0.16)',
  dangerSoftText: '#fca5a5',
  info: '#38bdf8',
  infoSoft: 'rgba(56,189,248,0.16)',
  infoSoftText: '#bae6fd',

  overlay: 'rgba(0,0,0,0.62)',
  skeleton: palette.ink800,
};

export function buildTheme(scheme: Scheme): Theme {
  return {
    scheme,
    name: 'programari-aurora',
    colors: scheme === 'dark' ? dark : light,
    shadows,
  };
}
