import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Button, Field, SectionTitle, useTheme } from '@/components/ui';
import { fontSize, radius, spacing } from '@/constants/theme';
import { confirmDialog } from '@/lib/dialog';
import { formatRon } from '@/lib/format';
import {
  formatGiftCode,
  giftCardDisplayStatus,
  isValidGiftAmount,
  mapGiftRpcError,
  type GiftCardDisplayStatus,
  type GiftCardKind,
} from '@/lib/giftCard';
import { trKey, useT, type TrKey } from '@/lib/i18n';
import { shareText } from '@/lib/shareBusiness';
import { supabase } from '@/lib/supabase';
import type { GiftCard } from '@/lib/types';

type ServiceOption = { id: string; name: string; price: number };

type Props = {
  businessId: string;
  cards: GiftCard[];
  services: ServiceOption[];
  onChanged: () => Promise<void>;
  onError: (message: string | null) => void;
  onMessage: (message: string | null) => void;
};

function statusLabel(status: GiftCardDisplayStatus, tr: (key: TrKey) => string): string {
  if (status === 'redeemed') return tr('pkg.giftStatusRedeemed');
  if (status === 'cancelled') return tr('pkg.giftStatusCancelled');
  if (status === 'expired') return tr('pkg.giftStatusExpired');
  return tr('pkg.giftStatusActive');
}

export function GiftCardsSection({
  businessId,
  cards,
  services,
  onChanged,
  onError,
  onMessage,
}: Props) {
  const t = useTheme();
  const tr = useT();
  const [kind, setKind] = useState<GiftCardKind>('amount');
  const [giftAmount, setGiftAmount] = useState('');
  const [giftRecipient, setGiftRecipient] = useState('');
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const activeServices = useMemo(
    () => services.slice().sort((a, b) => a.name.localeCompare(b.name)),
    [services]
  );

  async function createGiftCard() {
    if (busy) return;
    const amount =
      kind === 'amount' ? Number(String(giftAmount).replace(',', '.')) : null;
    if (kind === 'amount' && !isValidGiftAmount(amount ?? NaN)) {
      onError(trKey('pkg.giftAmount'));
      return;
    }
    if (kind === 'service' && !serviceId) {
      onError(trKey('pkg.giftPickService'));
      return;
    }
    setBusy(true);
    onError(null);
    const { data, error: err } = await supabase.rpc('create_gift_card', {
      p_business_id: businessId,
      p_kind: kind,
      p_amount: kind === 'amount' ? amount : null,
      p_service_id: kind === 'service' ? serviceId : null,
      p_recipient_name: giftRecipient.trim() || null,
    });
    setBusy(false);
    if (err) {
      onError(mapGiftRpcError(err.message));
      return;
    }
    const row = (Array.isArray(data) ? data[0] : data) as GiftCard | null;
    setGiftAmount('');
    setGiftRecipient('');
    setServiceId(null);
    onMessage(
      trKey('pkg.giftCreated', { code: formatGiftCode(row?.code ?? '') })
    );
    await onChanged();
  }

  async function redeemGiftCard(card: GiftCard) {
    const ok = await confirmDialog({
      title: trKey('pkg.giftRedeemConfirmTitle'),
      message: trKey('pkg.giftRedeemConfirmBody', {
        code: formatGiftCode(card.code),
      }),
      confirmText: trKey('pkg.giftRedeem'),
      cancelText: trKey('common.cancel'),
    });
    if (!ok) return;
    onError(null);
    const { error: err } = await supabase.rpc('redeem_gift_card', {
      p_gift_card_id: card.id,
      p_appointment_id: null,
    });
    if (err) {
      onError(mapGiftRpcError(err.message));
      return;
    }
    onMessage(trKey('pkg.giftRedeemedOk'));
    await onChanged();
  }

  async function cancelGiftCard(card: GiftCard) {
    const ok = await confirmDialog({
      title: trKey('pkg.giftCancelConfirmTitle'),
      message: trKey('pkg.giftCancelConfirmBody', {
        code: formatGiftCode(card.code),
      }),
      confirmText: trKey('pkg.giftCancel'),
      cancelText: trKey('common.cancel'),
      destructive: true,
    });
    if (!ok) return;
    onError(null);
    const { error: err } = await supabase.rpc('cancel_gift_card', {
      p_gift_card_id: card.id,
    });
    if (err) {
      onError(mapGiftRpcError(err.message));
      return;
    }
    onMessage(trKey('pkg.giftCancelledOk'));
    await onChanged();
  }

  async function shareGiftCode(card: GiftCard) {
    const message = trKey('pkg.giftShareText', {
      code: formatGiftCode(card.code),
      value:
        card.kind === 'service'
          ? card.services?.name || trKey('pkg.giftKindService')
          : formatRon(card.amount),
    });
    try {
      const outcome = await shareText(message);
      if (outcome === 'copied') onMessage(trKey('pkg.giftCodeCopied'));
    } catch {
      onError(trKey('my.shareFailed'));
    }
  }

  const kindOptions: Array<{ value: GiftCardKind; labelKey: TrKey }> = [
    { value: 'amount', labelKey: 'pkg.giftKindAmount' },
    { value: 'service', labelKey: 'pkg.giftKindService' },
  ];

  return (
    <>
      <SectionTitle>{tr('pkg.giftTitle')}</SectionTitle>
      <View style={[styles.panel, { backgroundColor: t.colors.surface, borderColor: t.colors.border }]}>
        <Text style={[styles.meta, { color: t.colors.textMuted }]}>{tr('pkg.giftKind')}</Text>
        <View style={styles.chips}>
          {kindOptions.map((opt) => (
            <Pressable
              key={opt.value}
              onPress={() => setKind(opt.value)}
              style={[
                styles.chip,
                {
                  backgroundColor: kind === opt.value ? t.colors.accentSoft : t.colors.surface,
                  borderColor: kind === opt.value ? t.colors.accent : t.colors.border,
                },
              ]}
            >
              <Text style={{ color: t.colors.text }}>{tr(opt.labelKey)}</Text>
            </Pressable>
          ))}
        </View>

        {kind === 'amount' ? (
          <Field
            label={tr('pkg.giftAmount')}
            value={giftAmount}
            onChangeText={setGiftAmount}
            keyboardType="decimal-pad"
          />
        ) : (
          <>
            <Text style={[styles.meta, { color: t.colors.textMuted }]}>{tr('pkg.giftPickService')}</Text>
            <View style={styles.chips}>
              {activeServices.length === 0 ? (
                <Text style={[styles.meta, { color: t.colors.textMuted }]}>{tr('pkg.giftNoServices')}</Text>
              ) : (
                activeServices.map((s) => (
                  <Pressable
                    key={s.id}
                    onPress={() => setServiceId(s.id)}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: serviceId === s.id ? t.colors.accentSoft : t.colors.surface,
                        borderColor: serviceId === s.id ? t.colors.accent : t.colors.border,
                      },
                    ]}
                  >
                    <Text style={{ color: t.colors.text }}>
                      {s.name} · {formatRon(s.price)}
                    </Text>
                  </Pressable>
                ))
              )}
            </View>
          </>
        )}

        <Field label={tr('pkg.giftRecipient')} value={giftRecipient} onChangeText={setGiftRecipient} />
        <Text style={[styles.meta, { color: t.colors.textMuted }]}>{tr('pkg.giftExpiryHint')}</Text>
        <Button
          label={tr('pkg.giftCreate')}
          icon="gift-outline"
          disabled={busy}
          onPress={() => void createGiftCard()}
        />

        {cards.length === 0 ? (
          <Text style={[styles.meta, { color: t.colors.textMuted }]}>{tr('pkg.giftEmpty')}</Text>
        ) : (
          cards.map((card) => {
            const display = giftCardDisplayStatus(card);
            const canAct = display === 'active';
            return (
              <View key={card.id} style={styles.issuedRow}>
                <Text style={[styles.meta, { color: t.colors.text }]}>
                  {tr('pkg.giftCode', { code: formatGiftCode(card.code) })}
                  {card.recipient_name ? ` · ${card.recipient_name}` : ''}
                </Text>
                <Text style={[styles.meta, { color: t.colors.textMuted }]}>
                  {card.kind === 'service'
                    ? tr('pkg.giftServiceValue', {
                        service: card.services?.name || tr('pkg.giftKindService'),
                      })
                    : tr('pkg.giftAmountValue', { amount: formatRon(card.amount) })}
                  {' · '}
                  {statusLabel(display, tr)}
                  {card.expires_at
                    ? ` · ${tr('pkg.giftExpires', {
                        date: new Date(card.expires_at).toLocaleDateString(),
                      })}`
                    : ` · ${tr('pkg.giftNoExpiry')}`}
                </Text>
                <View style={styles.btnRow}>
                  <Button
                    label={tr('pkg.giftShare')}
                    size="sm"
                    variant="secondary"
                    onPress={() => void shareGiftCode(card)}
                  />
                  {canAct ? (
                    <>
                      <Button
                        label={tr('pkg.giftRedeem')}
                        size="sm"
                        variant="secondary"
                        onPress={() => void redeemGiftCard(card)}
                      />
                      <Button
                        label={tr('pkg.giftCancel')}
                        size="sm"
                        variant="secondary"
                        onPress={() => void cancelGiftCard(card)}
                      />
                    </>
                  ) : null}
                </View>
              </View>
            );
          })
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  panel: { gap: spacing.sm, padding: spacing.lg, borderRadius: radius.lg, borderWidth: 1 },
  meta: { fontSize: fontSize.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  issuedRow: { gap: spacing.xs, paddingVertical: spacing.sm },
  btnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
