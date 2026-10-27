import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useState, type ComponentProps } from 'react';

import { useTheme } from '@/components/ui';
import { useT } from '@/lib/i18n';

type IconName = ComponentProps<typeof Ionicons>['name'];

type LoginPalette = {
  card: string;
  field: string;
  button: string;
  buttonPressed: string;
  danger: string;
  dangerPressed: string;
  text: string;
  inputText: string;
  placeholder: string;
  border: string;
};

/** Grafică login: card rotund, câmpuri pill, butoane — variante deschisă / închisă. */
const LOGIN_DARK: LoginPalette = {
  card: '#171717',
  field: '#101010',
  button: '#252525',
  buttonPressed: '#0f766e',
  danger: '#c1121f',
  dangerPressed: '#8f0d17',
  text: '#ffffff',
  inputText: '#d3d3d3',
  placeholder: '#8a8a8a',
  border: '#2a2a2a',
};

const LOGIN_LIGHT: LoginPalette = {
  card: '#ffffff',
  field: '#f0f2f5',
  button: '#252525',
  buttonPressed: '#0f766e',
  danger: '#c1121f',
  dangerPressed: '#8f0d17',
  text: '#0c1222',
  inputText: '#121a2b',
  placeholder: '#5a6b84',
  border: '#e2e8f0',
};

function useLoginPalette(): LoginPalette {
  const t = useTheme();
  return t.scheme === 'dark' ? LOGIN_DARK : LOGIN_LIGHT;
}

/** Caseta de login: același layout ca în grafică, pe tema deschisă sau închisă. */
export function LoginCard({ heading, children }: { heading: string; children: React.ReactNode }) {
  const p = useLoginPalette();
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: p.card,
          borderColor: p.border,
          borderWidth: StyleSheet.hairlineWidth,
        },
      ]}
    >
      <Text style={[styles.heading, { color: p.text }]}>{heading}</Text>
      <View style={styles.body}>{children}</View>
    </View>
  );
}

type LoginFieldProps = TextInputProps & {
  icon: IconName;
};

/** Câmp pill cu iconiță (aspect inset din grafică). */
export function LoginField({ icon, style, secureTextEntry, ...inputProps }: LoginFieldProps) {
  const p = useLoginPalette();
  const tr = useT();
  const isPassword = secureTextEntry === true;
  const [passwordVisible, setPasswordVisible] = useState(false);

  return (
    <View
      style={[
        styles.field,
        { backgroundColor: p.field, borderColor: p.border },
      ]}
    >
      <Ionicons name={icon} size={20} color={p.text} />
      <TextInput
        style={[styles.input, { color: p.inputText }, style]}
        placeholderTextColor={p.placeholder}
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
            color={p.text}
          />
        </Pressable>
      ) : null}
    </View>
  );
}

export type LoginButtonProps = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  tone?: 'default' | 'danger';
  /** Iconiță în stânga textului (ex. logo Google). */
  leading?: React.ReactNode;
};

export function LoginButton({ label, onPress, disabled, loading, tone = 'default', leading }: LoginButtonProps) {
  const p = useLoginPalette();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor:
            tone === 'danger'
              ? pressed && !disabled && !loading ? p.dangerPressed : p.danger
              : pressed && !disabled && !loading ? p.buttonPressed : p.button,
          opacity: disabled || loading ? 0.55 : 1,
          transform: [{ scale: pressed && !disabled && !loading ? 0.98 : 1 }],
        },
      ]}
    >
      <View style={styles.buttonInner}>
        {leading && !loading ? leading : null}
        <Text style={[styles.buttonText, { color: '#ffffff' }]} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.85}>{loading ? '…' : label}</Text>
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
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 25,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
  },
  input: {
    flex: 1,
    minWidth: 0,
    fontSize: 15,
    paddingVertical: 4,
  },
  eyeBtn: {
    padding: 4,
  },
  button: {
    borderRadius: 5,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
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
