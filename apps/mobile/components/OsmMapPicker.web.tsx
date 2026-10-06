import { View } from 'react-native';

type Props = {
  latitude: number | null;
  longitude: number | null;
  onPick: (coords: { latitude: number; longitude: number }) => void;
  height?: number;
};

/**
 * Web stub — map picker not used by production routes (setup uses maps_url text).
 * Prevents accidental web bundling of WebView/OSM picker weight.
 */
export function OsmMapPicker(_props: Props) {
  return <View />;
}
