import { Stack } from 'expo-router';

export default function AuthLayout() {
  return (
    <Stack>
      <Stack.Screen name="login" options={{ title: 'Autentificare', headerShown: false }} />
      <Stack.Screen name="client" options={{ title: 'Cont client', headerShown: false }} />
      <Stack.Screen name="business" options={{ title: 'Cont business', headerShown: false }} />
      <Stack.Screen
        name="forgot-password"
        options={{ title: 'Resetare parolă', headerShown: false }}
      />
      <Stack.Screen
        name="reset-password"
        options={{ title: 'Parolă nouă', headerShown: false }}
      />
    </Stack>
  );
}
