import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  mapAuthError,
  signInWithPassword,
  signUpWithPassword,
} from '@/lib/auth';

type Mode = 'login' | 'register';

export default function LoginScreen() {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setError(null);
    setMessage(null);

    const e = email.trim();
    if (!e) {
      setError('Introdu adresa de email.');
      return;
    }
    if (!password || password.length < 6) {
      setError('Parola trebuie să aibă cel puțin 6 caractere.');
      return;
    }

    setLoading(true);
    if (mode === 'register') {
      const { data, error: err } = await signUpWithPassword(e, password);
      setLoading(false);
      if (err) {
        setError(mapAuthError(err) ?? err.message);
        return;
      }
      // Dacă confirm email e dezactivat, avem sesiune imediat
      if (data.session) {
        setMessage('Cont creat. Ești autentificat.');
        return;
      }
      setMessage(
        'Cont creat. Dacă ți se cere confirmare pe email: fie apeși linkul DOAR după ce ai setat Site URL la app, fie în Supabase dezactivezi „Confirm email” (Auth → Providers → Email). Apoi folosește „Intră în cont”.'
      );
      setMode('login');
      return;
    }

    const { error: err } = await signInWithPassword(e, password);
    setLoading(false);
    if (err) {
      setError(mapAuthError(err) ?? err.message);
      return;
    }
    setMessage('Autentificare reușită.');
  }

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setMessage(null);
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Text style={styles.title}>Programari</Text>
      <Text style={styles.subtitle}>
        Email + parolă (funcționează pe telefon, fără link localhost)
      </Text>

      <View style={styles.tabs}>
        <Pressable
          style={[styles.tab, mode === 'login' && styles.tabActive]}
          onPress={() => switchMode('login')}
        >
          <Text style={[styles.tabText, mode === 'login' && styles.tabTextActive]}>
            Intră în cont
          </Text>
        </Pressable>
        <Pressable
          style={[styles.tab, mode === 'register' && styles.tabActive]}
          onPress={() => switchMode('register')}
        >
          <Text style={[styles.tabText, mode === 'register' && styles.tabTextActive]}>
            Cont nou
          </Text>
        </Pressable>
      </View>

      <TextInput
        style={styles.input}
        autoCapitalize="none"
        keyboardType="email-address"
        autoComplete="email"
        placeholder="email@exemplu.ro"
        value={email}
        onChangeText={setEmail}
        editable={!loading}
      />
      <TextInput
        style={styles.input}
        secureTextEntry
        autoComplete={mode === 'register' ? 'new-password' : 'password'}
        placeholder="Parolă (min. 6 caractere)"
        value={password}
        onChangeText={setPassword}
        editable={!loading}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {message ? <Text style={styles.message}>{message}</Text> : null}

      {loading ? (
        <ActivityIndicator style={{ marginTop: 16 }} />
      ) : (
        <Pressable style={styles.button} onPress={handleSubmit}>
          <Text style={styles.buttonText}>
            {mode === 'login' ? 'Intră în cont' : 'Creează cont'}
          </Text>
        </Pressable>
      )}

      <Text style={styles.hint}>
        Emailul pe care l-ai primit („Your sign-in link” / Sign in) e un magic link care
        duce greșit la localhost:3000 pe telefon. Nu-l folosi. Folosește email + parolă
        aici.{'\n\n'}
        Recomandat în Supabase (dezvoltare):{'\n'}
        Auth → Providers → Email → dezactivează „Confirm email”.
      </Text>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    color: '#555',
    marginBottom: 24,
    textAlign: 'center',
  },
  tabs: {
    flexDirection: 'row',
    marginBottom: 16,
    borderRadius: 10,
    backgroundColor: '#f0f0f0',
    padding: 4,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 8,
  },
  tabActive: {
    backgroundColor: '#fff',
  },
  tabText: {
    color: '#666',
    fontWeight: '500',
    fontSize: 14,
  },
  tabTextActive: {
    color: '#111',
    fontWeight: '700',
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    marginBottom: 12,
    backgroundColor: '#fafafa',
  },
  button: {
    backgroundColor: '#2563eb',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  error: {
    color: '#b91c1c',
    marginBottom: 8,
  },
  message: {
    color: '#166534',
    marginBottom: 8,
  },
  hint: {
    marginTop: 24,
    fontSize: 12,
    color: '#888',
    textAlign: 'center',
    lineHeight: 18,
  },
});
