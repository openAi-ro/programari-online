import { Link } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { registerForPushAsync } from '@/lib/notifications';
import { supabase } from '@/lib/supabase';

const LINKS: { href: string; label: string; hint: string }[] = [
  {
    href: '/(app)/business/setup',
    label: 'Configurare business',
    hint: 'Nume, program, timezone, durată',
  },
  {
    href: '/(app)/business/qr',
    label: 'Cod QR business',
    hint: 'Arată sau partajează linkul de rezervare',
  },
  {
    href: '/(app)/business/requests',
    label: 'Cereri programări',
    hint: 'Aprobă sau respinge cererile pending',
  },
  {
    href: '/(app)/scan',
    label: 'Scanează QR',
    hint: 'Rezervă la un business prin QR',
  },
  {
    href: '/(app)/my-appointments',
    label: 'Programările mele',
    hint: 'Vezi statusul rezervărilor tale',
  },
  {
    href: '/(app)/settings',
    label: 'Setări',
    hint: 'Profil, notificări push și deconectare',
  },
];

export default function HomeScreen() {
  const [hasBusiness, setHasBusiness] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      try {
        await registerForPushAsync(user.id);
      } catch (e) {
        console.warn('Push register on home failed', e);
      }
      const { data } = await supabase
        .from('business_profiles')
        .select('id')
        .eq('owner_user_id', user.id)
        .maybeSingle();
      if (!cancelled) setHasBusiness(!!data);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Programari</Text>
      <Text style={styles.subtitle}>Alege o acțiune</Text>

      {hasBusiness === false ? (
        <Link href="/(app)/business/setup" asChild>
          <Pressable style={styles.cta}>
            <Text style={styles.ctaTitle}>Configurează agenda</Text>
            <Text style={styles.ctaHint}>
              Nu ai încă un profil business. Setează timezone, program și generează QR-ul.
            </Text>
          </Pressable>
        </Link>
      ) : null}

      {LINKS.map((item) => (
        <Link key={item.href} href={item.href as any} asChild>
          <Pressable style={styles.card}>
            <Text style={styles.cardTitle}>{item.label}</Text>
            <Text style={styles.cardHint}>{item.hint}</Text>
          </Pressable>
        </Link>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    marginBottom: 4,
  },
  subtitle: {
    color: '#64748b',
    marginBottom: 16,
  },
  cta: {
    backgroundColor: '#eff6ff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#93c5fd',
  },
  ctaTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1d4ed8',
  },
  ctaHint: {
    fontSize: 13,
    color: '#1e40af',
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
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0f172a',
  },
  cardHint: {
    fontSize: 13,
    color: '#64748b',
    marginTop: 4,
  },
});
