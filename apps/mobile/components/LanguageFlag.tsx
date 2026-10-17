import { View } from 'react-native';
import Svg, { Circle, Rect } from 'react-native-svg';

const H = 14;

/** Steagul României (3:2), SVG — emoji-urile nu apar ca steaguri pe Windows. */
export function FlagRO({ height = H }: { height?: number }) {
  return (
    <View style={{ borderRadius: 2, overflow: 'hidden' }} accessibilityElementsHidden importantForAccessibility="no">
      <Svg width={(height * 3) / 2} height={height} viewBox="0 0 3 2">
        <Rect x={0} y={0} width={1} height={2} fill="#002B7F" />
        <Rect x={1} y={0} width={1} height={2} fill="#FCD116" />
        <Rect x={2} y={0} width={1} height={2} fill="#CE1126" />
      </Svg>
    </View>
  );
}

const US_W = 7410;
const US_H = 3900;
const STRIPE = US_H / 13;
const CANTON_W = 2964;
const CANTON_H = STRIPE * 7;
/** 50 de stele (9 rânduri alternante 6/5), desenate ca puncte la mărime mică. */
const US_STARS: { x: number; y: number }[] = (() => {
  const out: { x: number; y: number }[] = [];
  const dx = CANTON_W / 12;
  const dy = CANTON_H / 10;
  for (let row = 0; row < 9; row += 1) {
    const even = row % 2 === 0;
    for (let col = 0; col < (even ? 6 : 5); col += 1) {
      out.push({ x: dx * (even ? 1 + col * 2 : 2 + col * 2), y: dy * (row + 1) });
    }
  }
  return out;
})();

/** Steagul SUA (19:10), SVG. */
export function FlagUS({ height = H }: { height?: number }) {
  return (
    <View style={{ borderRadius: 2, overflow: 'hidden' }} accessibilityElementsHidden importantForAccessibility="no">
      <Svg width={(height * US_W) / US_H} height={height} viewBox={`0 0 ${US_W} ${US_H}`}>
        <Rect x={0} y={0} width={US_W} height={US_H} fill="#FFFFFF" />
        {Array.from({ length: 7 }, (_, i) => (
          <Rect key={i} x={0} y={i * 2 * STRIPE} width={US_W} height={STRIPE} fill="#B22234" />
        ))}
        <Rect x={0} y={0} width={CANTON_W} height={CANTON_H} fill="#3C3B6E" />
        {US_STARS.map((s, i) => (
          <Circle key={i} cx={s.x} cy={s.y} r={STRIPE * 0.31} fill="#FFFFFF" />
        ))}
      </Svg>
    </View>
  );
}