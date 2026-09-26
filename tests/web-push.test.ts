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

async function browser(supported: boolean) {
    const elements: Record<string, any> = {};
    const events: Record<string, any> = {};
    for (const id of ['pushRegister', 'pushUnregister', 'pushSend', 'pushRefresh', 'pushStatus', 'pushDeviceStatus']) {
        elements[id] = { disabled: true, textContent: '', addEventListener(name: string, fn: any) { this[name] = fn; } };
    }
    let deviceCount = supported ? 0 : 1;
    let registered = false;
    let subscribed = false;
    const subscription = { endpoint: 'https://web.push.apple.com/test', toJSON: () => ({}), unsubscribe: async () => { subscribed = false; return true; } };
    const worker = { active: { state: 'activated' }, update: async () => {}, pushManager: {
        getSubscription: async () => subscribed ? subscription : null,
        subscribe: async () => { subscribed = true; return subscription; },
    } };
    const window: any = { isSecureContext: true, addEventListener() {}, APP_SUPABASE_CONFIG: { url: 'https://example.supabase.co', publishableKey: 'public' },
        AppBackend: { client: { auth: { getSession: async () => ({ data: { session: { user: { id: 'own-user' }, access_token: 'user-jwt' } } }) } } } };
    if (supported) window.PushManager = {};
    vm.runInNewContext(await Deno.readTextFile('learning/server-push.js'), {
        window, navigator: { userAgent: supported ? 'iPhone' : 'PC', standalone: supported, platform: '', serviceWorker: { register: async () => worker } },
        document: { getElementById: (id: string) => elements[id], addEventListener: (name: string, fn: any) => events[name] = fn },
        matchMedia: () => ({ matches: supported }), setTimeout, clearTimeout, Uint8Array, atob, AbortSignal,
        fetch: async (_url: string, options: any) => {
            assert.equal(options.headers.Authorization, 'Bearer user-jwt');
            const body = JSON.parse(options.body);
            if (body.action === 'register') { registered = true; deviceCount++; }
            if (body.action === 'unregister') { registered = false; deviceCount--; }
            return { ok: true, json: async () => body.action === 'send-test'
                ? { accepted: deviceCount, expired: 0, failed: 0 }
                : { publicKey: 'AQ', registered, deviceCount } };
        },
    });
    await events.DOMContentLoaded();
    return elements;
}

Deno.test('a PC without push support can still send to its registered phone', async () => {
    const ui = await browser(false);
    assert.equal(ui.pushRegister.disabled, true);
    assert.equal(ui.pushSend.disabled, false);
    await ui.pushSend.click();
    assert.ok(ui.pushStatus.textContent.includes('접수 1개'));
});

Deno.test('installed phone registration enables send and unregister removes it', async () => {
    const ui = await browser(true);
    assert.equal(ui.pushRegister.disabled, false);
    assert.equal(ui.pushSend.disabled, true);
    await ui.pushRegister.click();
    assert.ok(ui.pushDeviceStatus.textContent.includes('등록됨'));
    assert.equal(ui.pushSend.disabled, false);
    await ui.pushUnregister.click();
    assert.ok(ui.pushDeviceStatus.textContent.includes('미등록'));
    assert.equal(ui.pushSend.disabled, true);
});
