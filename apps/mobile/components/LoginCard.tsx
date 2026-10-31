import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useState, type ComponentProps } from 'react';

import { Button, useTheme } from '@/components/ui';
import { useT } from '@/lib/i18n';
import { fontSize, radius, spacing } from '@/constants/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

/** Caseta de login: acelasi layout, dar toate culorile vin din tema aplicatiei. */
export function LoginCard({ heading, children }: { heading: string; children: React.ReactNode }) {
  const t = useTheme();
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: t.colors.surface,
          borderColor: t.colors.border,
          borderWidth: StyleSheet.hairlineWidth,
        },
        t.shadows.md,
      ]}
    >
      <Text style={[styles.heading, { color: t.colors.text }]}>{heading}</Text>
      <View style={styles.body}>{children}</View>
    </View>
  );
}

type LoginFieldProps = TextInputProps & {
  icon: IconName;
  label?: string;
  hint?: string;
};

/** Camp pill cu iconita, eticheta vizibila deasupra si ajutor dedesubt. */
export function LoginField({ icon, label, hint, style, secureTextEntry, ...inputProps }: LoginFieldProps) {
  const t = useTheme();
  const tr = useT();
  const isPassword = secureTextEntry === true;
  const [passwordVisible, setPasswordVisible] = useState(false);

  return (
    <View style={styles.fieldWrap}>
      {label ? (
        <Text style={[styles.fieldLabel, { color: t.colors.text }]}>{label}</Text>
      ) : null}
      <View
        style={[
          styles.field,
          { backgroundColor: t.colors.surfaceMuted, borderColor: t.colors.border },
        ]}
      >
        <Ionicons name={icon} size={20} color={t.colors.textMuted} />
        <TextInput
          style={[styles.input, { color: t.colors.text }, style]}
          placeholderTextColor={t.colors.textFaint}
          {...inputProps}
          secureTextEntry={isPassword ? !passwordVisible : secureTextEntry}
        />
        {isPassword ? (
          <Pressable
            onPress={() => setPasswordVisible((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel={passwordVisible ? tr('auth.hidePassword') : tr('auth.showPassword')}
            hitSlop={8}
            style={styles.eyeBtn}
          >
            <Ionicons
              name={passwordVisible ? 'eye-off-outline' : 'eye-outline'}
              size={20}
              color={t.colors.textMuted}
            />
          </Pressable>
        ) : null}
      </View>
      {hint ? (
        <Text style={[styles.fieldHint, { color: t.colors.textMuted }]}>{hint}</Text>
      ) : null}
    </View>
  );
}

export type LoginButtonTone =
  | 'default'
  | 'primary'
  | 'secondary'
  | 'outlined'
  | 'ghost'
  | 'text'
  | 'danger';

export type LoginButtonProps = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  tone?: LoginButtonTone;
  /** Iconita in stanga textului (ex. logo Google). */
  leading?: React.ReactNode;
};

function toneToVariant(tone: LoginButtonTone): 'primary' | 'secondary' | 'ghost' | 'danger' {
  if (tone === 'secondary' || tone === 'outlined') return 'secondary';
  if (tone === 'ghost' || tone === 'text') return 'ghost';
  if (tone === 'danger') return 'danger';
  return 'primary';
}

export function LoginButton({ label, onPress, disabled, loading, tone = 'default', leading }: LoginButtonProps) {
  const t = useTheme();
  const variant = toneToVariant(tone);

  if (!leading) {
    return (
      <Button
        label={label}
        onPress={onPress}
        disabled={disabled}
        loading={loading}
        variant={variant}
        size="md"
      />
    );
  }

  const palette = {
    primary: { bg: t.colors.accent, fg: t.colors.onAccent, border: 'transparent' },
    secondary: { bg: t.colors.surface, fg: t.colors.text, border: t.colors.borderStrong },
    ghost: { bg: 'transparent', fg: t.colors.accent, border: 'transparent' },
    danger: { bg: t.colors.danger, fg: t.colors.onAccent, border: 'transparent' },
  }[variant];
  const inactive = Boolean(disabled || loading);

  return (
    <Pressable
      onPress={inactive ? undefined : onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inactive, busy: Boolean(loading) }}
      android_ripple={{ color: t.colors.accentSoft, borderless: false }}
      style={({ pressed }) => [
        styles.leadingButton,
        {
          backgroundColor: palette.bg,
          borderColor: palette.border,
          borderWidth: variant === 'secondary' ? 1 : 0,
          opacity: inactive ? 0.55 : pressed ? 0.85 : 1,
        },
      ]}
    >
      <View style={styles.buttonInner}>
        {!loading ? leading : null}
        <Text
          style={[styles.buttonText, { color: palette.fg }]}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {loading ? '…' : label}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 25,
    paddingHorizontal: 28,
    paddingTop: 8,
    paddingBottom: 24,
    gap: 10,
  },
  heading: {
    textAlign: 'center',
    marginVertical: 24,
    fontSize: 20,
    fontWeight: '700',
  },
  body: { gap: 10 },
  fieldWrap: { gap: spacing.xs },
  fieldLabel: { fontSize: fontSize.sm, fontWeight: '700' },
  fieldHint: { fontSize: fontSize.xs, lineHeight: 16 },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 25,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    minHeight: spacing.touchTarget,
  },
  input: {
    flex: 1,
    minWidth: 0,
    fontSize: 15,
    paddingVertical: 4,
  },
  eyeBtn: {
    padding: 4,
    minWidth: spacing.touchTarget,
    minHeight: spacing.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  leadingButton: {
    borderRadius: radius.md,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: spacing.touchTarget,
    overflow: 'hidden',
  },
  buttonInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    minWidth: 0,
  },
  buttonText: {
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
    flexShrink: 1,
    minWidth: 0,
  },
});
