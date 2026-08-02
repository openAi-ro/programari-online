import { Redirect, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';

/** Deep link: programari://b/{publicCode} → booking screen */
export default function BusinessDeepLink() {
  const { publicCode } = useLocalSearchParams<{ publicCode: string }>();
  const code = String(publicCode ?? '').trim();

  if (!code) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <Text>Cod invalid</Text>
      </View>
    );
  }

  return <Redirect href={`/(app)/book/${code}`} />;
}
