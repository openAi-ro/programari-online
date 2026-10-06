import { useEffect, useRef, useState } from 'react';
import {
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Badge, Button, ButtonRow, useTheme } from '@/components/ui';
import { fontSize, radius, spacing } from '@/constants/theme';
import { STATUS_META } from '@/lib/status';
import { appointmentNextHint } from '@/lib/appointmentNextHint';
import { cancelPolicyLine } from '@/lib/cancelPolicyCopy';
import { canMarkNoShow } from '@/lib/bookingRules';
import type { Appointment } from '@/lib/types';

const POSTPONE_HOURS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
const WHEEL_ITEM_H = 44;
const WHEEL_VISIBLE = 5;
const WHEEL_PAD = ((WHEEL_VISIBLE - 1) / 2) * WHEEL_ITEM_H;

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
  onPostpone?: (hours: number) => void;
  postponeBusy?: boolean;
  onMoveToSlot?: () => void;
  onAddToCalendar?: () => void;
  /** Navigare turn-by-turn — doar dacă business-ul are coordonate GPS. */
  onDrive?: () => void;
  /** Adresa business — afișată în caseta Condu acum. */
  driveAddress?: string;
  onMarkNoShow?: () => void;
  onQuickMessage?: (text: string) => Promise<void>;
  onClearNoShow?: () => void;
  onDelete?: () => void;
  onReview?: () => void;
  reviewLabel?: string;
  cancelNoticeMinutes?: number | null;
  onShare?: () => void;
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
  onMoveToSlot,
  onAddToCalendar,
  onDrive,
  driveAddress,
  onMarkNoShow,
  onQuickMessage,
  onClearNoShow,
  onDelete,
  onReview,
  reviewLabel,
  cancelNoticeMinutes,
  onShare,
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

  const [postponeHours, setPostponeHours] = useState(1);
  const [postponeOpen, setPostponeOpen] = useState(false);
  const [quickText, setQuickText] = useState('');
  const [quickSending, setQuickSending] = useState(false);
  const wheelRef = useRef<ScrollView>(null);
  const prevPostponeBusy = useRef(false);

  useEffect(() => {
    if (!postponeOpen) return;
    const y = (postponeHours - 1) * WHEEL_ITEM_H;
    const t = setTimeout(() => {
      wheelRef.current?.scrollTo({ y, animated: false });
    }, 40);
    return () => clearTimeout(t);
  }, [postponeOpen]);

  useEffect(() => {
    if (prevPostponeBusy.current && !postponeBusy && postponeOpen) {
      setPostponeOpen(false);
    }
    prevPostponeBusy.current = Boolean(postponeBusy);
  }, [postponeBusy, postponeOpen]);

  function onWheelScrollEnd(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const y = e.nativeEvent.contentOffset.y;
    const idx = Math.round(y / WHEEL_ITEM_H);
    const clamped = Math.min(POSTPONE_HOURS.length - 1, Math.max(0, idx));
    const targetY = clamped * WHEEL_ITEM_H;
    const next = POSTPONE_HOURS[clamped]!;
    setPostponeHours(next);
    // Corectează doar dacă snap-ul nativ a rămas între iteme — altfel scrollTo
    // în timpul inerției trage roata înapoi / înainte.
    if (Math.abs(y - targetY) > 0.5) {
      wheelRef.current?.scrollTo({ y: targetY, animated: true });
    }
  }

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

        <Text
          style={[styles.nextStep, { color: t.colors.textMuted }]}
          numberOfLines={2}
        >
          {appointmentNextHint(status, {
            noShow: Boolean(appointment.no_show),
            attendanceConfirmed: Boolean(appointment.attendance_confirmed),
            canCancel: Boolean(onCancel && canCancel && (status === 'pending' || status === 'approved')),
            canReschedule: Boolean(canReschedule && onReschedule),
          })}
        </Text>

        {contact ? (
          <View style={styles.contactRow}>
            <Ionicons name="person-outline" size={13} color={t.colors.textFaint} />
            <Text style={[styles.contact, { color: t.colors.textMuted }]} numberOfLines={1}>
              {contact}
            </Text>
          </View>
        ) : null}


        {/* P0: cancel + reschedule easy to find (client) */}
        {!showActions &&
        ((canReschedule && onReschedule) ||
          (onCancel && canCancel && (status === 'pending' || status === 'approved'))) ? (
          confirming && onCancel && canCancel && (status === 'pending' || status === 'approved') ? (
            <View style={[styles.confirmBox, { borderTopColor: t.colors.border }]}>
              <Text style={[styles.confirmText, { color: t.colors.textMuted }]} numberOfLines={3}>
                {cancelPolicyLine({
                  cancelNoticeMinutes,
                })}
              </Text>
              <Text style={[styles.confirmText, { color: t.colors.textMuted }]} numberOfLines={2}>
                Slotul va fi eliberat. Sigur anulezi?
              </Text>
              <ButtonRow>
                <View style={styles.actionFlex}>
                  <Button
                    label="Renunță"
                    variant="secondary"
                    size="sm"
                    contentAlign="start"
                    labelNumberOfLines={1}
                    onPress={() => setConfirming(false)}
                  />
                </View>
                <View style={styles.actionFlex}>
                  <Button
                    label="Anulează"
                    icon="trash-outline"
                    variant="danger"
                    size="sm"
                    contentAlign="start"
                    labelNumberOfLines={1}
                    onPress={doCancel}
                  />
                </View>
              </ButtonRow>
            </View>
          ) : (
            <ButtonRow>
              {canReschedule && onReschedule ? (
                <View style={styles.actionFlex}>
                  <Button
                    label="Reprogramează"
                    icon="swap-horizontal-outline"
                    variant="secondary"
                    size="sm"
                    contentAlign="start"
                    labelNumberOfLines={1}
                    onPress={onReschedule}
                  />
                </View>
              ) : null}
              {onCancel && canCancel && (status === 'pending' || status === 'approved') ? (
                <View style={styles.actionFlex}>
                  <Button
                    label="Anulează"
                    icon="close-circle-outline"
                    variant="danger"
                    size="sm"
                    contentAlign="start"
                    labelNumberOfLines={1}
                    onPress={() => setConfirming(true)}
                  />
                </View>
              ) : null}
            </ButtonRow>
          )
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
          <Button
            label="Amână"
            icon="time-outline"
            variant="secondary"
            size="sm"
            onPress={() => setPostponeOpen(true)}
          />
        ) : null}
        {showActions && onMoveToSlot && (status === 'approved' || status === 'pending') ? (
          <Button
            label="Mută pe slot"
            icon="swap-horizontal-outline"
            variant="secondary"
            size="sm"
            onPress={onMoveToSlot}
          />
        ) : null}

        <Modal
          visible={postponeOpen}
          animationType="fade"
          transparent
          onRequestClose={() => !postponeBusy && setPostponeOpen(false)}
          statusBarTranslucent
        >
          <View style={[styles.modalBackdrop, { backgroundColor: t.colors.overlay }]}>
            <View style={[styles.modalCard, { backgroundColor: t.colors.bgElevated, borderColor: t.colors.border }]}>
              <View style={styles.modalHead}>
                <Text style={[styles.modalTitle, { color: t.colors.text }]} numberOfLines={2}>Amână</Text>
                <Pressable
                  onPress={() => !postponeBusy && setPostponeOpen(false)}
                  accessibilityRole="button"
                  accessibilityLabel="Închide"
                  hitSlop={8}
                  disabled={Boolean(postponeBusy)}
                >
                  <Ionicons name="close" size={22} color={t.colors.textMuted} />
                </Pressable>
              </View>
              <Text
                style={[styles.modalHint, { color: t.colors.textMuted }]}
                numberOfLines={3}
              >
                Alege cu câte ore amâni. Derulează roata sus / jos.
              </Text>

              <View style={[styles.wheelWrap, { backgroundColor: t.colors.surfaceMuted, borderColor: t.colors.border }]}>
                <View
                  pointerEvents="none"
                  style={[
                    styles.wheelHighlight,
                    {
                      borderColor: t.colors.accent,
                      backgroundColor: t.colors.accentSoft,
                      top: WHEEL_PAD,
                      height: WHEEL_ITEM_H,
                    },
                  ]}
                />
                <ScrollView
                  ref={wheelRef}
                  showsVerticalScrollIndicator={false}
                  snapToInterval={WHEEL_ITEM_H}
                  snapToAlignment="start"
                  disableIntervalMomentum
                  decelerationRate="fast"
                  bounces={false}
                  overScrollMode="never"
                  nestedScrollEnabled
                  onMomentumScrollEnd={onWheelScrollEnd}
                  style={{ height: WHEEL_ITEM_H * WHEEL_VISIBLE }}
                >
                  {/* Spacer-e ca iteme (nu paddingVertical) — pe Android snap + padding sare. */}
                  <View style={{ height: WHEEL_PAD }} />
                  {POSTPONE_HOURS.map((h) => {
                    const selected = h === postponeHours;
                    return (
                      <View key={h} style={[styles.wheelItem, { height: WHEEL_ITEM_H }]}>
                        <Text
                          style={[
                            styles.wheelText,
                            {
                              color: selected ? t.colors.accentSoftText : t.colors.textMuted,
                              fontWeight: selected ? '800' : '600',
                              fontSize: fontSize.lg,
                            },
                          ]}
                          numberOfLines={1}
                          adjustsFontSizeToFit
                          minimumFontScale={0.85}
                        >
                          {h} {h === 1 ? 'oră' : 'ore'}
                        </Text>
                      </View>
                    );
                  })}
                  <View style={{ height: WHEEL_PAD }} />
                </ScrollView>
              </View>

              <ButtonRow>
                <View style={styles.actionFlex}>
                  <Button
                    label="Anulează"
                    variant="secondary"
                    size="sm"
                    disabled={Boolean(postponeBusy)}
                    onPress={() => setPostponeOpen(false)}
                  />
                </View>
                <View style={styles.actionFlex}>
                  <Button
                    label="Confirmă"
                    icon="checkmark"
                    variant="primary"
                    size="sm"
                    disabled={Boolean(postponeBusy)}
                    loading={Boolean(postponeBusy)}
                    onPress={() => onPostpone?.(postponeHours)}
                  />
                </View>
              </ButtonRow>
            </View>
          </View>
        </Modal>


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

        {onDelete ? (
          <Button
            label="Șterge ședința și chatul"
            icon="trash-outline"
            variant="danger"
            size="sm"
            onPress={onDelete}
          />
        ) : null}

        {onReview ? (
          <Button
            label={reviewLabel ?? 'Lasă o recenzie'}
            icon="star-outline"
            variant="secondary"
            size="sm"
            contentAlign="start"
            labelNumberOfLines={1}
            onPress={onReview}
          />
        ) : null}

        {onQuickMessage ? (
          <View
            style={[
              styles.chatSection,
              {
                borderTopColor: t.colors.border,
                borderColor: t.colors.border,
                backgroundColor: t.colors.surfaceMuted,
              },
            ]}
          >
            <View style={styles.chatSectionHead}>
              <Ionicons name="chatbubble-ellipses-outline" size={16} color={t.colors.info} />
              <Text style={[styles.chatSectionTitle, { color: t.colors.text }]}>
                Mesaj chat
              </Text>
            </View>
            <Text style={[styles.chatSectionHint, { color: t.colors.textFaint }]}>
              Independent de Amână — trimite doar în conversația cu clientul.
            </Text>
            <TextInput
              placeholder="Scrie mesajul pentru client…"
              placeholderTextColor={t.colors.textFaint}
              value={quickText}
              onChangeText={setQuickText}
              style={[styles.quickInput, { color: t.colors.text, borderColor: t.colors.border, backgroundColor: t.colors.surface }]}
              multiline
              maxLength={4000}
            />
            <Button
              label="Trimite mesaj"
              icon="send-outline"
              size="sm"
              variant="secondary"
              loading={quickSending}
              disabled={!quickText.trim() || quickSending}
              onPress={async () => {
                const txt = quickText.trim();
                if (!txt) return;
                setQuickSending(true);
                try { await onQuickMessage(txt); setQuickText(''); } finally { setQuickSending(false); }
              }}
            />
          </View>
        ) : null}

        {canConfirm && onConfirmAttendance ? (
          <Button
            label="Confirmă că ajung"
            icon="checkmark-circle-outline"
            variant="success"
            size="md"
            contentAlign="start"
            labelNumberOfLines={1}
            onPress={onConfirmAttendance}
          />
        ) : appointment.attendance_confirmed && appointment.status === 'approved' ? (
          <Text style={[styles.confirmed, { color: t.colors.success }]}>Prezență confirmată</Text>
        ) : null}

        {/* Reschedule already in primary ButtonRow for client (!showActions) */}
        {showActions && canReschedule && onReschedule ? (
          <Button
            label="Reprogramează"
            icon="swap-horizontal-outline"
            variant="secondary"
            size="sm"
            onPress={onReschedule}
          />
        ) : null}

        {onDrive && status === 'approved' ? (
          <View
            style={[
              styles.driveBox,
              {
                borderColor: t.colors.border,
                backgroundColor: t.colors.accentSoft,
              },
            ]}
          >
            <View style={styles.driveHead}>
              <Ionicons name="navigate-outline" size={18} color={t.colors.accentSoftText} />
              <Text style={[styles.driveTitle, { color: t.colors.accentSoftText }]} numberOfLines={1}>
                Condu acum
              </Text>
            </View>
            {driveAddress ? (
              <Text style={[styles.driveAddress, { color: t.colors.text }]} numberOfLines={3}>
                {driveAddress}
              </Text>
            ) : (
              <Text style={[styles.driveAddress, { color: t.colors.textMuted }]} numberOfLines={2}>
                Deschide meniul telefonului cu aplicațiile de navigație.
              </Text>
            )}
            <Button
              label="Deschide navigația"
              icon="map-outline"
              variant="primary"
              size="sm"
              contentAlign="start"
              labelNumberOfLines={1}
              onPress={onDrive}
            />
          </View>
        ) : null}

        {onAddToCalendar && status === 'approved' ? (
          <Button
            label="Adaugă în calendar"
            icon="calendar-outline"
            variant="secondary"
            size="sm"
            contentAlign="start"
            labelNumberOfLines={1}
            onPress={onAddToCalendar}
          />
        ) : null}

        {onShare ? (
          <Button
            label="Distribuie"
            icon="share-outline"
            variant="secondary"
            size="sm"
            contentAlign="start"
            labelNumberOfLines={1}
            onPress={onShare}
          />
        ) : null}

        {showActions && onCancel && canCancel && (status === 'pending' || status === 'approved') ? (
          confirming ? (
            <View style={[styles.confirmBox, { borderTopColor: t.colors.border }]}>
              <Text style={[styles.confirmText, { color: t.colors.textMuted }]} numberOfLines={3}>
                {cancelPolicyLine({
                  cancelNoticeMinutes,
                })}
              </Text>
              <Text style={[styles.confirmText, { color: t.colors.textMuted }]} numberOfLines={2}>
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
  headText: { flex: 1, minWidth: 0, gap: 4 },
  title: { fontSize: fontSize.md, fontWeight: '700' },
  service: { fontSize: fontSize.sm, fontWeight: '600' },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  time: { fontSize: fontSize.md, fontWeight: '600', flexShrink: 1 },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  contact: { fontSize: fontSize.sm, flexShrink: 1 },
  nextStep: { fontSize: fontSize.sm, flexShrink: 1, marginTop: 2 },
  actionFlex: { flex: 1, minWidth: 0 },
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
  modalBackdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
  },
  modalCard: {
    width: '78%',
    maxWidth: 360,
    minWidth: 260,
    alignSelf: 'center',
    borderRadius: radius.xl,
    borderWidth: 1,
    padding: spacing.lg,
    gap: spacing.md,
    overflow: 'hidden',
  },
  modalHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  modalTitle: {
    fontSize: fontSize.lg,
    fontWeight: '800',
    flexShrink: 1,
    flexGrow: 1,
    paddingRight: spacing.sm,
  },
  modalHint: {
    fontSize: fontSize.sm,
    lineHeight: 18,
    flexShrink: 1,
  },
  wheelWrap: {
    borderWidth: 1,
    borderRadius: radius.lg,
    overflow: 'hidden',
    position: 'relative',
    alignSelf: 'stretch',
  },
  wheelHighlight: {
    position: 'absolute',
    left: spacing.sm,
    right: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    zIndex: 1,
  },
  wheelItem: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    overflow: 'hidden',
  },
  wheelText: {
    textAlign: 'center',
    width: '100%',
    paddingHorizontal: spacing.sm,
  },
  driveBox: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
    overflow: 'hidden',
  },
  driveHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  driveTitle: { fontSize: fontSize.md, fontWeight: '800', flexShrink: 1 },
  driveAddress: { fontSize: fontSize.sm, lineHeight: 18, flexShrink: 1 },
  chatSection: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
    overflow: 'hidden',
  },
  chatSectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  chatSectionTitle: { fontSize: fontSize.md, fontWeight: '700', flexShrink: 1 },
  chatSectionHint: { fontSize: fontSize.xs, lineHeight: 16, flexShrink: 1 },
  quickInput: {
    minHeight: 48,
    fontSize: fontSize.sm,
    textAlignVertical: 'top',
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
});
