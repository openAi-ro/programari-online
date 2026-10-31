import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import { AuthAccountForm } from '@/components/AuthAccountForm';

export default function BusinessAuthScreen() {
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const form = <AuthAccountForm kind="business" initialMode={mode === 'login' ? 'login' : 'register'} />;
  if (Platform.OS === 'ios') {
    return (
      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        {form}
      </KeyboardAvoidingView>
    );
  }
  return <View style={styles.flex}>{form}</View>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
});
