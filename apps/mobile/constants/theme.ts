import { Platform } from 'react-native';

export type Scheme = 'light' | 'dark';

/**
 * Paleta brută. Nu se folosește direct în ecrane — se citește prin `useTheme()`,
 * care alege varianta potrivită schemei curente.
 */
export const palette = {
  // Neutre
  white: '#ffffff',
  ink950: '#0b1120',
  ink900: '#111a2e',
  ink800: '#1b2740',
  ink700: '#2a3a58',
  ink500: '#5b6b86',
  ink400: '#8496b0',
  ink300: '#c3cede',
  ink200: '#e2e8f2',
  ink100: '#eef2f8',
  ink50: '#f6f8fc',

  // Accent — indigo
  accent700: '#3730a3',
  accent600: '#4438ca',
  accent500: '#5b4bf0',
  accent400: '#7b6ef5',
  accent100: '#e6e3fd',
  accent50: '#f1effe',

  // Semantice
  success700: '#15803d',
  success600: '#16a34a',
  success100: '#dcfce7',
  success50: '#f0fdf4',

  warning700: '#a35a06',
  warning600: '#c2740a',
  warning100: '#fdf0d5',
  warning50: '#fefaf0',

  danger700: '#b42318',
  danger600: '#dc2626',
  danger100: '#fde5e3',
  danger50: '#fef4f3',

  info700: '#0e6f83',
  info600: '#0e7f96',
  info100: '#d9f2f8',
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
  /** Minimum pressable hit area (a11y). */
  touchTarget: 44,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 22,
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

/**
 * RN 0.86 acceptă `boxShadow` (sintaxă CSS) pe iOS, Android și web.
 * Pe Android păstrăm și `elevation`, care rămâne varianta cea mai sigură.
 */
function shadow(css: string, androidElevation: number) {
  const base = { boxShadow: css };
  if (Platform.OS === 'android') {
    return { ...base, elevation: androidElevation };
  }
  return base;
}

export const shadows = {
  none: {},
  sm: shadow('0 1px 2px rgba(11,17,32,0.06)', 1),
  md: shadow('0 2px 8px rgba(11,17,32,0.08)', 3),
  lg: shadow('0 10px 28px rgba(11,17,32,0.14)', 8),
  accent: shadow('0 8px 20px rgba(91,75,240,0.32)', 6),
};

export type Theme = {
  scheme: Scheme;
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

  accent: palette.accent500,
  accentPressed: palette.accent600,
  accentSoft: palette.accent100,
  accentSoftText: palette.accent700,

  success: palette.success600,
  successSoft: palette.success100,
  successSoftText: palette.success700,
  warning: palette.warning600,
  warningSoft: palette.warning100,
  warningSoftText: palette.warning700,
  danger: palette.danger600,
  dangerSoft: palette.danger100,
  dangerSoftText: palette.danger700,
  info: palette.info600,
  infoSoft: palette.info100,
  infoSoftText: palette.info700,

  overlay: 'rgba(11,17,32,0.45)',
  skeleton: palette.ink200,
};

const dark: Theme['colors'] = {
  bg: palette.ink950,
  bgElevated: palette.ink900,
  surface: palette.ink900,
  surfaceMuted: palette.ink800,
  border: palette.ink800,
  borderStrong: palette.ink700,
  text: '#f2f5fa',
  textMuted: palette.ink400,
  textFaint: palette.ink500,
  onAccent: palette.white,

  accent: palette.accent400,
  accentPressed: palette.accent500,
  accentSoft: 'rgba(123,110,245,0.18)',
  accentSoftText: '#c6c0fb',

  success: '#4ade80',
  successSoft: 'rgba(74,222,128,0.16)',
  successSoftText: '#a7f3c4',
  warning: '#fbbf24',
  warningSoft: 'rgba(251,191,36,0.16)',
  warningSoftText: '#fde3a7',
  danger: '#f87171',
  dangerSoft: 'rgba(248,113,113,0.16)',
  dangerSoftText: '#fca5a5',
  info: '#38bdf8',
  infoSoft: 'rgba(56,189,248,0.16)',
  infoSoftText: '#bae6fd',

  overlay: 'rgba(0,0,0,0.6)',
  skeleton: palette.ink800,
};

export function buildTheme(scheme: Scheme): Theme {
  return {
    scheme,
    colors: scheme === 'dark' ? dark : light,
    shadows,
  };
}
