import { useCallback, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';

import {
  Button,
  Callout,
  Field,
  ListLoadingScreen,
  Screen,
  SectionTitle,
  useTheme,
} from '@/components/ui';
import { fontSize, radius, spacing } from '@/constants/theme';
import { normalizeIntakeText } from '@/lib/intake';
import { trKey, useT } from '@/lib/i18n';
import { useBack } from '@/lib/nav';
import { supabase } from '@/lib/supabase';
import { getCurrentUser } from '@/lib/currentUser';
import type { ClientPhoto } from '@/lib/types';
import { withSignedUrls } from '@/lib/clientPhotos';

type Biz = { id: string; name: string };

export default function IntakeScreen() {
  const t = useTheme();
  const back = useBack();
  const tr = useT();
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [businesses, setBusinesses] = useState<Biz[]>([]);
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [allergies, setAllergies] = useState('');
  const [conditions, setConditions] = useState('');
  const [notes, setNotes] = useState('');
  const [consent, setConsent] = useState(false);
  const [photos, setPhotos] = useState<ClientPhoto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loadBusinesses = useCallback(async () => {
    setError(null);
    const user = await getCurrentUser();
    if (!user) {
      setLoading(false);
      return;
    }
    setUserId(user.id);
    const { data: apts } = await supabase
      .from('appointments')
      .select('business_id, business_profiles(name)')
      .eq('client_user_id', user.id);
    const map = new Map<string, string>();
    for (const a of (apts ?? []) as unknown as Array<{
      business_id: string;
      business_profiles?: { name: string | null } | Array<{ name: string | null }> | null;
    }>) {
      const profile = Array.isArray(a.business_profiles)
        ? a.business_profiles[0]
        : a.business_profiles;
      if (!map.has(a.business_id) && profile?.name) {
        map.set(a.business_id, profile.name);
      }
    }
    const list = [...map.entries()].map(([id, name]) => ({ id, name }));
    setBusinesses(list);
    if (!businessId && list.length > 0) setBusinessId(list[0].id);
    setLoading(false);
  }, [businessId]);

  const loadRecord = useCallback(async () => {
    if (!userId || !businessId) return;
    const { data } = await supabase
      .from('client_intake')
      .select('*')
      .eq('business_id', businessId)
      .eq('client_user_id', userId)
      .maybeSingle();
    if (data) {
      setAllergies(data.allergies ?? '');
      setConditions(data.conditions ?? '');
      setNotes(data.notes ?? '');
      setConsent(Boolean(data.photo_consent));
    } else {
      setAllergies('');
      setConditions('');
      setNotes('');
      setConsent(false);
    }
    const { data: ph } = await supabase
      .from('client_photos')
      .select('*')
      .eq('business_id', businessId)
      .eq('client_user_id', userId)
      .order('created_at', { ascending: false });
    setPhotos(await withSignedUrls((ph ?? []) as ClientPhoto[]));
  }, [userId, businessId]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void loadBusinesses();
    }, [loadBusinesses])
  );

  useFocusEffect(
    useCallback(() => {
      void loadRecord();
    }, [loadRecord])
  );

  async function save() {
    if (!userId || !businessId) return;
    setError(null);
    setMessage(null);
    const { error: err } = await supabase.from('client_intake').upsert(
      {
        business_id: businessId,
        client_user_id: userId,
        allergies: normalizeIntakeText(allergies),
        conditions: normalizeIntakeText(conditions),
        notes: normalizeIntakeText(notes),
        photo_consent: consent,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'business_id,client_user_id' }
    );
    if (err) {
      setError(err.message);
      return;
    }
    setMessage(trKey('int.saved'));
  }

  if (loading) {
    return (
      <ListLoadingScreen
        title={tr('int.title')}
        subtitle={tr('int.subtitle')}
        onBack={back}
        label={tr('book.loadingAgenda')}
      />
    );
  }

  return (
    <Screen title={tr('int.title')} subtitle={tr('int.subtitle')} onBack={back}>
      {error ? <Callout tone="danger">{error}</Callout> : null}
      {message ? <Callout tone="success">{message}</Callout> : null}
      <SectionTitle>{tr('int.pickBiz')}</SectionTitle>
      <View style={styles.chips}>
        {businesses.map((b) => (
          <Pressable
            key={b.id}
            onPress={() => setBusinessId(b.id)}
            style={[
              styles.chip,
              {
                backgroundColor: businessId === b.id ? t.colors.accentSoft : t.colors.surface,
                borderColor: businessId === b.id ? t.colors.accent : t.colors.border,
              },
            ]}
          >
            <Text style={{ color: t.colors.text }}>{b.name}</Text>
          </Pressable>
        ))}
      </View>
      {businessId ? (
        <>
          <Field
            label={tr('int.allergies')}
            value={allergies}
            onChangeText={setAllergies}
            placeholder={tr('int.allergiesPh')}
          />
          <Field
            label={tr('int.conditions')}
            value={conditions}
            onChangeText={setConditions}
            placeholder={tr('int.conditionsPh')}
          />
          <Field label={tr('int.notes')} value={notes} onChangeText={setNotes} />
          <Pressable
            onPress={() => setConsent((v) => !v)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: consent }}
            style={[
              styles.consent,
              { borderColor: consent ? t.colors.accent : t.colors.border },
            ]}
          >
            <Text style={{ color: t.colors.text }}>{tr('int.consent')}</Text>
          </Pressable>
          <Button label={tr('int.save')} icon="checkmark" onPress={() => void save()} />
          <SectionTitle>{tr('int.photos')}</SectionTitle>
          {photos.length === 0 ? (
            <Text style={[styles.meta, { color: t.colors.textMuted }]}>
              {tr('int.noPhotos')}
            </Text>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
              {photos.map((p) => (
                <View key={p.id} style={styles.photo}>
                  {p.signedUrl ? <Image source={{ uri: p.signedUrl }} style={styles.thumb} /> : null}
                  <Text style={[styles.meta, { color: t.colors.textMuted }]}>
                    {p.kind === 'after' ? tr('int.after') : tr('int.before')}
                  </Text>
                </View>
              ))}
            </ScrollView>
          )}
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  meta: { fontSize: fontSize.sm },
  consent: { padding: spacing.md, borderRadius: radius.lg, borderWidth: 1 },
  row: { gap: spacing.sm },
  photo: { gap: spacing.xs, alignItems: 'center' },
  thumb: { width: 96, height: 96, borderRadius: radius.md },
});
