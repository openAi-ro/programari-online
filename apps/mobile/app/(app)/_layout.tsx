import { Stack } from 'expo-router';

/** Header-ul nativ e oprit: fiecare ecran își desenează propriul header din `Screen`. */
export default function AppLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
