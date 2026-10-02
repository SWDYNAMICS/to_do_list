import { strict as assert } from 'node:assert';
import { createECDH, randomBytes } from 'node:crypto';
import vm from 'node:vm';
import webpush from 'npm:web-push@3.6.7';
import { parseSubscription, validEndpoint } from '../supabase/functions/web-push/validation.ts';

Deno.test('push endpoints exclude arbitrary hosts, credentials, non-TLS and deceptive suffixes', () => {
    for (const endpoint of ['https://fcm.googleapis.com/fcm/send/test', 'https://web.push.apple.com/token', 'https://updates.push.services.mozilla.com/wpush/v2/test']) assert.ok(validEndpoint(endpoint));
    for (const endpoint of ['http://fcm.googleapis.com/test', 'https://127.0.0.1/', 'https://example.com/', 'https://web.push.apple.com.evil.com/', 'https://user@fcm.googleapis.com/', 'https://fcm.googleapis.com:8443/', 'https://fcm.googleapis.com/#x']) assert.equal(validEndpoint(endpoint), false);
});

Deno.test('registered subscription creates an encrypted VAPID request under Deno', () => {
    const receiver = createECDH('prime256v1');
    receiver.generateKeys();
    const subscription = { endpoint: 'https://web.push.apple.com/test', keys: { p256dh: receiver.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } };
    assert.ok(parseSubscription(subscription));
    assert.equal(parseSubscription({ ...subscription, keys: { ...subscription.keys, auth: 'short' } }), null);
    const pair = webpush.generateVAPIDKeys();
    const request = webpush.generateRequestDetails(subscription, 'Private test payload', {
        vapidDetails: { subject: 'https://swdynamics.github.io/to_do_list/', publicKey: pair.publicKey, privateKey: pair.privateKey }, contentEncoding: 'aes128gcm', TTL: 300,
    });
    assert.equal(request.method, 'POST');
    assert.equal(request.headers['Content-Encoding'], 'aes128gcm');
    assert.ok(request.headers.Authorization.startsWith('vapid '));
    assert.ok(request.body.length > 20);
    assert.equal(request.body.includes('Private test payload'), false);
});

Deno.test('service worker displays every push and opens only the fixed TIL URL', async () => {
    const listeners: Record<string, (event: any) => void> = {};
    const shown: any[] = [];
    let opened = '';
    const self = {
        addEventListener: (name: string, callback: any) => listeners[name] = callback,
        registration: { scope: 'https://swdynamics.github.io/to_do_list/learning/', showNotification: (...args: any[]) => { shown.push(args); return Promise.resolve(); } },
        clients: { matchAll: async () => [], openWindow: async (url: string) => { opened = url; } },
    };
    vm.runInNewContext(await Deno.readTextFile('learning/notification-sw.js'), { self, URL });
    let pending: Promise<any> = Promise.resolve();
    const waitUntil = (promise: Promise<any>) => { pending = promise; };
    listeners.push({ data: { json: () => ({ title: 'Server test', body: 'hello', url: 'https://evil.example/' }) }, waitUntil });
    await pending;
    assert.equal(shown[0][0], 'Server test');
    listeners.push({ data: { json: () => { throw Error('invalid'); } }, waitUntil });
    await pending;
    assert.equal(shown.length, 2);
    listeners.notificationclick({ notification: { close() {} }, waitUntil });
    await pending;
    assert.equal(opened, self.registration.scope);
});
