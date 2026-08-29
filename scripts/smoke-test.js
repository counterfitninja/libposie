/** Ad-hoc end-to-end smoke test against a running dev server. */
const BASE = 'http://localhost:3000/api';

function client() {
  let cookie = '';
  return async function call(method, path, body) {
    const res = await fetch(BASE + path, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    const setCookie = res.headers.getSetCookie?.() || [];
    if (setCookie.length) cookie = setCookie.map((c) => c.split(';')[0]).join('; ');
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(data)}`);
    return data;
  };
}

const ok = (label) => console.log(`  ok  ${label}`);
const stamp = Date.now();

const alice = client();
const bob = client();

const a = await alice('POST', '/auth/register', {
  username: `alice${stamp}`, displayName: 'Alice', password: 'password123'
});
ok(`register alice (admin=${a.user.isAdmin})`);

await bob('POST', '/auth/register', { username: `bob${stamp}`, displayName: 'Bob', password: 'password123' });
ok('register bob');

const cat = await alice('POST', '/categories', { name: `Sci-fi ${stamp}`, colour: '#3f7d63' });
ok('create category');

const lookupRes = await alice('GET', '/lookup?q=9780141036144');
ok(`lookup returned ${lookupRes.results.length} candidate(s)`);

const pick = lookupRes.results[0] || { title: 'Fallback Book', authors: 'Nobody' };
const created = await alice('POST', '/books', {
  ...pick, isPublic: true, lendable: true, categoryIds: [cat.category.id]
});
const bookId = created.book.id;
ok(`create book "${created.book.title}"`);

await alice('POST', `/books/${bookId}/notes`, { body: 'Private thought', visibility: 'private' });
await alice('POST', `/books/${bookId}/notes`, { body: 'Great read!', visibility: 'public' });
ok('add public + private notes');

await alice('PUT', `/books/${bookId}`, { title: `${created.book.title} (corrected)`, shelf: 'Study, top shelf' });
ok('edit book');

const aliceView = await alice('GET', `/books/${bookId}`);
const bobView = await bob('GET', `/books/${bookId}`);
console.log(`      alice sees ${aliceView.book.notes.length} notes, bob sees ${bobView.book.notes.length}`);
if (bobView.book.notes.length !== 1) throw new Error('private note leaked to another user!');
if (bobView.book.shelf !== undefined) throw new Error('owner-only field leaked!');
ok('note + field visibility enforced');

const loan = await bob('POST', '/loans', { bookId, message: 'Can I borrow this?' });
ok('bob requests loan');

try {
  await bob('PUT', `/books/${bookId}`, { title: 'hacked' });
  throw new Error('bob was able to edit alice\'s book!');
} catch (err) {
  if (!err.message.includes('403')) throw err;
  ok('cross-user edit blocked');
}

await alice('POST', `/loans/${loan.loan.id}/approve`, { days: 21, handedOver: true });
ok('alice approves + lends');

const lending = await alice('GET', '/loans/lending');
console.log(`      loan status: ${lending.loans[0].status}, due ${lending.loans[0].dueAt}`);

await alice('POST', `/loans/${loan.loan.id}/request-return`);
ok('alice requests return');

const bobNotifs = await bob('GET', '/notifications');
console.log(`      bob has ${bobNotifs.unread} unread notification(s): ${bobNotifs.notifications.map((n) => n.type).join(', ')}`);

await alice('POST', `/loans/${loan.loan.id}/return`);
ok('alice confirms return');

const after = await alice('GET', `/books/${bookId}`);
if (after.book.availability !== 'available') throw new Error('book not back on shelf');
ok('book back on shelf');

const discover = await bob('GET', '/books/public');
ok(`bob discovers ${discover.books.length} public book(s)`);

const admin = await alice('GET', '/users/admin/overview');
if (!Number.isInteger(admin.stats.categories) || !Number.isInteger(admin.stats.overdueLoans)) {
  throw new Error('admin overview missing dedicated stats fields for the stats page');
}
ok(`admin overview: ${admin.stats.users} users, ${admin.stats.books} books, ${admin.stats.categories} categories`);

const sweep = await alice('POST', '/admin/run-reminders');
ok(`reminder sweep ran (${sweep.sent} sent)`);

console.log('\nAll smoke tests passed.');
