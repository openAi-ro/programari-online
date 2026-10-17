import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Animated,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type PressableStateCallbackType,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ComponentProps } from 'react';

import { useColorScheme } from '@/components/useColorScheme';
import { buildTheme, fontSize, radius, spacing, type Theme } from '@/constants/theme';
import { computeFooterPaddingBottom } from '@/lib/keyboardPad';
import { trKey, useT } from '@/lib/i18n';

/** Înălțimea tastaturii (0 când e ascunsă). Folosit pe Android, unde resize nu ridică footer-ul cu edge-to-edge. */
function useKeyboardHeight(enabled: boolean): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    if (!enabled) {
      setHeight(0);
      return;
    }
    const show = Keyboard.addListener('keyboardDidShow', (e) =>
      setHeight(e.endCoordinates.height)
    );
    const hide = Keyboard.addListener('keyboardDidHide', () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, [enabled]);
  return enabled ? height : 0;
}

export function useTheme(): Theme {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  return useMemo(() => buildTheme(scheme), [scheme]);
}

type IconName = ComponentProps<typeof Ionicons>['name'];

/* ------------------------------------------------------------------ */
/* Screen                                                              */
/* ------------------------------------------------------------------ */

type ScreenProps = {
  children: React.ReactNode;
  /** Header custom cu buton de întoarcere + titlu. */
  title?: string;
  subtitle?: string;
  onBack?: () => void;
  headerRight?: React.ReactNode;
  /** Derulant (ScrollView) sau fix (View). */
  scroll?: boolean;
  /** Spațiu suplimentar jos, util când există un buton ancorat. */
  bottomInset?: number;
  footer?: React.ReactNode;
  /**
   * Ridică conținutul / footer-ul deasupra tastaturii (client + business).
   * Implicit true. Pune false doar dacă ecranul își gestionează singur tastatura.
   */
  keyboardAvoid?: boolean;
};

export function Screen({
  children,
  title,
  subtitle,
  onBack,
  headerRight,
  scroll = true,
  bottomInset = spacing['3xl'],
  footer,
  keyboardAvoid = true,
}: ScreenProps) {
  const t = useTheme();
  const tr = useT();
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight(keyboardAvoid && Platform.OS === 'android');
  const footerPaddingBottom = computeFooterPaddingBottom({
    base: Math.max(insets.bottom, spacing.sm) + spacing.sm,
    keyboardHeight,
    platform: Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web',
    keyboardAvoid,
  });

  const body = scroll ? (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={[styles.scrollContent, styles.shell, { paddingBottom: bottomInset }]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      automaticallyAdjustKeyboardInsets={keyboardAvoid}
      removeClippedSubviews={false}
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.flex, styles.shell, { paddingBottom: bottomInset }]}>{children}</View>
  );

  const content = (
    <>
      <View style={{ paddingTop: insets.top, backgroundColor: t.colors.bgElevated }}>
        {title || onBack ? (
          <View style={[styles.header, styles.shell]}>
            <View style={styles.headerLeft}>
              {onBack ? (
                <IconBadge icon="chevron-back" onPress={onBack} accessibilityLabel={tr('common.back')} />
              ) : null}
              <View style={styles.headerTitles}>
                <Text style={[styles.headerTitle, { color: t.colors.text }]} numberOfLines={1}>
                  {title}
                </Text>
                {subtitle ? (
                  <Text
                    style={[styles.headerSubtitle, { color: t.colors.textMuted }]}
                    numberOfLines={1}
                  >
                    {subtitle}
                  </Text>
                ) : null}
              </View>
            </View>
            {headerRight}
          </View>
        ) : null}
      </View>

      {body}

      {footer ? (
        <View
          style={[
            styles.footer,
            {
              backgroundColor: t.colors.bgElevated,
              borderTopColor: t.colors.border,
              paddingBottom: footerPaddingBottom,
            },
          ]}
        >
          <View style={styles.shell}>{footer}</View>
        </View>
      ) : null}
    </>
  );

  if (!keyboardAvoid) {
    return <View style={[styles.flex, { backgroundColor: t.colors.bg }]}>{content}</View>;
  }

  // iOS: padding. Android: deja softwareKeyboardLayoutMode=resize în app.json —
  // behavior „height" dublează ridicarea; lăsăm undefined și ne bazăm pe resize + insets.
  return (
    <KeyboardAvoidingView
      style={[styles.flex, { backgroundColor: t.colors.bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}
    >
      {content}
    </KeyboardAvoidingView>
  );
}

/** Buton circular pentru iconițe, în header. */
export function IconBadge({
  icon,
  onPress,
  accessibilityLabel,
  tone = 'neutral',
}: {
  icon: IconName;
  onPress?: () => void;
  accessibilityLabel: string;
  tone?: 'neutral' | 'accent';
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={4}
      style={({ pressed }) => [
        styles.iconBadge,
        {
          backgroundColor: t.colors.surfaceMuted,
          borderColor: t.colors.border,
          opacity: pressed ? 0.7 : 1,
          width: spacing.touchTarget,
          height: spacing.touchTarget,
        },
      ]}
    >
      <Ionicons
        name={icon}
        size={19}
        color={tone === 'accent' ? t.colors.accent : t.colors.text}
      />
    </Pressable>
  );
}

/* ------------------------------------------------------------------ */
/* Button                                                              */
/* ------------------------------------------------------------------ */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
type ButtonSize = 'sm' | 'md' | 'lg';

type ButtonProps = {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  /** Aliniere conținut icon+text. `start` = icon pe muchia stângă (casete client). */
  contentAlign?: 'center' | 'start';
  /** Linii pentru etichetă. Implicit 2; casetele client folosesc 1. */
  labelNumberOfLines?: number;
  style?: StyleProp<ViewStyle>;
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'lg',
  icon,
  loading = false,
  disabled = false,
  fullWidth = true,
  contentAlign = 'center',
  labelNumberOfLines = 2,
  style,
}: ButtonProps) {
  const t = useTheme();
  const inactive = disabled || loading;

  const palette: Record<ButtonVariant, { bg: string; fg: string; border?: string }> = {
    primary: { bg: t.colors.accent, fg: t.colors.onAccent },
    secondary: {
      bg: t.colors.surface,
      fg: t.colors.text,
      border: t.colors.borderStrong,
    },
    ghost: { bg: 'transparent', fg: t.colors.accent },
    danger: { bg: t.colors.danger, fg: t.colors.onAccent },
    success: { bg: t.colors.success, fg: t.colors.onAccent },
  };
  const c = palette[variant];

  return (
    <Pressable
      onPress={inactive ? undefined : onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
      hitSlop={size === 'sm' ? { top: 6, bottom: 6, left: 4, right: 4 } : undefined}
      style={({ pressed }: PressableStateCallbackType) => [
        styles.button,
        size === 'lg' ? styles.buttonLg : size === 'sm' ? styles.buttonSm : styles.buttonMd,
        fullWidth && styles.buttonFull,
        contentAlign === 'start' ? styles.buttonCompactPad : null,
        {
          backgroundColor: c.bg,
          borderColor: c.border ?? 'transparent',
          borderWidth: c.border ? 1 : 0,
          opacity: inactive ? 0.55 : pressed ? 0.85 : 1,
          transform: [{ scale: pressed && !inactive ? 0.985 : 1 }],
          minHeight: size === 'sm' ? spacing.touchTarget : size === 'md' ? spacing.touchTarget : 52,
        },
        variant === 'primary' && !inactive ? t.shadows.accent : null,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={c.fg} />
      ) : (
        <View
          style={[
            styles.buttonRow,
            contentAlign === 'start' ? styles.buttonRowStart : null,
            contentAlign === 'start' ? styles.buttonRowCompact : null,
          ]}
        >
          {icon ? (
            <Ionicons name={icon} size={size === 'sm' ? 15 : 18} color={c.fg} />
          ) : null}
          <Text
            style={[
              styles.buttonText,
              size === 'lg' ? styles.buttonTextLg : null,
              size === 'sm' ? styles.buttonTextSm : null,
              { color: c.fg },
              contentAlign === 'start' ? styles.buttonTextStart : null,
            ]}
            numberOfLines={labelNumberOfLines}
            ellipsizeMode="tail"
            adjustsFontSizeToFit
            minimumFontScale={labelNumberOfLines === 1 ? 0.7 : 0.75}
          >
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

/* ------------------------------------------------------------------ */
/* Card                                                                */
/* ------------------------------------------------------------------ */

type CardProps = {
  children?: React.ReactNode;
  onPress?: () => void;
  icon?: IconName;
  iconTone?: 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'warm';
  title?: string;
  hint?: string;
  chevron?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function Card({
  children,
  onPress,
  icon,
  iconTone = 'accent',
  title,
  hint,
  chevron = false,
  style,
}: CardProps) {
  const t = useTheme();
  const toneColor = {
    accent: t.colors.accent,
    success: t.colors.success,
    warning: t.colors.warning,
    danger: t.colors.danger,
    info: t.colors.info,
    neutral: t.colors.textMuted,
    warm: t.colors.warm,
  }[iconTone];
  const toneBg = {
    accent: t.colors.accentSoft,
    success: t.colors.successSoft,
    warning: t.colors.warningSoft,
    danger: t.colors.dangerSoft,
    info: t.colors.infoSoft,
    neutral: t.colors.surfaceMuted,
    warm: t.colors.warmSoft,
  }[iconTone];

  const inner = (
    <>
      {icon ? (
        <View style={[styles.cardIcon, { backgroundColor: toneBg }]}>
          <Ionicons name={icon} size={20} color={toneColor} />
        </View>
      ) : null}
      <View style={styles.cardBody}>
        {title ? (
          <Text style={[styles.cardTitle, { color: t.colors.text }]} numberOfLines={2}>{title}</Text>
        ) : null}
        {hint ? (
          <Text style={[styles.cardHint, { color: t.colors.textMuted }]} numberOfLines={3}>{hint}</Text>
        ) : null}
        {children}
      </View>
      {chevron ? (
        <Ionicons name="chevron-forward" size={18} color={t.colors.textFaint} />
      ) : null}
    </>
  );

  const base: StyleProp<ViewStyle> = [
    styles.card,
    {
      backgroundColor: t.colors.surface,
      borderColor: t.colors.border,
    },
    t.shadows.sm,
    style,
  ];

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        style={({ pressed }) => [base, { opacity: pressed ? 0.85 : 1 }]}
      >
        {inner}
      </Pressable>
    );
  }
  return <View style={base}>{inner}</View>;
}

/* ------------------------------------------------------------------ */
/* Typografie & layout                                                 */
/* ------------------------------------------------------------------ */

export function SectionTitle({
  children,
  action,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  const t = useTheme();
  return (
    <View style={styles.sectionRow}>
      <Text style={[styles.sectionTitle, { color: t.colors.textMuted }]}>{children}</Text>
      {action}
    </View>
  );
}

export function Body({
  children,
  muted = false,
  style,
}: {
  children: React.ReactNode;
  muted?: boolean;
  style?: StyleProp<TextStyle>;
}) {
  const t = useTheme();
  return (
    <Text
      style={[
        styles.body,
        { color: muted ? t.colors.textMuted : t.colors.text },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

/** Notificare inline (info / succes / eroare). */
export function Callout({
  tone = 'info',
  title,
  children,
  icon,
}: {
  tone?: 'info' | 'success' | 'warning' | 'danger' | 'accent' | 'warm';
  title?: string;
  children?: React.ReactNode;
  icon?: IconName;
}) {
  const t = useTheme();
  const map = {
    info: { bg: t.colors.infoSoft, fg: t.colors.infoSoftText, icon: 'information-circle' as IconName },
    success: { bg: t.colors.successSoft, fg: t.colors.successSoftText, icon: 'checkmark-circle' as IconName },
    warning: { bg: t.colors.warningSoft, fg: t.colors.warningSoftText, icon: 'alert-circle' as IconName },
    danger: { bg: t.colors.dangerSoft, fg: t.colors.dangerSoftText, icon: 'close-circle' as IconName },
    accent: { bg: t.colors.accentSoft, fg: t.colors.accentSoftText, icon: 'sparkles' as IconName },
    warm: { bg: t.colors.warmSoft, fg: t.colors.warmSoftText, icon: 'flame' as IconName },
  }[tone];

  return (
    <View style={[styles.callout, { backgroundColor: map.bg }]}>
      <Ionicons name={icon ?? map.icon} size={18} color={map.fg} style={styles.calloutIcon} />
      <View style={styles.flex}>
        {title ? (
          <Text style={[styles.calloutTitle, { color: map.fg }]}>{title}</Text>
        ) : null}
        {children ? (
          <Text style={[styles.calloutText, { color: map.fg }]}>{children}</Text>
        ) : null}
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Form fields                                                         */
/* ------------------------------------------------------------------ */

type FieldProps = TextInputProps & {
  label?: string;
  hint?: string;
  error?: string | null;
  icon?: IconName;
};

export function Field({ label, hint, error, icon, style, secureTextEntry, ...inputProps }: FieldProps) {
  const t = useTheme();
  const tr = useT();
  const [focused, setFocused] = useState(false);
  const isPassword = secureTextEntry === true;
  const [passwordVisible, setPasswordVisible] = useState(false);

  return (
    <View style={styles.fieldWrap}>
      {label ? (
        <Text style={[styles.fieldLabel, { color: t.colors.textMuted }]}>{label}</Text>
      ) : null}
      <View
        style={[
          styles.fieldBox,
          {
            backgroundColor: t.colors.surface,
            borderColor: error
              ? t.colors.danger
              : focused
                ? t.colors.accent
                : t.colors.borderStrong,
          },
        ]}
      >
        {icon ? (
          <Ionicons
            name={icon}
            size={17}
            color={focused ? t.colors.accent : t.colors.textFaint}
          />
        ) : null}
        <TextInput
          {...inputProps}
          secureTextEntry={isPassword ? !passwordVisible : secureTextEntry}
          blurOnSubmit={inputProps.blurOnSubmit ?? false}
          showSoftInputOnFocus={inputProps.showSoftInputOnFocus ?? true}
          underlineColorAndroid="transparent"
          onFocus={(e) => {
            setFocused(true);
            inputProps.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            inputProps.onBlur?.(e);
          }}
          placeholderTextColor={t.colors.textFaint}
          style={[
            styles.fieldInput,
            { color: t.colors.text },
            inputProps.multiline ? styles.fieldInputMultiline : null,
            style,
          ]}
        />
        {isPassword ? (
          <Pressable
            onPress={() => setPasswordVisible((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel={passwordVisible ? tr('auth.hidePassword') : tr('auth.showPassword')}
            hitSlop={8}
            style={styles.fieldEyeBtn}
          >
            <Ionicons
              name={passwordVisible ? 'eye-off-outline' : 'eye-outline'}
              size={18}
              color={focused ? t.colors.accent : t.colors.textFaint}
            />
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <Text style={[styles.fieldError, { color: t.colors.danger }]}>{error}</Text>
      ) : hint ? (
        <Text style={[styles.fieldHint, { color: t.colors.textFaint }]}>{hint}</Text>
      ) : null}
    </View>
  );
}

/** Rând de tip setare: titlu + descriere + control în dreapta. */
export function SettingRow({
  icon,
  title,
  description,
  right,
  onPress,
  danger = false,
}: {
  icon?: IconName;
  title: string;
  description?: string;
  right?: React.ReactNode;
  onPress?: () => void;
  danger?: boolean;
}) {
  const t = useTheme();
  const content = (
    <>
      {icon ? (
        <View style={[styles.settingIcon, { backgroundColor: t.colors.surfaceMuted }]}>
          <Ionicons name={icon} size={18} color={danger ? t.colors.danger : t.colors.accent} />
        </View>
      ) : null}
      <View style={styles.flex}>
        <Text
          style={[
            styles.settingTitle,
            { color: danger ? t.colors.danger : t.colors.text },
          ]}
        >
          {title}
        </Text>
        {description ? (
          <Text style={[styles.settingDesc, { color: t.colors.textMuted }]}>
            {description}
          </Text>
        ) : null}
      </View>
      {right ?? (onPress ? <Ionicons name="chevron-forward" size={18} color={t.colors.textFaint} /> : null)}
    </>
  );

  const base: StyleProp<ViewStyle> = [
    styles.settingRow,
    { borderBottomColor: t.colors.border },
  ];

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        style={({ pressed }) => [base, { opacity: pressed ? 0.7 : 1 }]}
      >
        {content}
      </Pressable>
    );
  }
  return <View style={base}>{content}</View>;
}

/* ------------------------------------------------------------------ */
/* Badges & status                                                     */
/* ------------------------------------------------------------------ */

export function Badge({
  children,
  tone = 'neutral',
  icon,
  dot = false,
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'warm';
  icon?: IconName;
  dot?: boolean;
}) {
  const t = useTheme();
  const map = {
    neutral: { bg: t.colors.surfaceMuted, fg: t.colors.textMuted },
    accent: { bg: t.colors.accentSoft, fg: t.colors.accentSoftText },
    success: { bg: t.colors.successSoft, fg: t.colors.successSoftText },
    warning: { bg: t.colors.warningSoft, fg: t.colors.warningSoftText },
    danger: { bg: t.colors.dangerSoft, fg: t.colors.dangerSoftText },
    info: { bg: t.colors.infoSoft, fg: t.colors.infoSoftText },
    warm: { bg: t.colors.warmSoft, fg: t.colors.warmSoftText },
  }[tone];

  return (
    <View style={[styles.badge, { backgroundColor: map.bg }]}>
      {dot ? <View style={[styles.badgeDot, { backgroundColor: map.fg }]} /> : null}
      {icon ? <Ionicons name={icon} size={12} color={map.fg} /> : null}
      <Text
        style={[styles.badgeText, { color: map.fg }]}
        numberOfLines={1}
        ellipsizeMode="tail"
      >
        {children}
      </Text>
    </View>
  );
}

/**
 * Comutator propriu. `Switch` din react-native-web ignoră `thumbColor` și
 * desenează un thumb teal, deci îl construim din View-uri ca să arate la fel
 * pe web, iOS și Android.
 */
export function Toggle({
  value,
  onValueChange,
  accessibilityLabel,
  disabled = false,
}: {
  value: boolean;
  onValueChange: (next: boolean) => void;
  accessibilityLabel: string;
  disabled?: boolean;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={() => !disabled && onValueChange(!value)}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      hitSlop={6}
      style={({ pressed }) => [
        styles.toggleTrack,
        {
          backgroundColor: value ? t.colors.accent : t.colors.borderStrong,
          opacity: disabled ? 0.5 : pressed ? 0.8 : 1,
        },
      ]}
    >
      <View
        style={[
          styles.toggleThumb,
          {
            backgroundColor: t.colors.onAccent,
            marginLeft: value ? 18 : 0,
          },
        ]}
      />
    </Pressable>
  );
}

/** Selector segmentat (sinuri de tab-uri compacte). */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (next: T) => void;
  /** trailing: element mic în dreapta textului (ex. steagul limbii). */
  options: { value: T; label: string; count?: number; trailing?: React.ReactNode }[];
}) {
  const t = useTheme();
  return (
    <View style={[styles.segmented, { backgroundColor: t.colors.surfaceMuted }]}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={({ pressed }) => [
              styles.segmentedItem,
              {
                backgroundColor: active ? t.colors.surface : 'transparent',
                opacity: pressed && !active ? 0.7 : 1,
              },
              active ? t.shadows.sm : null,
            ]}
          >
            <Text
              style={[
                styles.segmentedText,
                { color: active ? t.colors.text : t.colors.textMuted },
              ]}
              numberOfLines={1}
            >
              {opt.label}
              {typeof opt.count === 'number' ? ` (${opt.count})` : ''}
            </Text>
            {opt.trailing ? <View style={styles.segmentedTrailing}>{opt.trailing}</View> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Avatar / Error / ButtonRow                                          */
/* ------------------------------------------------------------------ */

type AvatarSize = 'sm' | 'md' | 'lg';

export function Avatar({
  initials,
  icon,
  imageUrl,
  size = 'md',
}: {
  initials?: string;
  icon?: IconName;
  /** URL poză — cerc plin (cover). */
  imageUrl?: string | null;
  size?: AvatarSize;
}) {
  const t = useTheme();
  const tr = useT();
  const dim = size === 'sm' ? 28 : size === 'lg' ? 48 : 36;
  const textSize = size === 'sm' ? fontSize.xs : size === 'lg' ? fontSize.lg : fontSize.sm;
  const iconSize = size === 'sm' ? 14 : size === 'lg' ? 22 : 18;
  const letter = (initials ?? '').trim().slice(0, 1).toUpperCase() || '?';
  const showPhoto = Boolean(imageUrl);

  return (
    <View
      style={[
        styles.avatar,
        {
          width: dim,
          height: dim,
          borderRadius: radius.pill,
          backgroundColor: showPhoto ? t.colors.surfaceMuted : t.colors.accentSoft,
          overflow: 'hidden',
        },
      ]}
    >
      {showPhoto ? (
        <Image
          source={{ uri: imageUrl as string }}
          style={{ width: dim, height: dim, borderRadius: radius.pill }}
          resizeMode="cover"
          accessibilityLabel={tr('common.avatarPhoto')}
        />
      ) : icon ? (
        <Ionicons name={icon} size={iconSize} color={t.colors.accentSoftText} />
      ) : (
        <Text style={[styles.avatarText, { color: t.colors.accentSoftText, fontSize: textSize }]}>
          {letter}
        </Text>
      )}
    </View>
  );
}

/** Stare de eroare full-screen / listă (icon + titlu + descriere + retry). */
export function ErrorState({
  icon = 'alert-circle-outline',
  title,
  description,
  onRetry,
  retryLabel,
  action,
}: {
  icon?: IconName;
  title: string;
  description?: string;
  onRetry?: () => void;
  retryLabel?: string;
  /** Dacă e setat, înlocuiește butonul de retry implicit. */
  action?: React.ReactNode;
}) {
  const t = useTheme();
  const footer =
    action ??
    (onRetry ? (
      <Button
        label={retryLabel ?? trKey('ui.retryDefault')}
        icon="refresh"
        variant="secondary"
        size="md"
        onPress={onRetry}
      />
    ) : null);

  return (
    <View style={styles.empty}>
      <View style={[styles.emptyIcon, { backgroundColor: t.colors.dangerSoft }]}>
        <Ionicons name={icon} size={30} color={t.colors.danger} />
      </View>
      <Text style={[styles.emptyTitle, { color: t.colors.text }]}>{title}</Text>
      {description ? (
        <Text style={[styles.emptyDesc, { color: t.colors.textMuted }]}>{description}</Text>
      ) : null}
      {footer ? <View style={styles.emptyAction}>{footer}</View> : null}
    </View>
  );
}

/** Rând de butoane una lângă alta (ex. Aprobă / Respinge). */
export function ButtonRow({
  children,
  gap = spacing.sm,
}: {
  children: React.ReactNode;
  gap?: number;
}) {
  return <View style={[styles.buttonRowLayout, { gap }]}>{children}</View>;
}

/* ------------------------------------------------------------------ */
/* Empty & loading                                                     */
/* ------------------------------------------------------------------ */

export function EmptyState({
  icon = 'calendar-clear-outline',
  title,
  description,
  action,
  compact = false,
}: {
  icon?: IconName;
  title: string;
  description?: string;
  action?: React.ReactNode;
  /** Padding redus — util în liste / SlotPicker. */
  compact?: boolean;
}) {
  const t = useTheme();
  return (
    <View style={[styles.empty, compact ? styles.emptyCompact : null]}>
      <View
        style={[
          styles.emptyIcon,
          compact ? styles.emptyIconCompact : null,
          { backgroundColor: t.colors.surfaceMuted },
        ]}
      >
        <Ionicons name={icon} size={compact ? 22 : 30} color={t.colors.textFaint} />
      </View>
      <Text style={[styles.emptyTitle, compact ? styles.emptyTitleCompact : null, { color: t.colors.text }]}>
        {title}
      </Text>
      {description ? (
        <Text style={[styles.emptyDesc, { color: t.colors.textMuted }]}>{description}</Text>
      ) : null}
      {action ? <View style={styles.emptyAction}>{action}</View> : null}
    </View>
  );
}

export function LoadingScreen({ label }: { label?: string }) {
  const t = useTheme();
  return (
    <View style={[styles.centered, { backgroundColor: t.colors.bg }]}>
      <ActivityIndicator size="large" color={t.colors.accent} />
      <Text style={[styles.loadingText, { color: t.colors.textMuted }]}>{label ?? trKey('common.loading')}</Text>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Skeletons                                                           */
/* ------------------------------------------------------------------ */

type SkeletonProps = {
  width?: number | `${number}%`;
  height?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
};

/** Bloc de schelet cu pulsație, folosit în locul conținutului cât se încarcă. */
export function Skeleton({
  width = '100%',
  height = 14,
  radius: r = radius.sm,
  style,
}: SkeletonProps) {
  const t = useTheme();
  const pulse = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.5, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        { width, height, borderRadius: r, backgroundColor: t.colors.skeleton, opacity: pulse },
        style,
      ]}
    />
  );
}

/** Schelet pentru un rând de listă: icon opțional + titlu + linii de text. */
export function SkeletonCard({
  showIcon = true,
  lines = 2,
}: {
  showIcon?: boolean;
  lines?: number;
}) {
  const t = useTheme();
  return (
    <View
      style={[
        styles.skeletonCard,
        { backgroundColor: t.colors.surface, borderColor: t.colors.border },
      ]}
    >
      {showIcon ? <Skeleton width={40} height={40} radius={radius.md} /> : null}
      <View style={[styles.flex, styles.skeletonCardBody]}>
        <Skeleton width="55%" height={15} />
        {Array.from({ length: Math.max(0, lines - 1) }, (_, i) => (
          <Skeleton key={i} width={i === 0 ? '80%' : '65%'} height={12} />
        ))}
      </View>
    </View>
  );
}

/** Listă de schelete, afișată cât se încarcă datele unui ecran. */
export function SkeletonList({
  count = 4,
  showIcon = true,
  lines = 2,
}: {
  count?: number;
  showIcon?: boolean;
  lines?: number;
}) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <SkeletonCard key={i} showIcon={showIcon} lines={lines} />
      ))}
    </>
  );
}

/**
 * Ecran de listă în încărcare: păstrează header-ul (titlu, subtitlu, back)
 * și afișează schelete în locul rândurilor, în loc să înlocuiască tot ecranul.
 */
export function ListLoadingScreen({
  title,
  subtitle,
  onBack,
  count = 4,
  showIcon = true,
  lines = 2,
  label,
}: {
  title?: string;
  subtitle?: string;
  onBack?: () => void;
  count?: number;
  showIcon?: boolean;
  lines?: number;
  label?: string;
}) {
  return (
    <Screen title={title} subtitle={subtitle} onBack={onBack}>
      <View accessibilityRole="progressbar" accessibilityLabel={label ?? trKey('common.loading')} style={styles.skeletonList}>
        <SkeletonList count={count} showIcon={showIcon} lines={lines} />
      </View>
    </Screen>
  );
}

/** Ecran de formular / detaliu în încărcare: păstrează header-ul și afișează blocuri schelet. */
export function SkeletonScreen({
  title,
  subtitle,
  onBack,
  blocks = 4,
  label,
  children,
}: {
  title?: string;
  subtitle?: string;
  onBack?: () => void;
  blocks?: number;
  label?: string;
  /** Conținut schelet custom; înlocuiește blocurile implicite. */
  children?: React.ReactNode;
}) {
  return (
    <Screen title={title} subtitle={subtitle} onBack={onBack}>
      <View accessibilityRole="progressbar" accessibilityLabel={label ?? trKey('common.loading')} style={styles.skeletonList}>
        {children ??
          Array.from({ length: blocks }, (_, i) => (
            <Skeleton key={i} height={i === 0 ? 44 : 64} radius={radius.lg} />
          ))}
      </View>
    </Screen>
  );
}

/** Schelet pentru ecranele cu cifre cheie (rapoarte): grilă de cartonașe. */
export function SkeletonStatGrid({
  count = 6,
  label,
}: {
  count?: number;
  label?: string;
}) {
  const t = useTheme();
  return (
    <View accessibilityRole="progressbar" accessibilityLabel={label ?? trKey('ui.computingReports')} style={styles.skeletonGrid}>
      {Array.from({ length: count }, (_, i) => (
        <View
          key={i}
          style={[
            styles.skeletonStat,
            { backgroundColor: t.colors.surface, borderColor: t.colors.border },
          ]}
        >
          <Skeleton width="70%" height={12} />
          <Skeleton width="45%" height={20} radius={radius.sm} />
        </View>
      ))}
    </View>
  );
}

/** Buton de tip „banner” pentru un pas important (CTA). */
export function Banner({
  tone = 'accent',
  title,
  description,
  onPress,
  actionLabel,
  icon,
}: {
  tone?: 'accent' | 'success' | 'warning' | 'info' | 'warm';
  title: string;
  description?: string;
  onPress?: () => void;
  actionLabel?: string;
  icon?: IconName;
}) {
  const t = useTheme();
  const map = {
    accent: { bg: t.colors.accentSoft, fg: t.colors.accentSoftText, border: t.colors.accent },
    success: { bg: t.colors.successSoft, fg: t.colors.successSoftText, border: t.colors.success },
    warning: { bg: t.colors.warningSoft, fg: t.colors.warningSoftText, border: t.colors.warning },
    info: { bg: t.colors.infoSoft, fg: t.colors.infoSoftText, border: t.colors.info },
    warm: { bg: t.colors.warmSoft, fg: t.colors.warmSoftText, border: t.colors.warm },
  }[tone];

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [
        styles.banner,
        { backgroundColor: map.bg, borderColor: map.border, opacity: pressed ? 0.9 : 1 },
      ]}
    >
      {icon ? <Ionicons name={icon} size={22} color={map.fg} /> : null}
      <View style={styles.flex}>
        <Text style={[styles.bannerTitle, { color: map.fg }]}>{title}</Text>
        {description ? (
          <Text style={[styles.bannerDesc, { color: map.fg }]}>{description}</Text>
        ) : null}
      </View>
      {actionLabel ? (
        <View style={[styles.bannerPill, { backgroundColor: map.border }]}>
          <Text style={[styles.bannerPillText, { color: t.colors.onAccent }]}>{actionLabel}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

/* ------------------------------------------------------------------ */

const styles = StyleSheet.create({
  flex: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: spacing.md, fontSize: fontSize.md },

  scrollContent: { padding: spacing.lg, gap: spacing.md },

  /** Pe ecrane late (web/desktop) conținutul rămâne centrat, ca pe un telefon. */
  shell: {
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 52,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, minWidth: 0, gap: spacing.sm },
  headerTitles: { flex: 1, minWidth: 0 },
  headerTitle: { fontSize: fontSize.lg, fontWeight: '700', letterSpacing: -0.2 },
  headerSubtitle: { fontSize: fontSize.xs, marginTop: 1 },
  iconBadge: {
    width: spacing.touchTarget,
    height: spacing.touchTarget,
    borderRadius: radius.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },

  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    overflow: 'hidden',
    maxWidth: '100%',
  },
  buttonSm: {
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    gap: 6,
    minHeight: spacing.touchTarget,
  },
  buttonMd: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
    minHeight: spacing.touchTarget,
  },
  buttonLg: { paddingVertical: 15, paddingHorizontal: spacing.xl, gap: spacing.sm, minHeight: 52 },
  buttonFull: { width: '100%' },
  buttonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    maxWidth: '100%',
    minWidth: 0,
  },
  buttonRowStart: {
    justifyContent: 'flex-start',
    width: '100%',
  },
  buttonRowCompact: {
    gap: 6,
  },
  buttonCompactPad: {
    paddingHorizontal: spacing.sm + 2,
  },
  buttonTextStart: {
    textAlign: 'left',
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  buttonRowLayout: { flexDirection: 'row', alignItems: 'stretch', width: '100%', flexWrap: 'wrap' },
  buttonText: {
    fontSize: fontSize.md,
    fontWeight: '600',
    flexShrink: 1,
    minWidth: 0,
    textAlign: 'center',
  },
  buttonTextSm: { fontSize: fontSize.sm, fontWeight: '700' },
  buttonTextLg: { fontSize: fontSize.lg },
  avatar: { alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontWeight: '800' },

  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  cardBody: { flex: 1, minWidth: 0, gap: 2 },
  cardIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: { fontSize: fontSize.md, fontWeight: '600' },
  cardHint: { fontSize: fontSize.sm, lineHeight: 18 },

  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  sectionTitle: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },

  body: { fontSize: fontSize.md, lineHeight: 22 },

  callout: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
  },
  calloutIcon: { marginTop: 1 },
  calloutTitle: { fontSize: fontSize.md, fontWeight: '700', marginBottom: 2 },
  calloutText: { fontSize: fontSize.sm, lineHeight: 19 },

  fieldWrap: { gap: 6 },
  fieldLabel: { fontSize: fontSize.sm, fontWeight: '600' },
  fieldBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    backgroundColor: 'transparent',
  },
  fieldInput: {
    flex: 1,
    paddingVertical: 13,
    fontSize: fontSize.lg,
  },
  fieldEyeBtn: {
    padding: 4,
  },
  fieldInputMultiline: { minHeight: 80, textAlignVertical: 'top' },
  fieldHint: { fontSize: fontSize.xs, lineHeight: 16 },
  fieldError: { fontSize: fontSize.xs, fontWeight: '600' },

  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  settingIcon: {
    width: spacing.touchTarget,
    height: spacing.touchTarget,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingTitle: { fontSize: fontSize.md, fontWeight: '600', flexShrink: 1, minWidth: 0 },
  settingDesc: { fontSize: fontSize.sm, marginTop: 2, lineHeight: 18, flexShrink: 1, minWidth: 0 },

  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    flexShrink: 1,
    maxWidth: '100%',
    gap: 5,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  badgeDot: { width: 6, height: 6, borderRadius: 3, flexShrink: 0 },
  badgeText: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    letterSpacing: 0.2,
    flexShrink: 1,
    minWidth: 0,
  },

  toggleTrack: {
    width: 44,
    height: 26,
    borderRadius: radius.pill,
    padding: 3,
    justifyContent: 'center',
  },
  toggleThumb: {
    width: 20,
    height: 20,
    borderRadius: radius.pill,
  },

  segmented: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 4,
    borderRadius: radius.md,
    gap: 4,
  },
  segmentedItem: {
    flex: 1,
    flexBasis: '30%',
    minWidth: 0,
    paddingVertical: spacing.sm + 1,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.sm,
    alignItems: 'center',
  },
  segmentedTrailing: {
    position: 'absolute',
    right: spacing.sm,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  segmentedText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    flexShrink: 1,
    textAlign: 'center',
  },

  empty: { alignItems: 'center', paddingVertical: spacing['4xl'], paddingHorizontal: spacing.xl },
  emptyCompact: { paddingVertical: spacing.xl, paddingHorizontal: spacing.md },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  emptyIconCompact: {
    width: 48,
    height: 48,
    marginBottom: spacing.md,
  },
  emptyTitle: { fontSize: fontSize.lg, fontWeight: '700', textAlign: 'center' },
  emptyTitleCompact: { fontSize: fontSize.md },
  emptyDesc: {
    fontSize: fontSize.md,
    textAlign: 'center',
    marginTop: spacing.xs,
    lineHeight: 21,
  },
  emptyAction: { marginTop: spacing.xl, alignSelf: 'stretch' },

  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  bannerTitle: { fontSize: fontSize.md, fontWeight: '700' },
  bannerDesc: { fontSize: fontSize.sm, marginTop: 2, lineHeight: 18 },
  bannerPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radius.pill,
  },
  bannerPillText: { fontSize: fontSize.sm, fontWeight: '700' },

  skeletonList: { gap: spacing.md },
  skeletonCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  skeletonCardBody: { gap: spacing.sm, paddingTop: 2 },
  skeletonGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  skeletonStat: {
    flexGrow: 1,
    flexBasis: '45%',
    gap: spacing.sm,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
});
