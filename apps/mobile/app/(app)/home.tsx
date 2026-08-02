import { Link } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

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
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Programari</Text>
      <Text style={styles.subtitle}>Alege o acțiune</Text>
      {LINKS.map((item) => (
        <Link key={item.href} href={item.href as any} asChild>
          <Pressable style={styles.card}>
            <Text style={styles.cardTitle}>{item.label}</Text>
            <Text style={styles.cardHint}>{item.hint}</Text>
          </Pressable>
        </Link>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: '#f8fafc',
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
