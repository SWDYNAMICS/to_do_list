// This worker only displays locally requested test notifications; it does not cache pages.
self.addEventListener('install', event => {
    event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
    event.waitUntil(self.clients.claim());
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
