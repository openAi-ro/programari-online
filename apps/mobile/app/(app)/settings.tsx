import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { signOut } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/lib/types';

export default function SettingsScreen() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }
      const { data } = await supabase
        .from('profiles')
        .select('id, email, phone, display_name')
        .eq('id', user.id)
        .maybeSingle();
      if (data) {
        setProfile(data as Profile);
        setDisplayName(data.display_name ?? '');
      }
      setLoading(false);
    })();
  }, []);

  async function handleSave() {
    if (!profile) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    const { error: err } = await supabase
      .from('profiles')
      .update({ display_name: displayName.trim() || null })
      .eq('id', profile.id);
    setSaving(false);
    if (err) {
      setError(err.message);
      return;
    }
    setMessage('Profil actualizat.');
  }

  async function handleLogout() {
    setError(null);
    const { error: err } = await signOut();
    if (err) setError(err.message);
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Profil</Text>
      <Text style={styles.label}>Email</Text>
      <Text style={styles.value}>{profile?.email ?? '—'}</Text>
      <Text style={styles.label}>Telefon</Text>
      <Text style={styles.value}>{profile?.phone ?? '—'}</Text>
      <Text style={styles.label}>Nume afișat</Text>
      <TextInput
        style={styles.input}
        value={displayName}
        onChangeText={setDisplayName}
        placeholder="Numele tău"
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {message ? <Text style={styles.message}>{message}</Text> : null}
      <Pressable style={styles.button} onPress={handleSave} disabled={saving}>
        <Text style={styles.buttonText}>{saving ? 'Se salvează…' : 'Salvează'}</Text>
      </Pressable>
      <Pressable style={[styles.button, styles.logout]} onPress={handleLogout}>
        <Text style={styles.buttonText}>Deconectare</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, backgroundColor: '#fff' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  heading: { fontSize: 20, fontWeight: '700', marginBottom: 16 },
  label: { fontSize: 12, color: '#64748b', marginTop: 10 },
  value: { fontSize: 16, marginTop: 2 },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 4,
  },
  button: {
    backgroundColor: '#2563eb',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 16,
  },
  logout: { backgroundColor: '#64748b' },
  buttonText: { color: '#fff', fontWeight: '600' },
  error: { color: '#b91c1c', marginTop: 8 },
  message: { color: '#166534', marginTop: 8 },
});
