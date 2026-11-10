import { AVATAR_COLORS, avatarColor, clientIdsOf, clientInitials } from './clientAvatar';

let n = 0;
const ok = (c: boolean, l: string) => {
  if (!c) throw new Error(`FAIL: ${l}`);
  n += 1;
};

ok(clientInitials('Ana Maria Pop') === 'AP', 'prima + ultima initiala');
ok(clientInitials('ion') === 'I', 'un cuvant -> o initiala, majuscula');
ok(clientInitials('  ștefan   țurcan ') === 'ȘȚ', 'diacritice + spatii');
ok(clientInitials('') === null && clientInitials(null) === null, 'fara nume -> iconita');
ok(clientInitials('+40 722') === '47', 'doar cifre -> cifre');
ok(clientInitials('— ...') === null, 'doar semne -> iconita');
ok(avatarColor('user-1') === avatarColor('user-1'), 'culoare stabila');
ok((AVATAR_COLORS as readonly string[]).includes(avatarColor('x')), 'culoare din paleta');
const spread = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].map(avatarColor));
ok(spread.size >= 4, 'id-uri diferite -> culori variate');
ok(clientIdsOf([{ client_user_id: 'a' }, { client_user_id: null }, { client_user_id: 'a' }, { client_user_id: 'b' }]).join() === 'a,b', 'id-uri unice fara null');

console.log(`clientAvatar: ${n} passed, 0 failed`);
