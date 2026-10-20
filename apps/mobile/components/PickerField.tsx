import { useMemo, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '@/components/ui';
import { useT } from '@/lib/i18n';
import { fontSize, radius, spacing } from '@/constants/theme';
import { normalizeRo } from '@/lib/roGeo';
import { useWebKeyboardInset } from '@/lib/keyboardInset';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

type Props = {
  label: string;
  value: string;
  options: string[];
  onChange: (next: string) => void;
  placeholder?: string;
  hint?: string;
  icon?: IconName;
  disabled?: boolean;
};

/** Selector cu căutare, pentru liste lungi (județe, localități). */
export function PickerField({
  label,
  value,
  options,
  onChange,
  placeholder,
  hint,
  icon,
  disabled = false,
}: Props) {
  const t = useTheme();
  const tr = useT();
  const [open, setOpen] = useState(false);
  const shownPlaceholder = placeholder ?? tr('pick.choose');
  const [query, setQuery] = useState('');
  const webKeyboardInset = useWebKeyboardInset(open);

  const filtered = useMemo(() => {
    const q = normalizeRo(query);
    if (!q) return options;
    return options.filter((o) => normalizeRo(o).includes(q));
  }, [options, query]);

  function close() {
    setOpen(false);
    setQuery('');
  }

  return (
    <View style={styles.wrap}>
      <Text style={[styles.label, { color: t.colors.textMuted }]}>{label}</Text>
      <Pressable
        onPress={() => !disabled && setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled }}
        style={({ pressed }) => [
          styles.box,
          {
            backgroundColor: t.colors.surface,
            borderColor: t.colors.borderStrong,
            opacity: disabled ? 0.55 : pressed ? 0.85 : 1,
          },
        ]}
      >
        {icon ? (
          <Ionicons name={icon} size={17} color={disabled ? t.colors.textFaint : t.colors.accent} />
        ) : null}
        <Text
          style={[styles.value, { color: value ? t.colors.text : t.colors.textFaint }]}
          numberOfLines={1}
        >
          {value || shownPlaceholder}
        </Text>
        <Ionicons name="chevron-down" size={16} color={t.colors.textFaint} />
      </Pressable>
      {hint ? <Text style={[styles.hint, { color: t.colors.textFaint }]}>{hint}</Text> : null}

      <Modal
        visible={open}
        animationType="slide"
        transparent
        onRequestClose={close}
        statusBarTranslucent
      >
        {/* Foaia stă deasupra tastaturii: nativ prin KeyboardAvoidingView (fereastra Modal nu se
            redimensionează în edge-to-edge), pe web prin visualViewport. */}
        <KeyboardAvoidingView
          behavior={Platform.OS === 'web' ? undefined : 'padding'}
          style={[styles.backdrop, { backgroundColor: t.colors.overlay, paddingBottom: webKeyboardInset }]}
        >
          <View style={[styles.sheet, { backgroundColor: t.colors.bgElevated }]}>
            <View style={styles.sheetHead}>
              <Text style={[styles.sheetTitle, { color: t.colors.text }]}>{label}</Text>
              <Pressable
                onPress={close}
                accessibilityRole="button"
                accessibilityLabel={tr('common.close')}
                hitSlop={8}
              >
                <Ionicons name="close" size={22} color={t.colors.textMuted} />
              </Pressable>
            </View>

            <View
              style={[
                styles.search,
                { backgroundColor: t.colors.surface, borderColor: t.colors.border },
              ]}
            >
              <Ionicons name="search" size={16} color={t.colors.textFaint} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={tr('pick.search')}
                placeholderTextColor={t.colors.textFaint}
                autoCorrect={false}
                style={[styles.searchInput, { color: t.colors.text }]}
              />
            </View>

            <FlatList
              data={filtered}
              keyExtractor={(item) => item}
              keyboardShouldPersistTaps="always"
              initialNumToRender={24}
              style={styles.list}
              ListEmptyComponent={
                <Text style={[styles.empty, { color: t.colors.textMuted }]}>
                  {tr('pick.noResults', { query })}
                </Text>
              }
              renderItem={({ item }) => {
                const active = item === value;
                return (
                  <Pressable
                    onPress={() => {
                      onChange(item);
                      close();
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    style={({ pressed }) => [
                      styles.row,
                      {
                        backgroundColor: active ? t.colors.accentSoft : 'transparent',
                        opacity: pressed ? 0.75 : 1,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.rowText,
                        { color: active ? t.colors.accentSoftText : t.colors.text },
                      ]}
                    >
                      {item}
                    </Text>
                    {active ? (
                      <Ionicons name="checkmark" size={18} color={t.colors.accentSoftText} />
                    ) : null}
                  </Pressable>
                );
              }}
            />
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  label: { fontSize: fontSize.sm, fontWeight: '600' },
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: spacing.touchTarget,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
  },
  value: { flex: 1, fontSize: fontSize.md },
  hint: { fontSize: fontSize.xs, lineHeight: 16 },
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '82%',
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing['2xl'],
    gap: spacing.md,
  },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { fontSize: fontSize.lg, fontWeight: '800' },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    minHeight: spacing.touchTarget,
  },
  searchInput: { flex: 1, fontSize: fontSize.md },
  // flexShrink: lista se micșorează și derulează când tastatura lasă puțin loc.
  list: { flexGrow: 0, flexShrink: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radius.sm,
  },
  rowText: { fontSize: fontSize.md, fontWeight: '600' },
  empty: { fontSize: fontSize.sm, paddingVertical: spacing.lg, textAlign: 'center' },
});