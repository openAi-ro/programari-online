import { useEffect, useRef, useState } from 'react';
import {
  Linking,
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
import { statusMeta } from '@/lib/status';
import { appointmentNextHint } from '@/lib/appointmentNextHint';
import { cancelPolicyLine } from '@/lib/cancelPolicyCopy';
import { canMarkNoShow } from '@/lib/bookingRules';
import { localeTag, useT } from '@/lib/i18n';
import type { Appointment } from '@/lib/types';
import { telUrl, whatsAppUrl } from '@/lib/businessPage';
import { hasPendingReschedule } from '@/lib/rescheduleRequest';

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
  onWaiveDeposit?: () => void;
  onCancelSeries?: () => void;
  onClearNoShow?: () => void;
  onDelete?: () => void;
  onReview?: () => void;
  reviewLabel?: string;
  onGoogleReview?: () => void;
  onCheckIn?: () => void;
  checkInLoading?: boolean;
  checkedIn?: boolean;
  cancelNoticeMinutes?: number | null;
  onShare?: () => void;
  /** v87 (business): cererea de reprogramare a clientului. */
  onAcceptReschedule?: () => void;
  onDeclineReschedule?: () => void;
  rescheduleBusy?: boolean;
  /** Ora ceruta formatata in fusul business-ului (altfel locala). */
  requestedLabel?: string;
  /** v87 (business): anulare cu motiv, vazut de client. */
  onBusinessCancel?: (reason: string) => void;
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
  onWaiveDeposit,
  onCancelSeries,
  onClearNoShow,
  onDelete,
  onReview,
  reviewLabel,
  onGoogleReview,
  onCheckIn,
  checkInLoading,
  checkedIn,
  cancelNoticeMinutes,
  onShare,
  onAcceptReschedule,
  onDeclineReschedule,
  rescheduleBusy,
  requestedLabel,
  onBusinessCancel,
}: Props) {
  const t = useTheme();
  const tr = useT();
  const status = appointment.status;
  const meta = statusMeta(status);

  const fallbackLabel = `${new Date(appointment.start_at).toLocaleString(localeTag())} – ${new Date(
    appointment.end_at
  ).toLocaleTimeString(localeTag(), { hour: '2-digit', minute: '2-digit' })}`;

  const contact = [appointment.client_email, appointment.client_phone]
    .filter(Boolean)
    .join(' · ');

  const [confirming, setConfirming] = useState(false);
  const [bizCancelOpen, setBizCancelOpen] = useState(false);
  const [bizCancelReason, setBizCancelReason] = useState('');
  const active = status === 'pending' || status === 'approved';
  const pendingRequest = hasPendingReschedule(appointment);
  const requestedText =
    requestedLabel ??
    (appointment.requested_start_at
      ? new Date(appointment.requested_start_at).toLocaleString(localeTag(), {
          dateStyle: 'medium',
          timeStyle: 'short',
        })
      : '');
  const phoneTel = showActions ? telUrl(appointment.client_phone) : null;
  const phoneWa = showActions ? whatsAppUrl(appointment.client_phone) : null;

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
                {appointment.loyalty_redeemed ? tr('appt.giftSuffix') : ''}
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
            {appointment.no_show ? tr('appt.noShowBadge') : meta.label}
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

        {phoneTel || phoneWa ? (
          <ButtonRow>
            {phoneTel ? (
              <View style={styles.actionFlex}>
                <Button
                  label={tr('appt.call')}
                  icon="call-outline"
                  variant="secondary"
                  size="sm"
                  labelNumberOfLines={1}
                  onPress={() => void Linking.openURL(phoneTel)}
                />
              </View>
            ) : null}
            {phoneWa ? (
              <View style={styles.actionFlex}>
                <Button
                  label={tr('appt.whatsapp')}
                  icon="logo-whatsapp"
                  variant="secondary"
                  size="sm"
                  labelNumberOfLines={1}
                  onPress={() => void Linking.openURL(phoneWa)}
                />
              </View>
            ) : null}
          </ButtonRow>
        ) : null}

        {pendingRequest ? (
          <View
            style={[
              styles.requestBox,
              { borderColor: t.colors.warning, backgroundColor: t.colors.surfaceMuted },
            ]}
          >
            <View style={styles.contactRow}>
              <Ionicons name="swap-horizontal-outline" size={14} color={t.colors.warning} />
              <Text style={[styles.requestText, { color: t.colors.text }]} numberOfLines={3}>
                {showActions
                  ? tr('appt.rescheduleRequested', { from: localLabel ?? fallbackLabel, to: requestedText })
                  : tr('appt.rescheduleWaiting', { to: requestedText })}
              </Text>
            </View>
            {showActions && (onAcceptReschedule || onDeclineReschedule) ? (
              <ButtonRow>
                <View style={styles.actionFlex}>
                  <Button
                    label={tr('appt.declineRequest')}
                    icon="close"
                    variant="secondary"
                    size="sm"
                    disabled={Boolean(rescheduleBusy)}
                    onPress={onDeclineReschedule}
                  />
                </View>
                <View style={styles.actionFlex}>
                  <Button
                    label={tr('appt.accept')}
                    icon="checkmark"
                    variant="success"
                    size="sm"
                    loading={Boolean(rescheduleBusy)}
                    disabled={Boolean(rescheduleBusy)}
                    onPress={onAcceptReschedule}
                  />
                </View>
              </ButtonRow>
            ) : null}
          </View>
        ) : null}

        {status === 'cancelled' && appointment.cancel_reason ? (
          <Text style={[styles.nextStep, { color: t.colors.textMuted }]} numberOfLines={3}>
            {tr('appt.cancelReasonLine', { reason: appointment.cancel_reason })}
          </Text>
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
                {tr('appt.confirmCancel')}
              </Text>
              <ButtonRow>
                <View style={styles.actionFlex}>
                  <Button
                    label={tr('appt.giveUp')}
                    variant="secondary"
                    size="sm"
                    contentAlign="start"
                    labelNumberOfLines={1}
                    onPress={() => setConfirming(false)}
                  />
                </View>
                <View style={styles.actionFlex}>
                  <Button
                    label={tr('common.cancel')}
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
                    label={tr('appt.reschedule')}
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
                    label={tr('common.cancel')}
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
                label={tr('appt.reject')}
                icon="close"
                variant="secondary"
                size="sm"
                onPress={onReject}
              />
            </View>
            <View style={styles.actionFlex}>
              <Button
                label={tr('appt.approve')}
                icon="checkmark"
                variant="success"
                size="sm"
                onPress={onApprove}
              />
            </View>
          </ButtonRow>
        ) : null}

        {showActions && onMoveToSlot && (status === 'approved' || status === 'pending') ? (
          <Button
            label={tr('appt.moveToSlot')}
            icon="swap-horizontal-outline"
            variant="secondary"
            size="sm"
            onPress={onMoveToSlot}
          />
        ) : null}
        {canPostpone ? (
          <Button
            label={tr('appt.postpone')}
            icon="time-outline"
            variant="secondary"
            size="sm"
            onPress={() => setPostponeOpen(true)}
          />
        ) : null}
        {showActions && onBusinessCancel && active ? (
          bizCancelOpen ? (
            <View style={[styles.confirmBox, { borderTopColor: t.colors.border }]}>
              <Text style={[styles.confirmText, { color: t.colors.textMuted }]} numberOfLines={3}>
                {tr('appt.bizCancelHint')}
              </Text>
              <TextInput
                value={bizCancelReason}
                onChangeText={setBizCancelReason}
                placeholder={tr('appt.bizCancelPlaceholder')}
                placeholderTextColor={t.colors.textFaint}
                maxLength={300}
                multiline
                style={[
                  styles.reasonInput,
                  { color: t.colors.text, borderColor: t.colors.border, backgroundColor: t.colors.surfaceMuted },
                ]}
              />
              <ButtonRow>
                <View style={styles.actionFlex}>
                  <Button
                    label={tr('appt.giveUp')}
                    variant="secondary"
                    size="sm"
                    labelNumberOfLines={1}
                    onPress={() => setBizCancelOpen(false)}
                  />
                </View>
                <View style={styles.actionFlex}>
                  <Button
                    label={tr('appt.bizCancelConfirm')}
                    icon="close-circle-outline"
                    variant="danger"
                    size="sm"
                    labelNumberOfLines={1}
                    disabled={bizCancelReason.trim().length === 0}
                    onPress={() => {
                      setBizCancelOpen(false);
                      onBusinessCancel(bizCancelReason.trim());
                    }}
                  />
                </View>
              </ButtonRow>
            </View>
          ) : (
            <Button
              label={tr('appt.bizCancel')}
              icon="close-circle-outline"
              variant="secondary"
              size="sm"
              onPress={() => setBizCancelOpen(true)}
            />
          )
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
                <Text style={[styles.modalTitle, { color: t.colors.text }]} numberOfLines={2}>{tr('appt.postpone')}</Text>
                <Pressable
                  onPress={() => !postponeBusy && setPostponeOpen(false)}
                  accessibilityRole="button"
                  accessibilityLabel={tr('common.close')}
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
                {tr('appt.postponeHint')}
              </Text>

              <View style={[styles.wheelWrap, { backgroundColor: t.colors.surfaceMuted, borderColor: t.colors.border }]}>
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
                      <View
                        key={h}
                        style={[
                          styles.wheelItem,
                          { height: WHEEL_ITEM_H },
                          selected && [
                            styles.wheelItemSelected,
                            { borderColor: t.colors.accent, backgroundColor: t.colors.accentSoft },
                          ],
                        ]}
                      >
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
                          {h} {h === 1 ? tr('duration.unitHourOne') : tr('duration.unitHours')}
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
                    label={tr('common.cancel')}
                    variant="secondary"
                    size="sm"
                    disabled={Boolean(postponeBusy)}
                    onPress={() => setPostponeOpen(false)}
                  />
                </View>
                <View style={styles.actionFlex}>
                  <Button
                    label={tr('appt.confirm')}
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
            label={tr('appt.markNoShow')}
            icon="alert-circle-outline"
            variant="danger"
            size="sm"
            onPress={onMarkNoShow}
          />
        ) : null}

        {onClearNoShow && appointment.no_show ? (
          <Button
            label={tr('appt.clearNoShow')}
            variant="secondary"
            size="sm"
            onPress={onClearNoShow}
          />
        ) : null}

        {onDelete ? (
          <Button
            label={tr('appt.deleteSession')}
            icon="trash-outline"
            variant="danger"
            size="sm"
            onPress={onDelete}
          />
        ) : null}

        {onCancelSeries && appointment.recurring_series_id && (status === 'pending' || status === 'approved') ? (
          <Button
            label={`${tr('appt.series')} · ${tr('appt.cancelSeries')}`}
            icon="repeat-outline"
            variant="secondary"
            size="sm"
            contentAlign="start"
            labelNumberOfLines={1}
            onPress={onCancelSeries}
          />
        ) : null}

        {onWaiveDeposit && appointment.payment_status === 'unpaid' && (appointment.deposit_ron ?? 0) > 0 ? (
          <Button
            label={tr('pay.waiveDeposit')}
            icon="cash-outline"
            variant="secondary"
            size="sm"
            contentAlign="start"
            labelNumberOfLines={1}
            onPress={onWaiveDeposit}
          />
        ) : null}

        {onReview ? (
          <Button
            label={reviewLabel ?? tr('appt.leaveReview')}
            icon="star-outline"
            variant="secondary"
            size="sm"
            contentAlign="start"
            labelNumberOfLines={1}
            onPress={onReview}
          />
        ) : null}
        {onGoogleReview ? (
          <Button
            label={tr('appt.googleReview')}
            icon="logo-google"
            variant="secondary"
            size="sm"
            contentAlign="start"
            labelNumberOfLines={1}
            onPress={onGoogleReview}
          />
        ) : null}
        {checkedIn ? (
          <Text style={[styles.payHint, { color: t.colors.accent }]}>{tr('appt.checkedIn')}</Text>
        ) : onCheckIn ? (
          <Button
            label={tr('appt.checkIn')}
            icon="checkmark-circle-outline"
            variant="secondary"
            size="sm"
            contentAlign="start"
            labelNumberOfLines={1}
            loading={checkInLoading}
            onPress={onCheckIn}
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
                {tr('appt.chatMessage')}
              </Text>
            </View>
            <Text style={[styles.chatSectionHint, { color: t.colors.textFaint }]}>
              {tr('appt.chatHint')}
            </Text>
            <TextInput
              placeholder={tr('appt.writeToClient')}
              placeholderTextColor={t.colors.textFaint}
              value={quickText}
              onChangeText={setQuickText}
              style={[styles.quickInput, { color: t.colors.text, borderColor: t.colors.border, backgroundColor: t.colors.surface }]}
              multiline
              maxLength={4000}
            />
            <Button
              label={tr('appt.sendMessage')}
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
            label={tr('appt.confirmAttendance')}
            icon="checkmark-circle-outline"
            variant="success"
            size="md"
            contentAlign="start"
            labelNumberOfLines={1}
            onPress={onConfirmAttendance}
          />
        ) : appointment.attendance_confirmed && appointment.status === 'approved' && !checkedIn ? (
          <Text style={[styles.confirmed, { color: t.colors.success }]}>{tr('appt.attendanceConfirmed')}</Text>
        ) : null}

        {/* Reschedule already in primary ButtonRow for client (!showActions) */}
        {showActions && canReschedule && onReschedule ? (
          <Button
            label={tr('appt.reschedule')}
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
                {tr('appt.driveNow')}
              </Text>
            </View>
            {driveAddress ? (
              <Text style={[styles.driveAddress, { color: t.colors.text }]} numberOfLines={3}>
                {driveAddress}
              </Text>
            ) : (
              <Text style={[styles.driveAddress, { color: t.colors.textMuted }]} numberOfLines={2}>
                {tr('appt.driveHint')}
              </Text>
            )}
            <Button
              label={tr('appt.openNav')}
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
            label={tr('appt.addToCalendar')}
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
            label={tr('appt.share')}
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
                {tr('appt.confirmCancel')}
              </Text>
              <ButtonRow>
                <View style={styles.actionFlex}>
                  <Button
                    label={tr('appt.giveUp')}
                    variant="secondary"
                    size="sm"
                    onPress={() => setConfirming(false)}
                  />
                </View>
                <View style={styles.actionFlex}>
                  <Button
                    label={tr('common.cancel')}
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
                {tr('appt.cancelBooking')}
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
  requestBox: { borderWidth: 1, borderRadius: radius.md, padding: spacing.sm, gap: spacing.sm },
  requestText: { fontSize: fontSize.sm, fontWeight: '600', flexShrink: 1 },
  reasonInput: { borderWidth: 1, borderRadius: radius.md, padding: spacing.sm, minHeight: 64, fontSize: fontSize.md, textAlignVertical: 'top' },
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
    alignSelf: 'stretch',
  },
  wheelItem: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    overflow: 'hidden',
  },
  // Randul ales isi poarta singur evidentierea: un strat absolut peste lista acoperea ora aleasa
  // (fundalul accentSoft e opac pe tema deschisa).
  wheelItemSelected: {
    marginHorizontal: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
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
