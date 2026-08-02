import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { supabase } from '@/lib/supabase';
import type { BusinessProfile } from '@/lib/types';

export default function BusinessQrScreen() {
  const [business, setBusiness] = useState<BusinessProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  const deepLink = business ? `programari://b/${business.public_code}` : '';

  async function handleShare() {
    if (!deepLink) return;
    await Share.share({
      message: `Rezervă la ${business?.name}: ${deepLink}`,
      url: deepLink,
    });
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  if (error || !business) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error ?? 'Business negăsit.'}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{business.name}</Text>
      <Text style={styles.hint}>Clienții scanează acest QR pentru a rezerva</Text>
      <View style={styles.qrWrap}>
        <QRCode value={deepLink} size={220} />
      </View>
      <Text style={styles.link} selectable>
        {deepLink}
      </Text>
      <Pressable style={styles.button} onPress={handleShare}>
        <Text style={styles.buttonText}>Partajează</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#fff',
  },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  title: { fontSize: 22, fontWeight: '700', marginBottom: 8 },
  hint: { color: '#64748b', marginBottom: 24, textAlign: 'center' },
  qrWrap: {
    padding: 16,
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  link: {
    marginTop: 20,
    fontSize: 14,
    color: '#2563eb',
    textAlign: 'center',
  },
  button: {
    marginTop: 20,
    backgroundColor: '#2563eb',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
  },
  buttonText: { color: '#fff', fontWeight: '600' },
  error: { color: '#b91c1c', textAlign: 'center' },
});
