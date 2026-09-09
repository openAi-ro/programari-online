import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Badge, Button, ButtonRow, useTheme } from '@/components/ui';
import { fontSize, radius, spacing } from '@/constants/theme';
import { STATUS_META } from '@/lib/status';
import type { Appointment } from '@/lib/types';

type Props = {
  appointment: Appointment;
  businessName?: string;
  localLabel?: string;
  showActions?: boolean;
  onApprove?: () => void;
  onReject?: () => void;
  onCancel?: () => void;
};

export function AppointmentCard({
  appointment,
  businessName,
  localLabel,
  showActions,
  onApprove,
  onReject,
  onCancel,
}: Props) {
  const t = useTheme();
  const status = appointment.status;
  const meta = STATUS_META[status];

  const fallbackLabel = `${new Date(appointment.start_at).toLocaleString('ro-RO')} – ${new Date(
    appointment.end_at
  ).toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' })}`;

  const contact = [appointment.client_email, appointment.client_phone]
    .filter(Boolean)
    .join(' · ');

  const [confirming, setConfirming] = useState(false);

  function doCancel() {
    setConfirming(false);
    onCancel?.();
  }

  const toneColor = {
    neutral: t.colors.textMuted,
    accent: t.colors.accent,
    success: t.colors.success,
    warning: t.colors.warning,
    danger: t.colors.danger,
    info: t.colors.info,
  }[meta.tone];

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: t.colors.surface, borderColor: t.colors.border },
        t.shadows.sm,
      ]}
    >
      <View style={[styles.accent, { backgroundColor: toneColor }]} />

      <View style={styles.content}>
        <View style={styles.headRow}>
          <View style={styles.headText}>
            {businessName ? (
              <Text style={[styles.title, { color: t.colors.text }]} numberOfLines={1}>
                {businessName}
              </Text>
            ) : null}
            <View style={styles.timeRow}>
              <Ionicons name="calendar-outline" size={14} color={t.colors.textMuted} />
              <Text style={[styles.time, { color: t.colors.text }]} numberOfLines={1}>
                {localLabel ?? fallbackLabel}
              </Text>
            </View>
          </View>
          <Badge tone={meta.tone} dot>
            {meta.label}
          </Badge>
        </View>

        {contact ? (
          <View style={styles.contactRow}>
            <Ionicons name="person-outline" size={13} color={t.colors.textFaint} />
            <Text style={[styles.contact, { color: t.colors.textMuted }]} numberOfLines={1}>
              {contact}
            </Text>
          </View>
        ) : null}

        {showActions && status === 'pending' ? (
          <ButtonRow>
            <View style={styles.actionFlex}>
              <Button
                label="Respinge"
                icon="close"
                variant="secondary"
                size="sm"
                onPress={onReject}
              />
            </View>
            <View style={styles.actionFlex}>
              <Button
                label="Aprobă"
                icon="checkmark"
                variant="success"
                size="sm"
                onPress={onApprove}
              />
            </View>
          </ButtonRow>
        ) : null}

        {onCancel && (status === 'pending' || status === 'approved') ? (
          confirming ? (
            <View style={[styles.confirmBox, { borderTopColor: t.colors.border }]}>
              <Text style={[styles.confirmText, { color: t.colors.textMuted }]}>
                Slotul va fi eliberat. Sigur anulezi?
              </Text>
              <ButtonRow>
                <View style={styles.actionFlex}>
                  <Button
                    label="Renunță"
                    variant="secondary"
                    size="sm"
                    onPress={() => setConfirming(false)}
                  />
                </View>
                <View style={styles.actionFlex}>
                  <Button
                    label="Anulează"
                    icon="trash-outline"
                    variant="danger"
                    size="sm"
                    onPress={doCancel}
                  />
                </View>
              </ButtonRow>
            </View>
          ) : (
            <Pressable
              onPress={() => setConfirming(true)}
              accessibilityRole="button"
              hitSlop={6}
              style={({ pressed }) => [
                styles.cancelRow,
                { borderTopColor: t.colors.border, opacity: pressed ? 0.6 : 1 },
              ]}
            >
              <Ionicons name="close-circle-outline" size={15} color={t.colors.danger} />
              <Text style={[styles.cancelText, { color: t.colors.danger }]}>
                Anulează programarea
              </Text>
            </Pressable>
          )
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    borderRadius: radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  accent: { width: 4 },
  content: { flex: 1, padding: spacing.lg, gap: spacing.sm },
  headRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  headText: { flex: 1, gap: 4 },
  title: { fontSize: fontSize.md, fontWeight: '700' },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  time: { fontSize: fontSize.md, fontWeight: '600', flexShrink: 1 },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  contact: { fontSize: fontSize.sm, flexShrink: 1 },
  actionFlex: { flex: 1 },
  cancelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: spacing.xs,
    paddingTop: spacing.md,
    minHeight: spacing.touchTarget,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  cancelText: { fontSize: fontSize.sm, fontWeight: '600' },
  confirmBox: { gap: spacing.sm, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth },
  confirmText: { fontSize: fontSize.sm, lineHeight: 18 },
});
