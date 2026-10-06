import { View } from 'react-native';

type Props = {
  latitude: number | null;
  longitude: number | null;
  onPick: (coords: { latitude: number; longitude: number }) => void;
  height?: number;
};

/**
 * Web stub — react-native-maps is native-only. Production screens use maps_url text.
 * Keeps GoogleMapPicker out of the web production import graph for maps.
 */
export function GoogleMapPicker(_props: Props) {
  return <View />;
}
