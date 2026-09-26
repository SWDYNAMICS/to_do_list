(() => {
    const register = document.getElementById('pushRegister');
    const unregister = document.getElementById('pushUnregister');
    const send = document.getElementById('pushSend');
    const refresh = document.getElementById('pushRefresh');
    const status = document.getElementById('pushStatus');
    const deviceStatus = document.getElementById('pushDeviceStatus');
    let registration = null;
    let subscription = null;
    let publicKey = null;
    let userId = null;
    let busy = false;
    let registered = false;
    let deviceCount = 0;
    let ready = false;

    function supportReason() {
        const ios = /iPad|iPhone|iPod/.test(navigator.userAgent)
            || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        if (ios && !navigator.standalone && !matchMedia('(display-mode: standalone)').matches) {
            return '아이폰은 TIL을 홈 화면에 추가하고 새 아이콘으로 열어야 수신 등록이 가능합니다.';
        }
        if (!window.isSecureContext || !('serviceWorker' in navigator) || !('PushManager' in window)) {
            return '이 브라우저는 수신 등록을 지원하지 않습니다. 등록된 다른 기기로 보내기는 가능합니다.';
        }
        return '';
    }

    function controls() {
        register.disabled = busy || !ready || !registration || Boolean(supportReason());
        unregister.disabled = busy || !ready || !subscription;
        send.disabled = busy || !ready || deviceCount === 0;
        refresh.disabled = busy;
        deviceStatus.textContent = ready
            ? `내 계정의 등록 기기: ${deviceCount}개 · 현재 기기: ${registered ? '등록됨' : '미등록'}`
            : '';
    }

    async function session() {
        if (!window.AppBackend?.client) throw new Error('로그인 기능을 불러오는 중입니다. 잠시 후 연결 상태를 다시 확인해 주세요.');
        const { data, error } = await window.AppBackend.client.auth.getSession();
        if (error || !data.session) throw new Error('휴대폰과 PC에서 같은 계정으로 로그인해 주세요.');
        return data.session;
    }

    async function api(body) {
        const current = await session();
        if (userId && userId !== current.user.id) throw new Error('계정이 바뀌었습니다. 연결 상태를 다시 확인해 주세요.');
        const config = window.APP_SUPABASE_CONFIG;
        const response = await fetch(`${config.url}/functions/v1/web-push`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', apikey: config.publishableKey, Authorization: `Bearer ${current.access_token}` },
            body: JSON.stringify(body), signal: AbortSignal.timeout(45000),
        });
        let result;
        try { result = await response.json(); } catch { throw new Error('서버 응답을 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.'); }
        if (!response.ok) throw new Error(result.error || (response.status === 404
            ? '서버 알림을 준비 중입니다. 잠시 후 다시 확인해 주세요.' : '서버 연결에 실패했습니다. 다시 로그인하거나 잠시 후 시도해 주세요.'));
        return result;
    }

    async function prepareWorker() {
        const workerRegistration = await navigator.serviceWorker.register('./notification-sw.js', { scope: './', updateViaCache: 'none' });
        await workerRegistration.update();
        const worker = workerRegistration.installing || workerRegistration.waiting || workerRegistration.active;
        if (!worker) throw new Error('알림 기능을 설치하지 못했습니다. 새로고침해 주세요.');
        if (worker.state !== 'activated') await new Promise((resolve, reject) => {
            const timer = setTimeout(() => { worker.removeEventListener('statechange', check); reject(new Error('알림 준비 시간이 초과되었습니다.')); }, 15000);
            function check() {
                if (worker.state !== 'activated' && worker.state !== 'redundant') return;
                clearTimeout(timer);
                worker.removeEventListener('statechange', check);
                if (worker.state === 'activated') resolve();
                else reject(new Error('알림 기능이 갱신되었습니다. 연결 상태를 다시 확인해 주세요.'));
            }
            worker.addEventListener('statechange', check);
            check();
        });
        return workerRegistration;
    }

    async function updateStatus() {
        const result = await api({ action: 'status', endpoint: subscription?.endpoint });
        publicKey = result.publicKey;
        registered = result.registered;
        deviceCount = result.deviceCount;
        ready = true;
    }

    async function initialize() {
        if (busy) return;
        busy = true;
        ready = false;
        userId = null;
        registration = null;
        subscription = null;
        controls();
        try {
            userId = (await session()).user.id;
            let receiverError = supportReason();
            if (!receiverError) {
                try {
                    registration = await prepareWorker();
                    subscription = await registration.pushManager.getSubscription();
                } catch (error) { receiverError = error.message; }
            }
            await updateStatus();
            status.textContent = receiverError || (registered
                ? '이 기기는 서버 알림을 받도록 등록되어 있습니다.'
                : '알림을 받을 휴대폰에서 “이 기기로 알림 받기”를 눌러 주세요.');
        } catch (error) { status.textContent = error.message; }
        finally { busy = false; controls(); }
    }

    function keyBytes(value) {
        const decoded = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
        return Uint8Array.from(decoded, char => char.charCodeAt(0));
    }

    register.addEventListener('click', async () => {
        if (busy || !ready || !registration) return;
        busy = true; controls();
        let created = false;
        try {
            // subscribe must be called directly from this user gesture on iOS.
            if (!subscription) {
                subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
                created = true;
            }
            await api({ action: 'register', subscription: subscription.toJSON() });
            await updateStatus();
            status.textContent = '기기 등록 완료. PC에서 같은 계정으로 로그인한 뒤 “내 등록 기기로 테스트 보내기”를 눌러 보세요.';
        } catch (error) {
            if (created && subscription) {
                // Keep the browser subscription on server-status failure: retrying register is safe.
                status.textContent = '서버 등록을 확인하지 못했습니다. 다시 등록을 눌러 주세요. ' + error.message;
            } else {
                status.textContent = error.name === 'NotAllowedError'
                    ? '알림 권한을 허용해 주세요. 차단했다면 휴대폰 설정에서 TIL 알림을 켜 주세요.' : error.message;
            }
        } finally { busy = false; controls(); }
    });

    unregister.addEventListener('click', async () => {
        if (busy || !subscription) return;
        busy = true; controls();
        try {
            await api({ action: 'unregister', endpoint: subscription.endpoint });
            await subscription.unsubscribe();
            subscription = null;
            await updateStatus();
            status.textContent = '이 기기의 알림 수신 등록을 해제했습니다.';
        } catch (error) { status.textContent = error.message; }
        finally { busy = false; controls(); }
    });

    send.addEventListener('click', async () => {
        if (busy || !ready) return;
        busy = true; controls(); status.textContent = '등록된 기기로 보내고 있습니다…';
        try {
            const result = await api({ action: 'send-test' });
            status.textContent = `푸시 서비스 접수 ${result.accepted}개 · 만료된 등록 ${result.expired}개 · 실패 ${result.failed}개. 접수는 실제 화면 표시를 보장하지 않습니다. 휴대폰 알림 센터를 확인해 주세요.`;
            await updateStatus();
        } catch (error) { status.textContent = error.message; }
        finally { busy = false; controls(); }
    });
    refresh.addEventListener('click', initialize);
    // Defer SDK calls until Supabase's auth-state callback releases its lock.
    window.addEventListener('app-auth-change', () => { setTimeout(() => { if (!busy) initialize(); }, 0); });
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
})();
