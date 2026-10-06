import { Stack } from 'expo-router';

/** Header-ul nativ e oprit: fiecare ecran isi deseneaza propriul header din Screen. */
export default function AppLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="home" />
      <Stack.Screen name="browse/index" />
      <Stack.Screen name="browse/[categoryId]" />
      <Stack.Screen name="map" />
      <Stack.Screen name="my-appointments" />
      <Stack.Screen name="favorites" />
      <Stack.Screen name="settings" />
      <Stack.Screen name="scan" />
      <Stack.Screen name="book/[publicCode]" />
      <Stack.Screen name="chat/index" />
      <Stack.Screen name="chat/[conversationId]" />
      <Stack.Screen name="business" />
    </Stack>
  );
}
