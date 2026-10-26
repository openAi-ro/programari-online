import { useCallback, useState, useEffect } from 'react';
import { Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import {
  Button,
  Callout,
  EmptyState,
  Field,
  ListLoadingScreen,
  Screen,
  useTheme,
} from '@/components/ui';
import { getCurrentUser } from '@/lib/currentUser';
import { trKey, useT } from '@/lib/i18n';
import { markNavReady, measureBeforeEnabled } from '@/lib/navTiming';
import { fontSize, radius, spacing } from '@/constants/theme';
import { useBack } from '@/lib/nav';
import { statusLabel } from '@/lib/status';
import { mapBookingRpcError, visitsUntilFree } from '@/lib/bookingRules';
import { formatInTimeZone } from '@/lib/timezone';
import { ensureChatConversationForClient } from '@/lib/chatRpc';
import { isWinbackCandidate } from '@/lib/winback';
import { visitCountKey } from '@/lib/visitLabel';
import { fetchMyBusinessResult } from '@/lib/myBusiness';
import { fetchBusinessRole } from '@/lib/businessMembers';
import { readLocalImageBytes } from '@/lib/uploadLocalImage';
import type { ClientIntake, ClientPhoto } from '@/lib/types';
import { CLIENT_PHOTO_BUCKET, clientPhotoPath, withSignedUrls } from '@/lib/clientPhotos';
import { supabase } from '@/lib/supabase';
import type { Appointment, BusinessClientRow } from '@/lib/types';
import { useTransientMessage } from '@/lib/useTransientMessage';

function phoneOf(contact: string): string {
  const c = (contact ?? '').trim();
  if (!c || c.includes('@')) return '';
  const digits = c.replace(/\D/g, '');
  return digits.length >= 9 ? c : '';
}

export default function BusinessClientsScreen() {
  useEffect(() => {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      // eslint-disable-next-line no-console
      console.count('[TAB_MOUNT] business/clients');
    }
  }, []);
  const t = useTheme();
  const back = useBack();
  const tr = useT();
  const router = useRouter();
  const [rows, setRows] = useState<BusinessClientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useTransientMessage();
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [history, setHistory] = useState<Appointment[]>([]);
  const [note, setNote] = useState('');
  const [noteBusy, setNoteBusy] = useState(false);
  const [blockAfter, setBlockAfter] = useState(2);
  const [loyaltyEvery, setLoyaltyEvery] = useState(0);
  const [inactiveOnly, setInactiveOnly] = useState(false);
  const [bizName, setBizName] = useState('');
  const [bizId, setBizId] = useState<string | null>(null);
  const [bizTimezone, setBizTimezone] = useState('Europe/Bucharest');
  const [openRecordId, setOpenRecordId] = useState<string | null>(null);
  const [records, setRecords] = useState<Record<string, { intake: ClientIntake | null; photos: ClientPhoto[] }>>({});
  const [recordErrors, setRecordErrors] = useState<Record<string, boolean>>({});
  const [photoBusy, setPhotoBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { data, error: err } = await supabase.rpc('list_business_clients');
      if (err) {
        setError(err.message, { sticky: true });
        setRows([]);
      } else {
        setRows((data ?? []) as BusinessClientRow[]);
      }
      const me = await getCurrentUser();
      const { data: biz } = me
        ? await fetchMyBusinessResult(me.id)
        : { data: null };
      if (biz?.id) {
        const role = await fetchBusinessRole(biz.id);
        if (role === 'staff') setError(trKey('members.staffOnly'), { sticky: true });
      }
      if (biz?.name) setBizName(biz.name);
      if (biz?.id) setBizId(biz.id);
      if (biz?.timezone) setBizTimezone(biz.timezone);
      if (typeof biz?.no_show_block_after === 'number') {
        setBlockAfter(biz.no_show_block_after);
      }
      if (typeof biz?.loyalty_every === 'number') {
        setLoyaltyEvery(biz.loyalty_every);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e), { sticky: true });
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      const hasExistingData = rows.length > 0;
      if (measureBeforeEnabled() || !hasExistingData) setLoading(true);
      void load().then(() => {
        markNavReady('clients', {
          hasExistingData,
          softRefresh: hasExistingData && !measureBeforeEnabled(),
        });
      });
    }, [load, rows.length])
  );

  const recordKey = (row: BusinessClientRow) => `${row.business_id}:${row.client_user_id}`;

  /** Loads intake + photos for one (business, client) record. Always ends: data or error. */
  async function loadRecord(row: BusinessClientRow) {
    const key = recordKey(row);
    setRecordErrors((m) => ({ ...m, [key]: false }));
    try {
      const [intakeRes, photosRes] = await Promise.all([
        supabase
          .from('client_intake')
          .select('*')
          .eq('business_id', row.business_id)
          .eq('client_user_id', row.client_user_id)
          .maybeSingle(),
        supabase
          .from('client_photos')
          .select('*')
          .eq('business_id', row.business_id)
          .eq('client_user_id', row.client_user_id)
          .order('created_at', { ascending: false }),
      ]);
      if (intakeRes.error || photosRes.error) throw intakeRes.error ?? photosRes.error;
      const photos = await withSignedUrls((photosRes.data ?? []) as ClientPhoto[]);
      setRecords((m) => ({
        ...m,
        [key]: { intake: (intakeRes.data ?? null) as ClientIntake | null, photos },
      }));
    } catch {
      setRecordErrors((m) => ({ ...m, [key]: true }));
    }
  }

  async function toggleRecord(row: BusinessClientRow) {
    if (openRecordId === recordKey(row)) {
      setOpenRecordId(null);
      return;
    }
    setOpenRecordId(recordKey(row));
    if (records[recordKey(row)] || !row.business_id) return;
    await loadRecord(row);
  }

  async function addClientPhoto(row: BusinessClientRow, kind: 'before' | 'after') {
    if (!row.business_id) return;
    if (!records[recordKey(row)]?.intake?.photo_consent) {
      setError(tr('int.photoNeedsConsent'));
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: false,
      quality: 0.8,
    });
    if (result.canceled || result.assets.length === 0) return;
    setPhotoBusy(true);
    setError(null);
    try {
      const { buffer, contentType, ext } = await readLocalImageBytes(result.assets[0].uri);
      const path = clientPhotoPath(row.business_id, row.client_user_id, ext);
      const { error: upErr } = await supabase.storage
        .from(CLIENT_PHOTO_BUCKET)
        .upload(path, buffer, { contentType, upsert: false });
      if (upErr) throw upErr;
      const { error: insErr } = await supabase.from('client_photos').insert({
        business_id: row.business_id,
        client_user_id: row.client_user_id,
        storage_path: path,
        kind,
      });
      if (insErr) throw insErr;
      await loadRecord(row);
    } catch (e) {
      setError(e instanceof Error ? e.message : tr('team.photoFail'));
    }
    setPhotoBusy(false);
  }

  async function deleteClientPhoto(row: BusinessClientRow, photo: ClientPhoto) {
    const { error: err } = await supabase.from('client_photos').delete().eq('id', photo.id);
    if (err) {
      setError(err.message);
      return;
    }
    await supabase.storage.from(CLIENT_PHOTO_BUCKET).remove([photo.storage_path]);
    await loadRecord(row);
  }

  const shown = rows.filter((r) => {
    if (inactiveOnly && !isWinbackCandidate(r, new Date())) return false;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      (r.display_name ?? '').toLowerCase().includes(q) ||
      r.contact.toLowerCase().includes(q)
    );
  });

  async function openClient(row: BusinessClientRow) {
    if (openId === recordKey(row)) {
      setOpenId(null);
      return;
    }
    setOpenId(recordKey(row));
    setNote(row.note ?? '');
    setHistory([]);
    setError(null);
    const { data, error: histErr } = await supabase
      .from('appointments')
      .select('*')
      .eq('business_id', row.business_id)
      .eq('client_user_id', row.client_user_id)
      .order('start_at', { ascending: false })
      .limit(20);
    if (histErr) {
      setError(tr('cli.historyFail'));
      return;
    }
    setHistory((data ?? []) as Appointment[]);
  }

  async function openChat(row: BusinessClientRow) {
    setError(null);
    const { conversation, error: cErr } = await ensureChatConversationForClient(
      row.business_id,
      row.client_user_id
    );
    if (cErr || !conversation) {
      setError(cErr ?? tr('cli.chatFailed'));
      return;
    }
    router.push(`/(app)/business/chat/${conversation.id}` as never);
  }

  async function saveNote(row: BusinessClientRow) {
    setNoteBusy(true);
    setError(null);
    const { error: err } = await supabase.from('client_notes').upsert({
      business_id: row.business_id,
      client_user_id: row.client_user_id,
      note: note.trim(),
      updated_at: new Date().toISOString(),
    });
    setNoteBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    await load();
  }

  async function toggleBlock(row: BusinessClientRow) {
    setError(null);
    if (row.blocked) {
      const { error: err } = await supabase.rpc('unblock_client', {
        p_business_id: row.business_id,
        p_client_user_id: row.client_user_id,
      });
      if (err) {
        setError(mapBookingRpcError(err.message));
        return;
      }
    } else {
      const { error: err } = await supabase.rpc('block_client', {
        p_business_id: row.business_id,
        p_client_user_id: row.client_user_id,
        p_reason: 'no-show',
      });
      if (err) {
        setError(mapBookingRpcError(err.message));
        return;
      }
    }
    await load();
  }

  if (loading && rows.length === 0) {
    return (
      <View style={{ flex: 1 }}>
        <ListLoadingScreen
          title={tr('cli.title')}
          subtitle={tr('cli.subtitle')}
          onBack={back}
          label={tr('cli.loading')}
        />
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <Screen title={tr('cli.title')} subtitle={tr('cli.subtitle')} onBack={back}>
      <Field
        label={tr('cli.search')}
        value={query}
        onChangeText={setQuery}
        placeholder={tr('cli.searchPh')}
        icon="search-outline"
      />
      <View style={styles.chips}>
        {[
          { key: 'all', label: tr('cli.allClients'), on: !inactiveOnly },
          { key: 'inactive', label: tr('cli.inactiveFilter'), on: inactiveOnly },
        ].map((chip) => (
          <Pressable
            key={chip.key}
            onPress={() => setInactiveOnly(chip.key === 'inactive')}
            style={[
              styles.chip,
              {
                backgroundColor: chip.on ? t.colors.accentSoft : t.colors.surface,
                borderColor: chip.on ? t.colors.accent : t.colors.border,
              },
            ]}
          >
            <Text style={{ color: t.colors.text }}>{chip.label}</Text>
          </Pressable>
        ))}
      </View>
      {error ? <Callout onClose={() => setError(null)} tone="danger">{error}</Callout> : null}
      {shown.length === 0 ? (
        <EmptyState
          icon="people-outline"
          title={tr('cli.empty')}
          description={tr('cli.emptyDesc')}
        />
      ) : (
        shown.map((row) => {
          const open = openId === recordKey(row);
          const last = row.last_start_at
            ? formatInTimeZone(new Date(row.last_start_at), bizTimezone, 'dd.MM.yyyy')
            : '—';
          return (
            <View
              key={recordKey(row)}
              style={[
                styles.card,
                { backgroundColor: t.colors.surface, borderColor: t.colors.border },
              ]}
            >
              <Pressable onPress={() => void openClient(row)} style={styles.head}>
                <View style={styles.flex}>
                  <Text style={[styles.name, { color: t.colors.text }]}>
                    {row.display_name || row.contact}
                  </Text>
                  <Text style={[styles.meta, { color: t.colors.textMuted }]}>
                    {row.contact} · {row.visit_count} {tr(visitCountKey(Number(row.visit_count)))} · {tr('cli.last')} {last}
                    {row.upcoming_count > 0 ? ` · ${row.upcoming_count} ${tr('cli.upcoming')}` : ''}
                    {row.no_show_count > 0 ? ` · ${row.no_show_count} ${tr('cli.noShows')}` : ''}
                    {row.blocked ? ` · ${tr('cli.blocked')}` : ''}
                    {visitsUntilFree(Number(row.visit_count), loyaltyEvery)
                      ? ` · ${tr('cli.giftIn').replace('{count}', String(visitsUntilFree(Number(row.visit_count), loyaltyEvery)))}`
                      : ''}
                  </Text>
                </View>
                <Ionicons
                  name={open ? 'chevron-up' : 'chevron-down'}
                  size={18}
                  color={t.colors.textFaint}
                />
              </Pressable>
              {open ? (
                <View style={styles.detail}>
                  <Field
                    label={tr('cli.note')}
                    value={note}
                    onChangeText={setNote}
                    placeholder={tr('cli.notePh')}
                    multiline
                  />
                  <Pressable
                    onPress={() => void saveNote(row)}
                    disabled={noteBusy}
                    style={({ pressed }) => [
                      styles.saveNote,
                      { backgroundColor: t.colors.accentSoft, opacity: pressed ? 0.8 : 1 },
                    ]}
                  >
                    <Text style={[styles.saveNoteText, { color: t.colors.accentSoftText }]}>
                      {noteBusy ? tr('cli.saving') : tr('cli.saveNote')}
                    </Text>
                  </Pressable>
                  <View style={styles.contactRow}>
                    {phoneOf(row.contact) ? (
                      <>
                        <Button label={tr('cli.call')} size="sm" variant="secondary" icon="call-outline" onPress={() => void Linking.openURL('tel:' + phoneOf(row.contact))} />
                        <Button label={tr('cli.whatsapp')} size="sm" variant="secondary" icon="logo-whatsapp" onPress={() => void Linking.openURL('https://wa.me/' + phoneOf(row.contact).replace(/\D/g, '') + (inactiveOnly ? `?text=${encodeURIComponent(tr('cli.winbackMsg', { business: bizName }))}` : ''))} />
                      </>
                    ) : null}
                    <Button label={tr('int.showRecord')} size="sm" variant="secondary" icon="document-text-outline" onPress={() => void toggleRecord(row)} />
                    <Button label={tr('cli.chat')} size="sm" variant="secondary" icon="chatbubble-outline" onPress={() => void openChat(row)} />
                  </View>
                  {history.map((a) => (
                    <Text key={a.id} style={[styles.hist, { color: t.colors.textMuted }]}>
                      {formatInTimeZone(new Date(a.start_at), bizTimezone, 'dd.MM.yyyy HH:mm')}
                      {' · '}
                      {a.service_name ?? tr('cli.session')}
                      {' · '}
                      {a.no_show ? tr('cli.noShow') : statusLabel(a.status)}
                    </Text>
                  ))}
                  {openRecordId === recordKey(row) ? (
                    <View style={styles.record}>
                      <Text style={[styles.meta, { color: t.colors.text, fontWeight: '700' }]}>
                        {tr('int.record')}
                      </Text>
                      {records[recordKey(row)] ? (
                        <>
                          {records[recordKey(row)]?.intake ? (
                            <>
                              {records[recordKey(row)]?.intake?.allergies ? (
                                <Text style={[styles.meta, { color: t.colors.text }]}>
                                  {tr('int.allergyLabel', { text: records[recordKey(row)]?.intake?.allergies ?? '' })}
                                </Text>
                              ) : null}
                              {records[recordKey(row)]?.intake?.conditions ? (
                                <Text style={[styles.meta, { color: t.colors.text }]}>
                                  {tr('int.conditionsLabel', { text: records[recordKey(row)]?.intake?.conditions ?? '' })}
                                </Text>
                              ) : null}
                              {records[recordKey(row)]?.intake?.notes ? (
                                <Text style={[styles.meta, { color: t.colors.text }]}>
                                  {tr('int.notesLabel', { text: records[recordKey(row)]?.intake?.notes ?? '' })}
                                </Text>
                              ) : null}
                              <Text style={[styles.meta, { color: t.colors.textMuted }]}>
                                {records[recordKey(row)]?.intake?.photo_consent ? tr('int.consentYes') : tr('int.consentNo')}
                              </Text>
                            </>
                          ) : (
                            <Text style={[styles.meta, { color: t.colors.textMuted }]}>
                              {tr('int.noRecord')}
                            </Text>
                          )}
                          <View style={styles.photoRow}>
                            {(records[recordKey(row)]?.photos ?? []).map((p) => (
                              <View key={p.id} style={styles.photoItem}>
                                {p.signedUrl ? <Image source={{ uri: p.signedUrl }} style={styles.photoThumb} /> : null}
                                <Text style={[styles.meta, { color: t.colors.textMuted }]}>
                                  {p.kind === 'after' ? tr('int.after') : tr('int.before')}
                                </Text>
                                <Button label={tr('team.delPhoto')} size="sm" variant="secondary" icon="trash-outline" onPress={() => void deleteClientPhoto(row, p)} />
                              </View>
                            ))}
                          </View>
                          {!records[recordKey(row)]?.intake?.photo_consent ? (
                            <Text style={[styles.meta, { color: t.colors.textMuted }]}>
                              {tr('int.photoNeedsConsent')}
                            </Text>
                          ) : null}
                          <View style={styles.btnRow}>
                            <Button label={tr('int.addBefore')} size="sm" variant="secondary" loading={photoBusy} disabled={!records[recordKey(row)]?.intake?.photo_consent} onPress={() => void addClientPhoto(row, 'before')} />
                            <Button label={tr('int.addAfter')} size="sm" variant="secondary" loading={photoBusy} disabled={!records[recordKey(row)]?.intake?.photo_consent} onPress={() => void addClientPhoto(row, 'after')} />
                          </View>
                        </>
                      ) : recordErrors[recordKey(row)] ? (
                        <>
                          <Callout tone="danger">{tr('cli.recordFail')}</Callout>
                          <Button label={tr('ui.retryDefault')} size="sm" variant="secondary" icon="refresh-outline" onPress={() => void loadRecord(row)} />
                        </>
                      ) : (
                        <Text style={[styles.meta, { color: t.colors.textMuted }]}>
                          {tr('cli.loading')}
                        </Text>
                      )}
                    </View>
                  ) : null}
                  {blockAfter > 0 && row.no_show_count >= blockAfter && !row.blocked ? (
                    <Callout tone="warning" title={tr('cli.repeatTitle')}>
                      {tr('cli.repeatBody').replace('{count}', String(row.no_show_count))}
                    </Callout>
                  ) : null}
                  <Button
                    label={row.blocked ? tr('cli.unblock') : tr('cli.block')}
                    variant={row.blocked ? 'secondary' : 'danger'}
                    size="sm"
                    icon={row.blocked ? 'lock-open-outline' : 'ban-outline'}
                    onPress={() => void toggleBlock(row)}
                  />
                  <Pressable onPress={() => router.push('/(app)/business/calendar' as never)}>
                    <Text style={[styles.link, { color: t.colors.accent }]}>{tr('cli.openCalendar')}</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          );
        })
      )}
    </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: radius.lg, overflow: 'hidden' },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
  },
  flex: { flex: 1, gap: 2 },
  name: { fontSize: fontSize.md, fontWeight: '700' },
  meta: { fontSize: fontSize.sm },
  detail: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: spacing.sm },
  saveNote: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  saveNoteText: { fontSize: fontSize.sm, fontWeight: '700' },
  hist: { fontSize: fontSize.sm },
  contactRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  link: { fontSize: fontSize.sm, fontWeight: '700', marginTop: spacing.xs },
  record: { gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, borderWidth: 1 },
  photoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  photoItem: { gap: spacing.xs, alignItems: 'center' },
  photoThumb: { width: 96, height: 96, borderRadius: radius.md },
  btnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
});
