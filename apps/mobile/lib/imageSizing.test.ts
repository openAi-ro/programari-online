import { fitWithin, IMAGE_MAX_SIDE, imageTypeOf, imageTypeOfUri, keepEncoded } from './imageSizing';

let n = 0;
const ok = (c: boolean, l: string) => {
  if (!c) throw new Error(`FAIL: ${l}`);
  n += 1;
};

const big = fitWithin(4000, 3000, IMAGE_MAX_SIDE.photo);
ok(big.width === 1200 && big.height === 900 && big.scaled, 'landscape -> 1200x900');
const tall = fitWithin(3024, 4032, IMAGE_MAX_SIDE.avatar);
ok(tall.height === 512 && tall.width === 384 && tall.scaled, 'portrait -> latura lunga 512');
const small = fitWithin(400, 300, IMAGE_MAX_SIDE.avatar);
ok(small.width === 400 && small.height === 300 && !small.scaled, 'nu marim pozele mici');
ok(fitWithin(512, 512, 512).scaled === false, 'exact la limita nu se scaleaza');
ok(fitWithin(0, 0, 512).width === 1, 'dimensiuni minime 1px');

ok(imageTypeOf('image/webp').ext === 'webp', 'webp');
ok(imageTypeOf('image/png').ext === 'png', 'png');
ok(imageTypeOf('image/heic').contentType === 'image/jpeg', 'necunoscut -> jpeg');
ok(imageTypeOfUri('file:///x/IMG.PNG?x=1').ext === 'png', 'ext din uri png');
ok(imageTypeOfUri('file:///x/a.webp').contentType === 'image/webp', 'ext din uri webp');
ok(imageTypeOfUri('content://media/123').ext === 'jpg', 'uri fara ext -> jpg');

ok(keepEncoded({ scaled: true, encodedBytes: 900, sourceBytes: 500 }), 'micsorata -> pastram encodarea');
ok(!keepEncoded({ scaled: false, encodedBytes: 900, sourceBytes: 500 }), 'nemicsorata si mai mare -> original');
ok(keepEncoded({ scaled: false, encodedBytes: 300, sourceBytes: 500 }), 'nemicsorata dar mai mica -> encodata');

console.log(`imageSizing: ${n} passed, 0 failed`);
