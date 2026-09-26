// Handles local notification tests and encrypted server Web Push. No page caching.
self.addEventListener('install', event => {
    event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('push', event => {
    let payload = {};
    try { payload = event.data?.json() || {}; } catch { /* Always display a fallback notification. */ }
    event.waitUntil(self.registration.showNotification(
        typeof payload.title === 'string' ? payload.title.slice(0, 100) : 'TIL 알림', {
            body: typeof payload.body === 'string' ? payload.body.slice(0, 300) : 'TIL 페이지에서 확인해 주세요.',
            tag: typeof payload.tag === 'string' ? payload.tag.slice(0, 100) : 'til-server-push',
            lang: 'ko',
        }
    ));
});

self.addEventListener('notificationclick', event => {
    event.notification.close();
    const target = new URL('./', self.registration.scope);
    event.waitUntil((async () => {
        const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const client of windows) {
            const url = new URL(client.url);
            if (url.origin === target.origin
                && (url.pathname === target.pathname || url.pathname === target.pathname + 'index.html')) {
                await client.focus();
                return;
            }
        }
        await self.clients.openWindow(target.href);
    })());
});
