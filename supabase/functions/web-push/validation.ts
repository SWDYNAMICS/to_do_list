export type Subscription = { endpoint: string; keys: { p256dh: string; auth: string } };

export function validEndpoint(value: unknown): value is string {
    if (typeof value !== 'string' || value.length > 2048) return false;
    try {
        const url = new URL(value);
        if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return false;
        // Endpoints are supplied by browsers, but are still untrusted input.
        // Never let this function become a proxy to arbitrary/private hosts.
        return url.hostname === 'fcm.googleapis.com'
            || url.hostname === 'updates.push.services.mozilla.com'
            || /^([a-z0-9-]+\.)*push\.apple\.com$/.test(url.hostname)
            || /^[a-z0-9-]+\.notify\.windows\.com$/.test(url.hostname);
    } catch { return false; }
}

function keyLength(value: unknown, length: number): boolean {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+={0,2}$/.test(value)) return false;
    try {
        return atob(value.replace(/-/g, '+').replace(/_/g, '/')).length === length;
    } catch { return false; }
}

export function parseSubscription(value: unknown): Subscription | null {
    if (!value || typeof value !== 'object') return null;
    const input = value as Subscription;
    if (!validEndpoint(input.endpoint) || !input.keys
        || !keyLength(input.keys.p256dh, 65) || !keyLength(input.keys.auth, 16)) return null;
    return { endpoint: input.endpoint, keys: { p256dh: input.keys.p256dh, auth: input.keys.auth } };
}
