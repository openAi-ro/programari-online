import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';

import { getBookingPaths } from '@/lib/bookingLink';
import { supabase } from '@/lib/supabase';
import type { BusinessProfile } from '@/lib/types';

export default function BusinessQrScreen() {
  const [business, setBusiness] = useState<BusinessProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        setError('Nu ești autentificat.');
        return;
      }
      const { data, error: err } = await supabase
        .from('business_profiles')
        .select('*')
        .eq('owner_user_id', user.id)
        .maybeSingle();
      if (err) {
        setError(err.message);
      } else if (!data) {
        setError('Configurează mai întâi business-ul.');
      } else {
        setBusiness(data as BusinessProfile);
      }
      setLoading(false);
    })();
  }, []);

  const links = useMemo(
    () => (business ? getBookingPaths(business.public_code) : null),
    [business]
  );

  // QR folosește linkul Expo (deschide app-ul în Expo Go pe același Wi‑Fi)
  const qrValue = links?.expoUrl ?? links?.appScheme ?? '';

  async function handleShare() {
    if (!links || !business) return;
    await Share.share({
      message: `Rezervă la ${business.name}\n\nDeschide în app:\n${links.expoUrl}\n\nSau cod: ${links.code}`,
      url: links.expoUrl,
    });
  }

  async function handleCopy() {
    if (!links) return;
    await Clipboard.setStringAsync(links.expoUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function openBookingInApp() {
    if (!links) return;
    router.push(links.route as any);
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  if (error || !business || !links) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error ?? 'Business negăsit.'}</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>{business.name}</Text>
      <Text style={styles.hint}>
        Clienții scanează QR-ul ca să aleagă o oră liberă pe agenda ta.
      </Text>

      <View style={styles.qrWrap}>
        <QRCode value={qrValue} size={220} />
      </View>

      <Text style={styles.codeLabel}>Cod business</Text>
      <Text style={styles.code} selectable>
        {links.code}
      </Text>

      {/* Cel mai important pe un singur telefon */}
      <Pressable style={styles.primaryButton} onPress={openBookingInApp}>
        <Text style={styles.primaryButtonText}>
          Deschide programarea acum (în app)
        </Text>
      </Pressable>
      <Text style={styles.help}>
        Pe același telefon: nu e nevoie de cameră. Apasă butonul de mai sus → alegi
        data și ora liberă.
      </Text>

      <Pressable style={styles.secondaryButton} onPress={handleShare}>
        <Text style={styles.secondaryButtonText}>Partajează link</Text>
      </Pressable>
      <Pressable style={styles.secondaryButton} onPress={handleCopy}>
        <Text style={styles.secondaryButtonText}>
          {copied ? 'Copiat!' : 'Copiază link Expo'}
        </Text>
      </Pressable>

      <Text style={styles.link} selectable>
        {links.expoUrl}
      </Text>

      <View style={styles.noteBox}>
        <Text style={styles.noteTitle}>De ce camera nu deschide app-ul?</Text>
        <Text style={styles.note}>
          Camera telefonului nu știe de „Programari” cât timp rulezi în Expo Go.
          Schemele custom (programari://) merg după ce publici app-ul (APK/App Store).
          {'\n\n'}
          • Pe același telefon: butonul „Deschide programarea acum”.{'\n'}
          • Al doilea telefon: app → Scanează QR (scannerul din Programari).{'\n'}
          • Sau deschide linkul Expo copiat pe telefonul unde e Expo Go deschis.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    padding: 24,
    paddingBottom: 48,
    backgroundColor: '#fff',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  title: { fontSize: 22, fontWeight: '700', marginBottom: 8 },
  hint: { color: '#64748b', marginBottom: 20, textAlign: 'center' },
  qrWrap: {
    padding: 16,
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  codeLabel: {
    marginTop: 16,
    fontSize: 12,
    color: '#64748b',
    textTransform: 'uppercase',
  },
  code: {
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 16,
    color: '#0f172a',
  },
  primaryButton: {
    backgroundColor: '#2563eb',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 10,
    width: '100%',
    alignItems: 'center',
  },
  primaryButtonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  help: {
    marginTop: 10,
    marginBottom: 16,
    fontSize: 13,
    color: '#475569',
    textAlign: 'center',
    lineHeight: 18,
  },
  secondaryButton: {
    marginTop: 8,
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
    width: '100%',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  secondaryButtonText: { color: '#0f172a', fontWeight: '600' },
  link: {
    marginTop: 16,
    fontSize: 11,
    color: '#64748b',
    textAlign: 'center',
  },
  noteBox: {
    marginTop: 24,
    padding: 14,
    backgroundColor: '#fffbeb',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#fcd34d',
    width: '100%',
  },
  noteTitle: { fontWeight: '700', color: '#92400e', marginBottom: 6 },
  note: { fontSize: 12, color: '#78350f', lineHeight: 18 },
  error: { color: '#b91c1c', textAlign: 'center' },
});
