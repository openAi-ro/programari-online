import { Link, router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { registerForPushAsync } from '@/lib/notifications';
import { supabase } from '@/lib/supabase';

type Biz = { id: string; name: string; public_code: string };

export default function HomeScreen() {
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState<string | null>(null);
  const [business, setBusiness] = useState<Biz | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        setLoading(true);
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user || cancelled) {
          if (!cancelled) setLoading(false);
          return;
        }
        setEmail(user.email ?? null);

        try {
          await registerForPushAsync(user.id);
        } catch (e) {
          console.warn('Push register on home failed', e);
        }

        // Asigură profil (dacă trigger-ul nu a rulat la signup)
        await supabase.from('profiles').upsert(
          {
            id: user.id,
            email: user.email ?? null,
            phone: user.phone ?? null,
          },
          { onConflict: 'id' }
        );

        const { data } = await supabase
          .from('business_profiles')
          .select('id, name, public_code')
          .eq('owner_user_id', user.id)
          .maybeSingle();

        if (!cancelled) {
          setBusiness(data as Biz | null);
          setLoading(false);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [])
  );

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
        <Text style={styles.loadingText}>Se încarcă…</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Programari</Text>
      <Text style={styles.subtitle}>
        Conectat{email ? `: ${email}` : ''}. Un singur cont = business + client.
      </Text>

      {/* Ghid mobil un cont */}
      <View style={styles.guide}>
        <Text style={styles.guideTitle}>Pe telefon, cu un singur email</Text>
        <Text style={styles.guideStep}>1. Configurează agenda (business)</Text>
        <Text style={styles.guideStep}>2. Deschide QR-ul / copiază codul</Text>
        <Text style={styles.guideStep}>
          3. „Testează ca client” — te programezi la tine (același cont e OK)
        </Text>
        <Text style={styles.guideStep}>
          4. „Cereri” — aprobi sau respingi programarea
        </Text>
        <Text style={styles.guideNote}>
          Nu ai nevoie de al doilea email. Rolurile business și client sunt pe același
          cont.
        </Text>
      </View>

      {!business ? (
        <Pressable
          style={styles.cta}
          onPress={() => router.push('/(app)/business/setup')}
        >
          <Text style={styles.ctaTitle}>1. Configurează agenda</Text>
          <Text style={styles.ctaHint}>
            Timezone, durată ședință, program de lucru, pauză → se generează QR.
          </Text>
        </Pressable>
      ) : (
        <View style={styles.bizBox}>
          <Text style={styles.bizLabel}>Business-ul tău</Text>
          <Text style={styles.bizName}>{business.name}</Text>
          <Text style={styles.bizCode}>Cod: {business.public_code}</Text>

          <Pressable
            style={styles.primaryBtn}
            onPress={() => router.push('/(app)/business/qr')}
          >
            <Text style={styles.primaryBtnText}>Vezi QR / partajează</Text>
          </Pressable>

          <Pressable
            style={styles.secondaryBtn}
            onPress={() =>
              router.push(`/(app)/book/${business.public_code}` as any)
            }
          >
            <Text style={styles.secondaryBtnText}>
              Testează ca client (același cont)
            </Text>
          </Pressable>

          <Pressable
            style={styles.secondaryBtn}
            onPress={() => router.push('/(app)/business/requests')}
          >
            <Text style={styles.secondaryBtnText}>Cereri — aprobă / respinge</Text>
          </Pressable>
        </View>
      )}

      <Text style={styles.section}>Toate acțiunile</Text>

      <Link href="/(app)/business/setup" asChild>
        <Pressable style={styles.card}>
          <Text style={styles.cardTitle}>Configurare business</Text>
          <Text style={styles.cardHint}>Nume, program, timezone, durată, pauză</Text>
        </Pressable>
      </Link>

      <Link href="/(app)/business/qr" asChild>
        <Pressable style={styles.card}>
          <Text style={styles.cardTitle}>Cod QR business</Text>
          <Text style={styles.cardHint}>Arată sau partajează linkul de rezervare</Text>
        </Pressable>
      </Link>

      <Link href="/(app)/business/requests" asChild>
        <Pressable style={styles.card}>
          <Text style={styles.cardTitle}>Cereri programări</Text>
          <Text style={styles.cardHint}>Aprobă sau respinge cererile pending</Text>
        </Pressable>
      </Link>

      <Link href="/(app)/scan" asChild>
        <Pressable style={styles.card}>
          <Text style={styles.cardTitle}>Scanează QR</Text>
          <Text style={styles.cardHint}>
            Pentru alt business (sau codul tău, pe un al doilea telefon)
          </Text>
        </Pressable>
      </Link>

      <Link href="/(app)/my-appointments" asChild>
        <Pressable style={styles.card}>
          <Text style={styles.cardTitle}>Programările mele (ca client)</Text>
          <Text style={styles.cardHint}>Status: așteptare / confirmat / respins</Text>
        </Pressable>
      </Link>

      <Link href="/(app)/settings" asChild>
        <Pressable style={styles.card}>
          <Text style={styles.cardTitle}>Setări</Text>
          <Text style={styles.cardHint}>Profil, push, deconectare</Text>
        </Pressable>
      </Link>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  content: { padding: 20, paddingBottom: 48 },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
  },
  loadingText: { marginTop: 12, color: '#64748b' },
  title: { fontSize: 26, fontWeight: '700', marginBottom: 4 },
  subtitle: { color: '#64748b', marginBottom: 16, fontSize: 14 },
  guide: {
    backgroundColor: '#ecfdf5',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#6ee7b7',
  },
  guideTitle: {
    fontWeight: '700',
    color: '#065f46',
    marginBottom: 8,
    fontSize: 15,
  },
  guideStep: { color: '#047857', fontSize: 13, marginBottom: 4, lineHeight: 18 },
  guideNote: {
    marginTop: 8,
    fontSize: 12,
    color: '#064e3b',
    fontStyle: 'italic',
  },
  cta: {
    backgroundColor: '#eff6ff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#93c5fd',
  },
  ctaTitle: { fontSize: 16, fontWeight: '700', color: '#1d4ed8' },
  ctaHint: { fontSize: 13, color: '#1e40af', marginTop: 4 },
  bizBox: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  bizLabel: { fontSize: 12, color: '#64748b', textTransform: 'uppercase' },
  bizName: { fontSize: 20, fontWeight: '700', color: '#0f172a', marginTop: 4 },
  bizCode: { fontSize: 13, color: '#475569', marginTop: 4, marginBottom: 12 },
  primaryBtn: {
    backgroundColor: '#2563eb',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 8,
  },
  primaryBtnText: { color: '#fff', fontWeight: '600' },
  secondaryBtn: {
    backgroundColor: '#f1f5f9',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  secondaryBtnText: { color: '#0f172a', fontWeight: '600', fontSize: 14 },
  section: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748b',
    marginBottom: 8,
    marginTop: 4,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  cardTitle: { fontSize: 16, fontWeight: '600', color: '#0f172a' },
  cardHint: { fontSize: 13, color: '#64748b', marginTop: 4 },
});
