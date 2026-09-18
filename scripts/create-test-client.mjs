// Creează (sau resetează parola) un cont de client de test, folosind cheia service_role.
// Folosire: node scripts/create-test-client.mjs [email] [parola]
// Doar pentru dev/testare. Nu rula pe producție cu credențiale reale de client.

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://tucujqpgshrmljkmqvnl.supabase.co';
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE;
if (!SERVICE_ROLE) {
  console.error('Lipsește SUPABASE_SERVICE_ROLE în mediu.');
  process.exit(1);
}

const email = process.argv[2] || 'client.test@programari.ro';
const password = process.argv[3] || 'TestClient2026!';
const displayName = 'Client Test';

const headers = {
  apikey: SERVICE_ROLE,
  Authorization: `Bearer ${SERVICE_ROLE}`,
  'Content-Type': 'application/json',
};

async function adminFetch(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}${path}`, { ...init, headers: { ...headers, ...(init.headers || {}) } });
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: res.status, body };
}

// 1) Caută userul existent după email
const list = await adminFetch(`/auth/v1/admin/users?email=${encodeURIComponent(email)}`);
const existing = Array.isArray(list.body?.users)
  ? list.body.users.find((u) => (u.email || '').toLowerCase() === email.toLowerCase())
  : null;

let userId;

if (existing) {
  userId = existing.id;
  const upd = await adminFetch(`/auth/v1/admin/users/${userId}`, {
    method: 'PUT',
    body: JSON.stringify({
      password,
      email_confirm: true,
      user_metadata: { display_name: displayName, account_kind: 'client' },
    }),
  });
  console.log(`[auth] user existent, parolă resetată: ${userId} (status ${upd.status})`);
} else {
  const created = await adminFetch('/auth/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: displayName, account_kind: 'client' },
    }),
  });
  if (created.status >= 300) {
    console.error('[auth] creare eșuată:', created.status, JSON.stringify(created.body));
    process.exit(1);
  }
  userId = created.body.id;
  console.log(`[auth] user creat: ${userId}`);
}

// 2) Asigură profilul de client (triggerul handle_new_user ar trebui să-l fi creat deja)
const profile = await adminFetch(`/rest/v1/profiles?id=eq.${userId}&select=id,email,display_name,account_kind,notify_reminders,notify_decision`, {
  headers: { Prefer: 'return=representation' },
});
console.log('[profil]', JSON.stringify(profile.body));

if (!Array.isArray(profile.body) || profile.body.length === 0) {
  const ins = await adminFetch('/rest/v1/profiles', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify([{ id: userId, email, display_name: displayName, account_kind: 'client' }]),
  });
  console.log('[profil] inserat manual:', ins.status, JSON.stringify(ins.body));
} else if (profile.body[0].account_kind !== 'client') {
  const upd = await adminFetch(`/rest/v1/profiles?id=eq.${userId}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_kind: 'client', display_name: displayName }),
  });
  console.log('[profil] corectat la client:', upd.status, JSON.stringify(upd.body));
}

// 3) Verifică login-ul cu anon key (același drum ca aplicația)
const anon = process.env.SUPABASE_ANON_KEY;
if (anon) {
  const login = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anon, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const j = await login.json().catch(() => null);
  console.log(`[login] status ${login.status}${j?.access_token ? ' — token primit' : ' — ' + JSON.stringify(j)}`);
}

console.log('\nCont de test:');
console.log(`  email:    ${email}`);
console.log(`  parola:   ${password}`);
console.log(`  user id:  ${userId}`);