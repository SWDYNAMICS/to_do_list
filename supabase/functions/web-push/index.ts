import { createClient } from 'npm:@supabase/supabase-js@2.117.1';
import webpush from 'npm:web-push@3.6.7';
import { parseSubscription, validEndpoint } from './validation.ts';

const origin = Deno.env.get('PUSH_ALLOWED_ORIGIN') || 'https://swdynamics.github.io';
const headers = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
    'Cache-Control': 'no-store',
};
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers });

Deno.serve(async req => {
    if (req.headers.get('origin') && req.headers.get('origin') !== origin) return reply({ error: '허용되지 않은 사이트입니다.' }, 403);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (req.method !== 'POST') return reply({ error: 'POST 요청이 필요합니다.' }, 405);
    try {
        const token = req.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
        if (!token) return reply({ error: '먼저 로그인해 주세요.' }, 401);
        const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
            auth: { persistSession: false, autoRefreshToken: false },
        });
        const { data: auth, error: authError } = await admin.auth.getUser(token);
        if (authError || !auth.user) return reply({ error: '로그인이 만료되었습니다. 다시 로그인해 주세요.' }, 401);
        const userId = auth.user.id;
        const raw = await req.text();
        if (raw.length > 12000) return reply({ error: '요청이 너무 큽니다.' }, 413);
        let input;
        try { input = JSON.parse(raw); } catch { return reply({ error: '잘못된 요청입니다.' }, 400); }
        if (!input || typeof input !== 'object') return reply({ error: '잘못된 요청입니다.' }, 400);

        // Unregister remains available even if the VAPID secrets are removed.
        if (input.action === 'unregister') {
            if (!validEndpoint(input.endpoint)) return reply({ error: '잘못된 기기 주소입니다.' }, 400);
            const { error } = await admin.from('push_subscriptions').delete().eq('user_id', userId).eq('endpoint', input.endpoint);
            if (error) throw error;
            return reply({ ok: true });
        }

        const publicKey = Deno.env.get('VAPID_PUBLIC_KEY');
        const privateKey = Deno.env.get('VAPID_PRIVATE_KEY');
        const subject = Deno.env.get('VAPID_SUBJECT');
        if (!publicKey || !privateKey || !subject) return reply({ error: '서버 알림 설정을 준비 중입니다.' }, 503);

        if (input.action === 'status') {
            const { data, error } = await admin.from('push_subscriptions').select('endpoint').eq('user_id', userId);
            if (error) throw error;
            return reply({ publicKey, deviceCount: data.length, registered: data.some(row => row.endpoint === input.endpoint) });
        }
        if (input.action === 'register') {
            const subscription = parseSubscription(input.subscription);
            if (!subscription) return reply({ error: '지원하지 않는 푸시 주소 또는 잘못된 등록 정보입니다.' }, 400);
            const { error } = await admin.rpc('register_push_device', { p_user_id: userId, p_subscription: subscription });
            if (error?.message.includes('DEVICE_LIMIT')) return reply({ error: '기기는 최대 10개까지 등록할 수 있습니다.' }, 409);
            if (error) throw error;
            return reply({ ok: true });
        }
        if (input.action !== 'send-test') return reply({ error: '지원하지 않는 요청입니다.' }, 400);
        const { data: devices, error } = await admin.from('push_subscriptions').select('endpoint,subscription,updated_at').eq('user_id', userId);
        if (error) throw error;
        if (!devices.length) return reply({ error: '등록된 기기가 없습니다. 휴대폰에서 먼저 알림을 등록해 주세요.' }, 409);
        const { data: reserved, error: limitError } = await admin.rpc('reserve_push_test', { p_user_id: userId });
        if (limitError) throw limitError;
        if (!reserved) return reply({ error: '30초 뒤에 다시 보낼 수 있습니다.' }, 429);

        const payload = JSON.stringify({ title: 'TIL 서버 푸시 테스트', body: '서버에서 보낸 알림입니다. 눌러서 TIL 페이지를 여세요.', tag: crypto.randomUUID() });
        const outcomes = await Promise.all(devices.map(async device => {
            const subscription = parseSubscription(device.subscription);
            if (!subscription) return 'failed';
            try {
                const request = webpush.generateRequestDetails(subscription, payload, {
                    vapidDetails: { subject, publicKey, privateKey }, TTL: 300, urgency: 'high', contentEncoding: 'aes128gcm',
                });
                const response = await fetch(request.endpoint, {
                    method: 'POST', headers: request.headers, body: new Uint8Array(request.body),
                    redirect: 'error', signal: AbortSignal.timeout(10000),
                });
                await response.body?.cancel();
                if (response.status === 404 || response.status === 410) {
                    const { error: deleteError } = await admin.from('push_subscriptions').delete()
                        .eq('user_id', userId).eq('endpoint', device.endpoint).eq('updated_at', device.updated_at);
                    return deleteError ? 'failed' : 'expired';
                }
                if (response.ok) return 'accepted';
                console.warn('Push provider rejected request', response.status);
                return 'failed';
            } catch {
                console.warn('Push provider request failed');
                return 'failed';
            }
        }));
        return reply({ accepted: outcomes.filter(x => x === 'accepted').length,
            expired: outcomes.filter(x => x === 'expired').length, failed: outcomes.filter(x => x === 'failed').length });
    } catch (error) {
        // Do not log bearer tokens, subscription endpoints or encryption keys.
        console.error('Web push operation failed', (error as { code?: string }).code || 'internal');
        return reply({ error: '서버 알림 처리에 실패했습니다. 잠시 후 다시 시도해 주세요.' }, 500);
    }
});
