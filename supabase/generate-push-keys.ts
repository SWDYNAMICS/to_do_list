import webpush from 'npm:web-push@3.6.7';

await Deno.mkdir('.secrets', { recursive: true });
const keys = webpush.generateVAPIDKeys();
// createNew prevents accidental key rotation, which invalidates existing subscriptions.
await Deno.writeTextFile('.secrets/web-push.env', [
    `VAPID_PUBLIC_KEY=${keys.publicKey}`,
    `VAPID_PRIVATE_KEY=${keys.privateKey}`,
    'VAPID_SUBJECT=https://swdynamics.github.io/to_do_list/',
    'PUSH_ALLOWED_ORIGIN=https://swdynamics.github.io',
    '',
].join('\n'), { createNew: true });
console.log('VAPID keys saved to .secrets/web-push.env (Git ignored; key values not printed).');
