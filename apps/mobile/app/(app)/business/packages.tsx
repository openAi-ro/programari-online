import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';

import {
  Button,
  Callout,
  EmptyState,
  Field,
  ListLoadingScreen,
  Screen,
  SectionTitle,
  useTheme,
} from '@/components/ui';
import { fontSize, radius, spacing } from '@/constants/theme';
import { formatRon } from '@/lib/format';
import {
  applyGiftRedemption,
  formatGiftCode,
  generateGiftCode,
  isValidGiftAmount,
} from '@/lib/giftCard';
import { trKey, useT } from '@/lib/i18n';
import { useBack } from '@/lib/nav';
import { fetchMyBusinessResult } from '@/lib/myBusiness';
import { applySessionUse, sessionsLeft } from '@/lib/packages';
import { supabase } from '@/lib/supabase';
import { getCurrentUser } from '@/lib/currentUser';
import type {
  BusinessClientRow,
  ClientPackage,
  GiftCard,
  PackageTemplate,
} from '@/lib/types';
import { useTransientMessage } from '@/lib/useTransientMessage';

type IssuedRow = ClientPackage & {
  packages?: { name: string | null } | null;
};

export default function BusinessPackagesScreen() {
  const t = useTheme();
  const back = useBack();
  const tr = useT();
  const [loading, setLoading] = useState(true);
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [templates, setTemplates] = useState<PackageTemplate[]>([]);
  const [issued, setIssued] = useState<IssuedRow[]>([]);
  const [cards, setCards] = useState<GiftCard[]>([]);
  const [clients, setClients] = useState<BusinessClientRow[]>([]);
  const [error, setError] = useTransientMessage();
  const [message, setMessage] = useTransientMessage();
  const [name, setName] = useState('');
  const [sessions, setSessions] = useState('10');
  const [price, setPrice] = useState('');
  const [pickTemplateId, setPickTemplateId] = useState<string | null>(null);
  const [pickClientId, setPickClientId] = useState<string | null>(null);
  const [giftAmount, setGiftAmount] = useState('');
  const [giftRecipient, setGiftRecipient] = useState('');

  const load = useCallback(async () => {
    setError(null);
    const user = await getCurrentUser();
    if (!user) {
      setLoading(false);
      return;
    }
    const { data: biz } = await fetchMyBusinessResult(user.id);
    if (!biz) {
      setLoading(false);
      return;
    }
    setBusinessId(biz.id);
    const [tpl, iss, gc, cli] = await Promise.all([
      supabase.from('packages').select('*').eq('business_id', biz.id).order('sort_order'),
      supabase
        .from('client_packages')
        .select('*, packages(name)')
        .eq('business_id', biz.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('gift_cards')
        .select('*')
        .eq('business_id', biz.id)
        .order('created_at', { ascending: false }),
      supabase.rpc('list_business_clients'),
    ]);
    if (tpl.error) setError(tpl.error.message, { sticky: true });
    setTemplates((tpl.data ?? []) as PackageTemplate[]);
    setIssued((iss.data ?? []) as IssuedRow[]);
    setCards((gc.data ?? []) as GiftCard[]);
    setClients(((cli.data ?? []) as BusinessClientRow[]).filter((c) => c.business_id === biz.id));
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void load();
    }, [load])
  );

  async function addTemplate() {
    if (!businessId) return;
    const n = name.trim();
    const s = Number(sessions);
    const p = Number(String(price).replace(',', '.')) || 0;
    if (!n || !Number.isFinite(s) || s < 1) {
      setError(trKey('team.nameRequired'));
      return;
    }
    setError(null);
    const { error: err } = await supabase.from('packages').insert({
      business_id: businessId,
      name: n,
      sessions: Math.floor(s),
      price: p,
      sort_order: templates.length,
    });
    if (err) {
      setError(err.message);
      return;
    }
    setName('');
    setMessage(trKey('pkg.saved'));
    await load();
  }

  async function issuePackage() {
    if (!businessId || !pickTemplateId || !pickClientId) return;
    const tpl = templates.find((x) => x.id === pickTemplateId);
    if (!tpl) return;
    setError(null);
    const { error: err } = await supabase.from('client_packages').insert({
      business_id: businessId,
      client_user_id: pickClientId,
      package_id: tpl.id,
      sessions_total: tpl.sessions,
      sessions_used: 0,
    });
    if (err) {
      setError(err.message);
      return;
    }
    setMessage(trKey('pkg.issuedOk'));
    await load();
  }

  async function changeSessions(row: IssuedRow, delta: 1 | -1) {
    const next = applySessionUse(row.sessions_total, row.sessions_used, delta);
    if (next === null) return;
    setError(null);
    const { error: err } = await supabase
      .from('client_packages')
      .update({ sessions_used: next, updated_at: new Date().toISOString() })
      .eq('id', row.id);
    if (err) {
      setError(err.message);
      return;
    }
    await load();
  }

  async function createGiftCard() {
    if (!businessId) return;
    const amount = Number(String(giftAmount).replace(',', '.'));
    if (!isValidGiftAmount(amount)) {
      setError(trKey('pkg.giftAmount'));
      return;
    }
    const code = generateGiftCode();
    setError(null);
    const { error: err } = await supabase.from('gift_cards').insert({
      business_id: businessId,
      code,
      amount,
      balance: amount,
      recipient_name: giftRecipient.trim() || null,
    });
    if (err) {
      setError(err.message);
      return;
    }
    setGiftAmount('');
    setGiftRecipient('');
    setMessage(trKey('pkg.giftCreated', { code: formatGiftCode(code) }));
    await load();
  }

  async function redeemGiftCard(card: GiftCard) {
    const next = applyGiftRedemption(Number(card.balance), Number(card.balance));
    if (next === null) return;
    setError(null);
    const { error: err } = await supabase
      .from('gift_cards')
      .update({ balance: next, status: 'redeemed', updated_at: new Date().toISOString() })
      .eq('id', card.id);
    if (err) {
      setError(err.message);
      return;
    }
    await load();
  }

  async function cancelGiftCard(card: GiftCard) {
    setError(null);
    const { error: err } = await supabase
      .from('gift_cards')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', card.id);
    if (err) {
      setError(err.message);
      return;
    }
    await load();
  }

  function clientLabel(id: string): string {
    const c = clients.find((x) => x.client_user_id === id);
    return c?.display_name || c?.contact || id;
  }

  if (loading && !businessId) {
    return (
      <ListLoadingScreen
        title={tr('pkg.title')}
        subtitle={tr('pkg.subtitle')}
        onBack={back}
        label={tr('pkg.loading')}
      />
    );
  }

  if (!businessId) {
    return (
      <Screen title={tr('pkg.title')} subtitle={tr('pkg.subtitle')} onBack={back}>
        <EmptyState icon="gift-outline" title={tr('team.setupFirst')} description={tr('team.setupFirstDesc')} />
      </Screen>
    );
  }

  return (
    <Screen title={tr('pkg.title')} subtitle={tr('pkg.subtitle')} onBack={back}>
      {error ? <Callout onClose={() => setError(null)} tone="danger">{error}</Callout> : null}
      {message ? <Callout onClose={() => setMessage(null)} tone="success">{message}</Callout> : null}

      <SectionTitle>{tr('pkg.templates')}</SectionTitle>
      <View style={[styles.panel, { backgroundColor: t.colors.surface, borderColor: t.colors.border }]}>
        <Field label={tr('pkg.name')} value={name} onChangeText={setName} placeholder={tr('pkg.namePh')} />
        <Field label={tr('pkg.sessions')} value={sessions} onChangeText={setSessions} keyboardType="number-pad" />
        <Field label={tr('pkg.price')} value={price} onChangeText={setPrice} keyboardType="decimal-pad" />
        <Button label={tr('pkg.add')} icon="add" onPress={() => void addTemplate()} />
        {templates.length === 0 ? (
          <Text style={[styles.meta, { color: t.colors.textMuted }]}>{tr('pkg.empty')}</Text>
        ) : (
          templates.map((tpl) => (
            <Text key={tpl.id} style={[styles.meta, { color: t.colors.text }]}>
              {tpl.name} · {tpl.sessions} · {formatRon(tpl.price)}
            </Text>
          ))
        )}
      </View>

      <SectionTitle>{tr('pkg.issue')}</SectionTitle>
      <View style={[styles.panel, { backgroundColor: t.colors.surface, borderColor: t.colors.border }]}>
        <Text style={[styles.meta, { color: t.colors.textMuted }]}>{tr('pkg.pickPackage')}</Text>
        <View style={styles.chips}>
          {templates.map((tpl) => (
            <Pressable
              key={tpl.id}
              onPress={() => setPickTemplateId(tpl.id)}
              style={[
                styles.chip,
                {
                  backgroundColor: pickTemplateId === tpl.id ? t.colors.accentSoft : t.colors.surface,
                  borderColor: pickTemplateId === tpl.id ? t.colors.accent : t.colors.border,
                },
              ]}
            >
              <Text style={{ color: t.colors.text }}>{tpl.name}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={[styles.meta, { color: t.colors.textMuted }]}>{tr('pkg.pickClient')}</Text>
        <View style={styles.chips}>
          {clients.map((c) => (
            <Pressable
              key={c.client_user_id}
              onPress={() => setPickClientId(c.client_user_id)}
              style={[
                styles.chip,
                {
                  backgroundColor: pickClientId === c.client_user_id ? t.colors.accentSoft : t.colors.surface,
                  borderColor: pickClientId === c.client_user_id ? t.colors.accent : t.colors.border,
                },
              ]}
            >
              <Text style={{ color: t.colors.text }}>{c.display_name || c.contact}</Text>
            </Pressable>
          ))}
        </View>
        <Button
          label={tr('pkg.issueBtn')}
          icon="checkmark"
          disabled={!pickTemplateId || !pickClientId}
          onPress={() => void issuePackage()}
        />
      </View>

      <SectionTitle>{tr('pkg.issued')}</SectionTitle>
      <View style={[styles.panel, { backgroundColor: t.colors.surface, borderColor: t.colors.border }]}>
        {issued.length === 0 ? (
          <Text style={[styles.meta, { color: t.colors.textMuted }]}>{tr('pkg.issuedEmpty')}</Text>
        ) : (
          issued.map((row) => (
            <View key={row.id} style={styles.issuedRow}>
              <Text style={[styles.meta, { color: t.colors.text }]}>
                {clientLabel(row.client_user_id)} · {row.packages?.name ?? ''}
              </Text>
              <Text style={[styles.meta, { color: t.colors.textMuted }]}>
                {tr('pkg.left', {
                  left: sessionsLeft(row.sessions_total, row.sessions_used),
                  total: row.sessions_total,
                })}
                {sessionsLeft(row.sessions_total, row.sessions_used) === 0 ? ` · ${tr('pkg.exhausted')}` : ''}
              </Text>
              <View style={styles.btnRow}>
                <Button label={tr('pkg.useOne')} size="sm" variant="secondary" onPress={() => void changeSessions(row, 1)} />
                <Button label={tr('pkg.giveBack')} size="sm" variant="secondary" onPress={() => void changeSessions(row, -1)} />
              </View>
            </View>
          ))
        )}
      </View>

      <SectionTitle>{tr('pkg.giftTitle')}</SectionTitle>
      <View style={[styles.panel, { backgroundColor: t.colors.surface, borderColor: t.colors.border }]}>
        <Field label={tr('pkg.giftAmount')} value={giftAmount} onChangeText={setGiftAmount} keyboardType="decimal-pad" />
        <Field label={tr('pkg.giftRecipient')} value={giftRecipient} onChangeText={setGiftRecipient} />
        <Button label={tr('pkg.giftCreate')} icon="gift-outline" onPress={() => void createGiftCard()} />
        {cards.length === 0 ? (
          <Text style={[styles.meta, { color: t.colors.textMuted }]}>{tr('pkg.giftEmpty')}</Text>
        ) : (
          cards.map((card) => (
            <View key={card.id} style={styles.issuedRow}>
              <Text style={[styles.meta, { color: t.colors.text }]}>
                {tr('pkg.giftCode', { code: formatGiftCode(card.code) })}
                {card.recipient_name ? ` · ${card.recipient_name}` : ''}
              </Text>
              <Text style={[styles.meta, { color: t.colors.textMuted }]}>
                {tr('pkg.giftBalance', { balance: formatRon(card.balance), amount: formatRon(card.amount) })}
                {' · '}
                {card.status}
              </Text>
              {card.status === 'active' ? (
                <View style={styles.btnRow}>
                  <Button label={tr('pkg.giftRedeem')} size="sm" variant="secondary" onPress={() => void redeemGiftCard(card)} />
                  <Button label={tr('pkg.giftCancel')} size="sm" variant="secondary" onPress={() => void cancelGiftCard(card)} />
                </View>
              ) : null}
            </View>
          ))
        )}
      </View>
    </Screen>
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
