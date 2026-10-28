import { useCallback, useEffect, useState } from 'react';
import { Share, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';

import {
  Badge,
  Body,
  Button,
  Callout,
  Card,
  EmptyState,
  Field,
  LoadingScreen,
  Screen,
  SectionTitle,
  Segmented,
  SettingRow,
  Toggle,
  useTheme,
} from '@/components/ui';
import { fontSize, spacing } from '@/constants/theme';
import {
  expiryError,
  parseCustomExpiry,
  parseMaxUses,
  presetExpiry,
  type ExpiryPreset,
} from '@/lib/accessCode';
import { getCurrentUser } from '@/lib/currentUser';
import { confirmDialog } from '@/lib/dialog';
import { localeTag, useT, type TrKey } from '@/lib/i18n';
import { fetchMyBusiness } from '@/lib/myBusiness';
import { useBack } from '@/lib/nav';
import {
  canUsePrivateMode,
  createAccessCode,
  listAccessClients,
  listAccessCodes,
  revokeAccessCode,
  revokeClientAccess,
  setBusinessPrivate,
  type AccessClientRow,
  type AccessCodeRow,
  type CreatedAccessCode,
} from '@/lib/privateAccess';
import type { BusinessProfile } from '@/lib/types';
import { managerOnly } from '@/components/ManagerOnly';

type ExpiryChoice = ExpiryPreset | 'custom';
type Tab = 'codes' | 'clients';

const STATUS_TONE = {
  active: 'success',
  used: 'neutral',
  expired: 'warning',
  revoked: 'danger',
} as const;

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString(localeTag(), {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Mesaje server → text pentru utilizator (fără detalii tehnice). */
function createErrorKey(raw: string): TrKey {
  if (/bad_expiry/.test(raw)) return 'priv.errExpiry';
  if (/bad_uses/.test(raw)) return 'priv.errUses';
  if (/bad_label/.test(raw)) return 'priv.errLabel';
  if (/forbidden/.test(raw)) return 'priv.errForbidden';
  if (/private_mode_unavailable/.test(raw)) return 'priv.errUnavailable';
  return 'priv.errGeneric';
}

/**
 * Business privat („Top secret”): comutator, coduri de invitație, clienți cu acces.
 * Doar proprietar/admin (RPC-urile verifică rolul pe server).
 */
function PrivateCodesScreen() {
  const t = useTheme();
  const tr = useT();
  const back = useBack();
  const [business, setBusiness] = useState<BusinessProfile | null>(null);
  const [allowed, setAllowed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isPrivate, setIsPrivate] = useState(false);
  const [toggling, setToggling] = useState(false);

  const [tab, setTab] = useState<Tab>('codes');
  const [codes, setCodes] = useState<AccessCodeRow[]>([]);
  const [clients, setClients] = useState<AccessClientRow[]>([]);
  const [listError, setListError] = useState<string | null>(null);

  const [expiryChoice, setExpiryChoice] = useState<ExpiryChoice>('7d');
  const [customExpiry, setCustomExpiry] = useState('');
  const [usesText, setUsesText] = useState('1');
  const [label, setLabel] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedAccessCode | null>(null);
  const [copied, setCopied] = useState(false);

  const reloadLists = useCallback(async (businessId: string) => {
    const [c, a] = await Promise.all([listAccessCodes(businessId), listAccessClients(businessId)]);
    setCodes(c.rows);
    setClients(a.rows);
    setListError(c.error || a.error ? tr('priv.errGeneric') : null);
  }, [tr]);

  useEffect(() => {
    void (async () => {
      const user = await getCurrentUser();
      if (!user) {
        setLoadError(tr('req.notAuthed'));
        setLoading(false);
        return;
      }
      const biz = await fetchMyBusiness(user.id);
      if (!biz) {
        setLoadError(tr('qr.setupFirst'));
        setLoading(false);
        return;
      }
      setBusiness(biz);
      setIsPrivate(biz.is_private === true);
      setAllowed(await canUsePrivateMode(biz.id));
      await reloadLists(biz.id);
      setLoading(false);
    })();
  }, [reloadLists, tr]);

  async function onTogglePrivate(next: boolean) {
    if (!business) return;
    const ok = await confirmDialog({
      title: tr(next ? 'priv.confirmOnTitle' : 'priv.confirmOffTitle'),
      message: tr(next ? 'priv.confirmOnBody' : 'priv.confirmOffBody'),
      confirmText: tr(next ? 'priv.confirmOn' : 'priv.confirmOff'),
      cancelText: tr('common.cancel'),
      destructive: next,
    });
    if (!ok) return;
    setToggling(true);
    const err = await setBusinessPrivate(business.id, next);
    setToggling(false);
    if (err) {
      setListError(tr(createErrorKey(err)));
      return;
    }
    setIsPrivate(next);
  }

  async function onCreate() {
    if (!business) return;
    setFormError(null);
    const expiresAt = expiryChoice === 'custom' ? parseCustomExpiry(customExpiry) : presetExpiry(expiryChoice);
    const expErr = expiryError(expiresAt);
    if (expErr) {
      setFormError(tr(expErr === 'format' ? 'priv.errDateFormat' : 'priv.errExpiry'));
      return;
    }
    const maxUses = parseMaxUses(usesText);
    if (maxUses == null) {
      setFormError(tr('priv.errUses'));
      return;
    }
    setCreating(true);
    const res = await createAccessCode({ businessId: business.id, expiresAt: expiresAt!, maxUses, label });
    setCreating(false);
    if (res.error || !res.created) {
      setFormError(tr(createErrorKey(res.error ?? '')));
      return;
    }
    setCreated(res.created);
    setCopied(false);
    setLabel('');
    await reloadLists(business.id);
  }

  async function copyCode() {
    if (!created) return;
    await Clipboard.setStringAsync(created.code);
    setCopied(true);
  }

  async function shareCode() {
    if (!created || !business) return;
    try {
      await Share.share({ message: tr('priv.shareMsg', { name: business.name, code: created.code }) });
    } catch {
      await copyCode();
    }
  }

  async function onRevokeCode(row: AccessCodeRow) {
    if (!business) return;
    const ok = await confirmDialog({
      title: tr('priv.revokeCodeTitle'),
      message: tr('priv.revokeCodeBody'),
      confirmText: tr('priv.revoke'),
      cancelText: tr('common.cancel'),
      destructive: true,
    });
    if (!ok) return;
    const err = await revokeAccessCode(row.id);
    if (err) setListError(tr('priv.errGeneric'));
    if (created?.id === row.id) setCreated(null);
    await reloadLists(business.id);
  }

  async function onRevokeClient(row: AccessClientRow) {
    if (!business) return;
    const ok = await confirmDialog({
      title: tr('priv.revokeClientTitle'),
      message: tr('priv.revokeClientBody', { name: row.display_name || row.email || '—' }),
      confirmText: tr('priv.revoke'),
      cancelText: tr('common.cancel'),
      destructive: true,
    });
    if (!ok) return;
    const err = await revokeClientAccess(business.id, row.user_id);
    if (err) setListError(tr('priv.errGeneric'));
    await reloadLists(business.id);
  }

  if (loading) return <LoadingScreen />;

  if (loadError || !business) {
    return (
      <Screen title={tr('priv.title')} onBack={back}>
        <Callout tone="danger">{loadError ?? tr('priv.errGeneric')}</Callout>
      </Screen>
    );
  }

  const presetOptions: { value: ExpiryChoice; label: string }[] = [
    { value: '24h', label: tr('priv.preset24h') },
    { value: '7d', label: tr('priv.preset7d') },
    { value: '30d', label: tr('priv.preset30d') },
    { value: 'custom', label: tr('priv.presetCustom') },
  ];

  return (
    <Screen title={tr('priv.title')} subtitle={business.name} onBack={back}>
      {!allowed ? <Callout tone="warning">{tr('priv.errUnavailable')}</Callout> : null}

      <SettingRow
        icon="lock-closed-outline"
        title={tr('priv.toggle')}
        description={tr(isPrivate ? 'priv.toggleOnDesc' : 'priv.toggleOffDesc')}
        right={
          <Toggle
            value={isPrivate}
            onValueChange={(v) => void onTogglePrivate(v)}
            accessibilityLabel={tr('priv.toggle')}
            disabled={toggling || (!allowed && !isPrivate)}
          />
        }
      />
      <Body muted>{tr('priv.explain')}</Body>

      <SectionTitle>{tr('priv.newCode')}</SectionTitle>
      {!isPrivate ? <Callout tone="info">{tr('priv.publicHint')}</Callout> : null}
      <Text style={[styles.label, { color: t.colors.text }]}>{tr('priv.validity')}</Text>
      <Segmented value={expiryChoice} onChange={setExpiryChoice} options={presetOptions} />
      {expiryChoice === 'custom' ? (
        <Field
          label={tr('priv.customLabel')}
          hint={tr('priv.customHint')}
          placeholder="31.12.2026 18:00"
          value={customExpiry}
          onChangeText={setCustomExpiry}
          autoCapitalize="none"
        />
      ) : null}
      <Field
        label={tr('priv.uses')}
        hint={tr('priv.usesHint')}
        value={usesText}
        onChangeText={(v) => setUsesText(v.replace(/[^0-9]/g, '').slice(0, 4))}
        keyboardType="number-pad"
      />
      <Field
        label={tr('priv.labelField')}
        hint={tr('priv.labelHint')}
        value={label}
        onChangeText={(v) => setLabel(v.slice(0, 60))}
      />
      {formError ? <Callout tone="danger">{formError}</Callout> : null}
      <Button
        label={tr('priv.generate')}
        icon="key-outline"
        onPress={() => void onCreate()}
        loading={creating}
        disabled={!allowed}
      />

      {created ? (
        <Callout tone="success" title={tr('priv.createdTitle')}>
          {tr('priv.createdBody', { date: fmtDate(created.expires_at), uses: String(created.max_uses) })}
        </Callout>
      ) : null}
      {created ? (
        <View style={[styles.codeBox, { borderColor: t.colors.accent, backgroundColor: t.colors.accentSoft }]}>
          <Text selectable style={[styles.codeText, { color: t.colors.text }]}>
            {created.code}
          </Text>
          <View style={styles.row}>
            <Button
              label={copied ? tr('priv.copied') : tr('priv.copy')}
              icon="copy-outline"
              variant="secondary"
              size="md"
              fullWidth={false}
              onPress={() => void copyCode()}
            />
            <Button
              label={tr('priv.share')}
              icon="share-social-outline"
              variant="secondary"
              size="md"
              fullWidth={false}
              onPress={() => void shareCode()}
            />
          </View>
        </View>
      ) : null}

      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: 'codes', label: tr('priv.tabCodes'), count: codes.length },
          { value: 'clients', label: tr('priv.tabClients'), count: clients.length },
        ]}
      />
      {listError ? <Callout tone="danger">{listError}</Callout> : null}

      {tab === 'codes' ? (
        codes.length === 0 ? (
          <EmptyState icon="key-outline" title={tr('priv.noCodes')} description={tr('priv.noCodesDesc')} />
        ) : (
          codes.map((c) => (
            <Card key={c.id} title={c.label || tr('priv.codeEnding', { hint: c.code_hint })}>
              <View style={styles.row}>
                <Badge tone={STATUS_TONE[c.status]}>{tr(`priv.status.${c.status}` as TrKey)}</Badge>
                <Text style={[styles.meta, { color: t.colors.textMuted }]}>
                  {tr('priv.usesCount', { used: String(c.used_count), max: String(c.max_uses) })}
                </Text>
              </View>
              <Text style={[styles.meta, { color: t.colors.textMuted }]}>
                {tr('priv.codeMeta', { hint: c.code_hint, date: fmtDate(c.expires_at) })}
              </Text>
              {c.status === 'active' ? (
                <Button
                  label={tr('priv.revoke')}
                  variant="danger"
                  size="sm"
                  fullWidth={false}
                  onPress={() => void onRevokeCode(c)}
                />
              ) : null}
            </Card>
          ))
        )
      ) : clients.length === 0 ? (
        <EmptyState icon="people-outline" title={tr('priv.noClients')} description={tr('priv.noClientsDesc')} />
      ) : (
        clients.map((c) => (
          <Card key={c.user_id} title={c.display_name || c.email || '—'}>
            {c.display_name && c.email ? (
              <Text style={[styles.meta, { color: t.colors.textMuted }]}>{c.email}</Text>
            ) : null}
            <Text style={[styles.meta, { color: t.colors.textMuted }]}>
              {tr('priv.grantedAt', { date: fmtDate(c.granted_at) })}
            </Text>
            <Button
              label={tr('priv.revoke')}
              variant="danger"
              size="sm"
              fullWidth={false}
              onPress={() => void onRevokeClient(c)}
            />
          </Card>
        ))
      )}
    </Screen>
  );
}

export default managerOnly(PrivateCodesScreen);

const styles = StyleSheet.create({
  label: { fontSize: fontSize.sm, fontWeight: '600' },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  meta: { fontSize: fontSize.sm },
  codeBox: {
    borderWidth: 2,
    borderRadius: 12,
    padding: spacing.lg,
    gap: spacing.md,
    alignItems: 'center',
  },
  codeText: { fontSize: 26, fontWeight: '800', letterSpacing: 2, fontVariant: ['tabular-nums'] },
});
