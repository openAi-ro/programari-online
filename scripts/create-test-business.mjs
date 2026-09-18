// Creează (sau resetează) un cont de business de test cu locație completă, folosind cheia service_role.
// Folosire: node scripts/create-test-business.mjs
// Doar pentru dev/testare.

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://tucujqpgshrmljkmqvnl.supabase.co';
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE;
if (!SERVICE_ROLE) {
  console.error('Lipsește SUPABASE_SERVICE_ROLE în mediu.');
  process.exit(1);
}

const email = process.argv[2] || 'business.test@programari.ro';
const password = process.argv[3] || 'TestBusiness2026!';
const displayName = 'Business Test';
const bizName = 'Salon Test Locație';
const publicCode = 'salontestloc1';

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

// 1) Auth user
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
      user_metadata: { display_name: displayName, account_kind: 'business' },
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
      user_metadata: { display_name: displayName, account_kind: 'business' },
    }),
  });
  if (created.status >= 300) {
    console.error('[auth] creare eșuată:', created.status, JSON.stringify(created.body));
    process.exit(1);
  }
  userId = created.body.id;
  console.log(`[auth] user creat: ${userId}`);
}

// 2) Profil business
const patchProfile = await adminFetch(`/rest/v1/profiles?id=eq.${userId}`, {
  method: 'PATCH',
  headers: { Prefer: 'return=representation' },
  body: JSON.stringify({ account_kind: 'business', display_name: displayName }),
});
console.log('[profil] patched:', patchProfile.status, JSON.stringify(patchProfile.body));

const workingHours = {
  mon: { closed: false, start: '09:00', end: '18:00' },
  tue: { closed: false, start: '09:00', end: '18:00' },
  wed: { closed: false, start: '09:00', end: '18:00' },
  thu: { closed: false, start: '09:00', end: '18:00' },
  fri: { closed: false, start: '09:00', end: '18:00' },
  sat: { closed: false, start: '10:00', end: '14:00' },
  sun: { closed: true },
};

// 3) Business profile cu locație
const existingBiz = await adminFetch(`/rest/v1/business_profiles?owner_user_id=eq.${userId}&select=id,public_code`);
let bizRow;
if (Array.isArray(existingBiz.body) && existingBiz.body.length > 0) {
  bizRow = existingBiz.body[0];
  const upd = await adminFetch(`/rest/v1/business_profiles?id=eq.${bizRow.id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      name: bizName,
      address: 'Strada Franceză 12',
      city: 'București',
      maps_url: null,
      latitude: 44.4312,
      longitude: 26.1012,
    }),
  });
  console.log('[business] updated:', upd.status, JSON.stringify(upd.body));
} else {
  const ins = await adminFetch('/rest/v1/business_profiles', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify([{
      owner_user_id: userId,
      name: bizName,
      public_code: publicCode,
      timezone: 'Europe/Bucharest',
      session_duration_minutes: 60,
      working_hours: workingHours,
      break_hours: { enabled: false, start: '13:00', end: '14:00' },
      address: 'Strada Franceză 12',
      city: 'București',
      latitude: 44.4312,
      longitude: 26.1012,
    }]),
  });
  if (ins.status >= 300) {
    console.error('[business] insert eșuat:', ins.status, JSON.stringify(ins.body));
    process.exit(1);
  }
  bizRow = ins.body[0];
  console.log('[business] creat:', JSON.stringify(bizRow));
}

console.log('\nCont business de test:');
console.log(`  email:    ${email}`);
console.log(`  parola:   ${password}`);
console.log(`  user id:  ${userId}`);
console.log(`  public_code: ${bizRow?.public_code}`);