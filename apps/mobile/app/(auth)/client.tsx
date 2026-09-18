import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';

import { AuthAccountForm } from '@/components/AuthAccountForm';

export default function ClientAuthScreen() {
  const form = <AuthAccountForm kind="client" />;
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
