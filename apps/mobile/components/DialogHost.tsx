import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/components/ui';
import { fontSize, radius, spacing } from '@/constants/theme';
import { closeDialog, subscribeDialog, type DialogAction, type DialogRequest } from '@/lib/dialog';
import { dismissAction } from '@/lib/dialogActions';

/** In-app dialog for web (see lib/dialog.ts). Mounted once in app/_layout. */
export function DialogHost() {
  const t = useTheme();
  const [req, setReq] = useState<DialogRequest | null>(null);
  useEffect(() => subscribeDialog(setReq), []);
  if (!req) return null;

  // Run the action inside the tap itself, so a file picker it opens keeps the user gesture.
  function choose(action: DialogAction | undefined) {
    closeDialog();
    action?.onPress?.();
  }
  const dismiss = () => choose(dismissAction(req.actions));

  return (
    <Modal visible transparent animationType="fade" onRequestClose={dismiss}>
      <Pressable
        style={[styles.backdrop, { backgroundColor: t.colors.overlay }]}
        onPress={dismiss}
        accessibilityRole="button"
        accessibilityLabel={dismissAction(req.actions)?.text}
      >
        <Pressable
          style={[styles.card, { backgroundColor: t.colors.bgElevated, borderColor: t.colors.border }]}
          onPress={() => {}}
          accessibilityRole="alert"
        >
          <Text style={[styles.title, { color: t.colors.text }]}>{req.title}</Text>
          {req.message ? <Text style={[styles.message, { color: t.colors.textMuted }]}>{req.message}</Text> : null}
          <View style={styles.actions}>
            {req.actions.map((a) => {
              const color = a.style === 'destructive' ? t.colors.danger : a.style === 'cancel' ? t.colors.textMuted : t.colors.accent;
              return (
                <Pressable
                  key={a.text}
                  onPress={() => choose(a)}
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.action,
                    { borderColor: t.colors.border, backgroundColor: pressed ? t.colors.surfaceMuted : t.colors.surface },
                  ]}
                >
                  <Text style={[styles.actionText, { color, fontWeight: a.style === 'cancel' ? '500' : '700' }]}>{a.text}</Text>
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  card: { width: '100%', maxWidth: 380, borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, padding: spacing.xl, gap: spacing.md },
  title: { fontSize: fontSize.lg, fontWeight: '700' },
  message: { fontSize: fontSize.md, lineHeight: 21 },
  actions: { gap: spacing.sm, marginTop: spacing.sm },
  action: { minHeight: spacing.touchTarget, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg },
  actionText: { fontSize: fontSize.md },
});
