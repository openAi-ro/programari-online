import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Badge, Button, ButtonRow, useTheme } from '@/components/ui';
import { fontSize, radius, spacing } from '@/constants/theme';
import { STATUS_META } from '@/lib/status';
import { canMarkNoShow, paymentLabel } from '@/lib/bookingRules';
import type { Appointment } from '@/lib/types';

type Props = {
  appointment: Appointment;
  businessName?: string;
  localLabel?: string;
  showActions?: boolean;
  onApprove?: () => void;
  onReject?: () => void;
  onCancel?: () => void;
  onReschedule?: () => void;
  onConfirmAttendance?: () => void;
  canCancel?: boolean;
  canReschedule?: boolean;
  canConfirm?: boolean;
  onPostpone?: (hours: 1 | 2) => void;
  postponeBusy?: boolean;
  onAddToCalendar?: () => void;
  onPayDeposit?: () => void;
  payBusy?: boolean;
  /** Navigare turn-by-turn — doar dacă business-ul are coordonate GPS. */
  onDrive?: () => void;
  onMarkPaid?: () => void;
  onWaiveDeposit?: () => void;
  onMarkNoShow?: () => void;
  onClearNoShow?: () => void;
  onReview?: () => void;
  reviewLabel?: string;
};

export function AppointmentCard({
  appointment,
  businessName,
  localLabel,
  showActions,
  onApprove,
  onReject,
  onCancel,
  onReschedule,
  onConfirmAttendance,
  canCancel = true,
  canReschedule = false,
  canConfirm = false,
  onPostpone,
  postponeBusy,
  onAddToCalendar,
  onPayDeposit,
  payBusy,
  onDrive,
  onMarkPaid,
  onWaiveDeposit,
  onMarkNoShow,
  onClearNoShow,
  onReview,
  reviewLabel,
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

  const canPostpone =
    showActions &&
    onPostpone &&
    (status === 'approved' || status === 'pending');

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
            {appointment.service_name ? (
              <Text style={[styles.service, { color: t.colors.textMuted }]} numberOfLines={1}>
                {appointment.service_name}
                {appointment.staff_name ? ` · ${appointment.staff_name}` : ''}
                {appointment.loyalty_redeemed ? ' · cadou' : ''}
              </Text>
            ) : appointment.staff_name ? (
              <Text style={[styles.service, { color: t.colors.textMuted }]} numberOfLines={1}>
                {appointment.staff_name}
              </Text>
            ) : null}
            <View style={styles.timeRow}>
              <Ionicons name="calendar-outline" size={14} color={t.colors.textMuted} />
              <Text style={[styles.time, { color: t.colors.text }]} numberOfLines={1}>
                {localLabel ?? fallbackLabel}
              </Text>
            </View>
          </View>
          <Badge tone={appointment.no_show ? 'danger' : meta.tone} dot>
            {appointment.no_show ? 'Nu s-a prezentat' : meta.label}
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

        {paymentLabel(appointment.payment_status, appointment.deposit_ron) ? (
          <Text style={[styles.payHint, { color: t.colors.textMuted }]}>
            {paymentLabel(appointment.payment_status, appointment.deposit_ron)}
          </Text>
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

        {canPostpone ? (
          <ButtonRow>
            <View style={styles.actionFlex}>
              <Button
                label="Amână 1h"
                icon="time-outline"
                variant="secondary"
                size="sm"
                disabled={postponeBusy}
                onPress={() => onPostpone?.(1)}
              />
            </View>
            <View style={styles.actionFlex}>
              <Button
                label="Amână 2h"
                icon="time-outline"
                variant="secondary"
                size="sm"
                disabled={postponeBusy}
                onPress={() => onPostpone?.(2)}
              />
            </View>
          </ButtonRow>
        ) : null}

        {onPayDeposit && appointment.payment_status === 'unpaid' ? (
          <Button
            label={payBusy ? 'Se deschide plata…' : 'Plătește avansul'}
            icon="card-outline"
            size="sm"
            loading={payBusy}
            onPress={onPayDeposit}
          />
        ) : null}

        {onMarkPaid && appointment.payment_status === 'unpaid' ? (
          <ButtonRow>
            <View style={styles.actionFlex}>
              <Button
                label="Avans primit"
                icon="cash-outline"
                variant="secondary"
                size="sm"
                onPress={onMarkPaid}
              />
            </View>
            {onWaiveDeposit ? (
              <View style={styles.actionFlex}>
                <Button
                  label="Scutește"
                  variant="secondary"
                  size="sm"
                  onPress={onWaiveDeposit}
                />
              </View>
            ) : null}
          </ButtonRow>
        ) : null}

        {onMarkNoShow && canMarkNoShow(appointment) ? (
          <Button
            label="Nu s-a prezentat"
            icon="alert-circle-outline"
            variant="danger"
            size="sm"
            onPress={onMarkNoShow}
          />
        ) : null}

        {onClearNoShow && appointment.no_show ? (
          <Button
            label="Anulează absența"
            variant="secondary"
            size="sm"
            onPress={onClearNoShow}
          />
        ) : null}

        {onReview ? (
          <Button
            label={reviewLabel ?? 'Lasă o recenzie'}
            icon="star-outline"
            variant="secondary"
            size="sm"
            onPress={onReview}
          />
        ) : null}

        {canConfirm && onConfirmAttendance ? (
          <Button
            label="Confirm că vin"
            icon="checkmark-circle-outline"
            variant="success"
            size="sm"
            onPress={onConfirmAttendance}
          />
        ) : appointment.attendance_confirmed && appointment.status === 'approved' ? (
          <Text style={[styles.confirmed, { color: t.colors.success }]}>Prezență confirmată</Text>
        ) : null}

        {canReschedule && onReschedule ? (
          <Button
            label="Reprogramează"
            icon="swap-horizontal-outline"
            variant="secondary"
            size="sm"
            onPress={onReschedule}
          />
        ) : null}

        {onDrive && (status === 'pending' || status === 'approved') ? (
          <Button
            label="Condu acum"
            icon="navigate-outline"
            variant="secondary"
            size="sm"
            onPress={onDrive}
          />
        ) : null}

        {onAddToCalendar && status === 'approved' ? (
          <Button
            label="Adaugă în calendar"
            icon="calendar-outline"
            variant="secondary"
            size="sm"
            onPress={onAddToCalendar}
          />
        ) : null}

        {onCancel && canCancel && (status === 'pending' || status === 'approved') ? (
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
  service: { fontSize: fontSize.sm, fontWeight: '600' },
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
  confirmed: { fontSize: fontSize.sm, fontWeight: '600' },
  payHint: { fontSize: fontSize.sm, fontWeight: '600' },
});
