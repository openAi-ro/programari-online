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
  sendEmailOtp,
  sendPhoneOtp,
  verifyOtp,
} from '@/lib/auth';

/** Phone login disabled until Supabase Phone provider (Twilio etc.) is configured. */
const PHONE_AUTH_ENABLED = false;

type Method = 'email' | 'phone';

export default function LoginScreen() {
  const [method, setMethod] = useState<Method>('email');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSendOtp() {
    setError(null);
    setMessage(null);

    if (method === 'email') {
      if (!email.trim()) {
        setError('Introdu adresa de email pentru a continua.');
        return;
      }
      setLoading(true);
      const { error: err } = await sendEmailOtp(email);
      setLoading(false);
      if (err) {
        setError(mapAuthError(err) ?? err.message);
        return;
      }
      setOtpSent(true);
      setMessage('Am trimis un cod pe email. Verifică și inbox, și spam.');
      return;
    }

    if (!PHONE_AUTH_ENABLED) {
      setError(
        'Login cu telefon nu e activ încă. Folosește email. (SMS necesită Twilio în Supabase.)'
      );
      return;
    }

    if (!phone.trim()) {
      setError('Introdu telefonul în format +40722123456.');
      return;
    }
    setLoading(true);
    const { error: err } = await sendPhoneOtp(phone);
    setLoading(false);
    if (err) {
      setError(mapAuthError(err) ?? err.message);
      return;
    }
    setOtpSent(true);
    setMessage('Am trimis un cod SMS. Introdu-l mai jos.');
  }

  async function handleVerify() {
    setError(null);
    setMessage(null);
    if (!otp.trim()) {
      setError('Introdu codul primit pe email.');
      return;
    }
    setLoading(true);
    const { error: err } =
      method === 'email'
        ? await verifyOtp({ email, token: otp, type: 'email' })
        : await verifyOtp({ phone, token: otp, type: 'sms' });
    setLoading(false);
    if (err) {
      setError(mapAuthError(err) ?? err.message);
      return;
    }
    setMessage('Autentificare reușită.');
  }

  function switchMethod(next: Method) {
    if (next === 'phone' && !PHONE_AUTH_ENABLED) {
      setError(
        'Login cu telefon nu e activ pe server. Folosește tab-ul Email.'
      );
      return;
    }
    setMethod(next);
    setOtpSent(false);
    setOtp('');
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
        Autentificare cu email (cod OTP pe mail)
      </Text>

      <View style={styles.tabs}>
        <Pressable
          style={[styles.tab, method === 'email' && styles.tabActive]}
          onPress={() => switchMethod('email')}
        >
          <Text style={[styles.tabText, method === 'email' && styles.tabTextActive]}>
            Email
          </Text>
        </Pressable>
        <Pressable
          style={[styles.tab, styles.tabDisabled, method === 'phone' && styles.tabActive]}
          onPress={() => switchMethod('phone')}
        >
          <Text style={[styles.tabText, method === 'phone' && styles.tabTextActive]}>
            Telefon (în curând)
          </Text>
        </Pressable>
      </View>

      {method === 'email' ? (
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
      ) : (
        <TextInput
          style={styles.input}
          keyboardType="phone-pad"
          autoComplete="tel"
          placeholder="+40722123456"
          value={phone}
          onChangeText={setPhone}
          editable={!loading && PHONE_AUTH_ENABLED}
        />
      )}

      {otpSent && (
        <TextInput
          style={styles.input}
          keyboardType="number-pad"
          placeholder="Cod din email"
          value={otp}
          onChangeText={setOtp}
          editable={!loading}
          maxLength={8}
        />
      )}

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {message ? <Text style={styles.message}>{message}</Text> : null}

      {loading ? (
        <ActivityIndicator style={{ marginTop: 16 }} />
      ) : (
        <Pressable
          style={styles.button}
          onPress={otpSent ? handleVerify : handleSendOtp}
        >
          <Text style={styles.buttonText}>
            {otpSent ? 'Verifică codul' : 'Trimite cod pe email'}
          </Text>
        </Pressable>
      )}

      {otpSent ? (
        <Pressable onPress={() => setOtpSent(false)} style={styles.link}>
          <Text style={styles.linkText}>Schimbă emailul / retrimite</Text>
        </Pressable>
      ) : null}

      <Text style={styles.hint}>
        Nu ai SMS activ pe Supabase. Contul se face cu email; poți adăuga telefonul
        mai târziu la programări / setări.
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
  tabDisabled: {
    opacity: 0.7,
  },
  tabActive: {
    backgroundColor: '#fff',
  },
  tabText: {
    color: '#666',
    fontWeight: '500',
    fontSize: 13,
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
  link: {
    marginTop: 16,
    alignItems: 'center',
  },
  linkText: {
    color: '#2563eb',
  },
  hint: {
    marginTop: 24,
    fontSize: 12,
    color: '#888',
    textAlign: 'center',
    lineHeight: 18,
  },
});
