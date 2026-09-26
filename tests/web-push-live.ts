// Explicit deployment verification only. Creates two temporary confirmed users, then deletes them.
// Never run automatically as part of unit tests. Requires project admin credentials.
import { strict as assert } from 'node:assert';
import { createECDH, randomBytes } from 'node:crypto';

const base = 'https://uemhbtbvfeqhfuqzmlpt.supabase.co';
const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
if (!service) throw Error('Server verification credential required');
const publicKey = 'sb_publishable_WwP8TWWr9CQphc1XhtR2qQ_xBYd1ek0';
const created: string[] = [];
async function auth(path: string, method: string, body?: unknown) {
    const response = await fetch(base + '/auth/v1/' + path, {
        method, headers: { apikey: service!, Authorization: `Bearer ${service}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
    });
    const result = await response.json();
    if (!response.ok) throw Error(`Auth verification request failed: ${response.status}`);
    return result;
}
async function user() {
    const email = `push-test-${crypto.randomUUID()}@example.invalid`;
    const password = randomBytes(32).toString('base64url');
    const account = await auth('admin/users', 'POST', { email, password, email_confirm: true });
    created.push(account.id);
    const session = await auth('token?grant_type=password', 'POST', { email, password });
    return { id: account.id, token: session.access_token };
}
async function call(token: string | null, body: unknown) {
    const headers: Record<string, string> = { apikey: publicKey, 'Content-Type': 'application/json', Origin: 'https://swdynamics.github.io' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(base + '/functions/v1/web-push', { method: 'POST', headers, body: JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
}
try {
    assert.equal((await call(null, { action: 'status' })).status, 401);
    assert.equal((await call('invalid-token', { action: 'status' })).status, 401);
    const first = await user();
    const second = await user();
    const initial = await call(first.token, { action: 'status' });
    assert.equal(initial.status, 200);
    assert.equal(initial.data.deviceCount, 0);
    assert.equal(typeof initial.data.publicKey, 'string');
    assert.equal(JSON.stringify(initial.data).includes('privateKey'), false);
    const receiver = createECDH('prime256v1'); receiver.generateKeys();
    const endpoint = `https://fcm.googleapis.com/fcm/send/til-invalid-verification-${crypto.randomUUID()}`;
    const subscription = { endpoint, keys: { p256dh: receiver.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } };
    assert.equal((await call(first.token, { action: 'register', subscription: { ...subscription, endpoint: 'https://127.0.0.1/' } })).status, 400);
    assert.equal((await call(first.token, { action: 'register', subscription })).status, 200);
    assert.equal((await call(first.token, { action: 'status', endpoint })).data.registered, true);
    assert.equal((await call(second.token, { action: 'status', endpoint })).data.registered, false);
    assert.equal((await call(second.token, { action: 'send-test', userId: first.id })).status, 409);
    assert.equal((await call(second.token, { action: 'unregister', endpoint })).status, 200);
    assert.equal((await call(first.token, { action: 'status', endpoint })).data.registered, true);
    const sent = await call(first.token, { action: 'send-test' });
    assert.equal(sent.status, 200);
    assert.equal(sent.data.accepted, 0);
    assert.equal(sent.data.failed + sent.data.expired, 1);
    // Re-register if the provider correctly removed the deliberately invalid endpoint.
    assert.equal((await call(first.token, { action: 'register', subscription })).status, 200);
    assert.equal((await call(first.token, { action: 'send-test' })).status, 429);
    assert.equal((await call(first.token, { action: 'unregister', endpoint })).status, 200);
    assert.equal((await call(first.token, { action: 'status' })).data.deviceCount, 0);
    console.log('PASS: deployed auth, key configuration, subscription CRUD, account isolation, invalid destination rejection, provider failure handling and send throttling.');
} finally {
    for (const id of created) await auth('admin/users/' + id, 'DELETE');
    console.log('Temporary verification accounts removed.');
}
