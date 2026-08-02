import { Stack } from 'expo-router';

export default function AppLayout() {
  return (
    <Stack>
      <Stack.Screen name="home" options={{ title: 'Programari' }} />
      <Stack.Screen name="settings" options={{ title: 'Setări' }} />
      <Stack.Screen name="my-appointments" options={{ title: 'Programările mele' }} />
      <Stack.Screen name="scan" options={{ title: 'Scanează QR' }} />
      <Stack.Screen name="business/setup" options={{ title: 'Configurare business' }} />
      <Stack.Screen name="business/qr" options={{ title: 'Cod QR' }} />
      <Stack.Screen name="business/requests" options={{ title: 'Cereri' }} />
      <Stack.Screen name="book/[publicCode]" options={{ title: 'Rezervare' }} />
    </Stack>
  );
}
