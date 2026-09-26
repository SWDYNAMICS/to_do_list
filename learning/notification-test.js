(() => {
    const button = document.getElementById('notificationTest');
    const status = document.getElementById('notificationStatus');
    let busy = false;

    function unsupportedReason() {
        if (!window.isSecureContext) return 'HTTPS 주소 또는 localhost에서 열어 주세요. 파일을 직접 열거나 일반 HTTP로 접속하면 알림을 시험할 수 없습니다.';
        const ios = /iPad|iPhone|iPod/.test(navigator.userAgent)
            || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        const installed = window.matchMedia('(display-mode: standalone)').matches
            || navigator.standalone === true;
        if (ios && !installed) return '아이폰·아이패드는 iOS/iPadOS 16.4 이상에서 Safari의 공유 → 홈 화면에 추가 후, 추가된 아이콘으로 열어 주세요.';
        if (!('Notification' in window) || !('serviceWorker' in navigator)
            || !('ServiceWorkerRegistration' in window)
            || !('showNotification' in ServiceWorkerRegistration.prototype)) {
            return '이 브라우저에서는 알림 테스트를 지원하지 않습니다. 최신 Safari 또는 Chrome에서 열어 주세요.';
        }
        return '';
    }

    function refresh() {
        if (busy) return;
        const reason = unsupportedReason();
        button.disabled = Boolean(reason);
        if (reason) {
            status.textContent = reason;
        } else if (Notification.permission === 'denied') {
            status.textContent = '알림이 차단되어 있습니다. 브라우저의 사이트 설정 또는 휴대폰 설정에서 알림을 허용한 뒤 다시 눌러 주세요.';
        } else {
            status.textContent = Notification.permission === 'granted'
                ? '알림 권한이 허용되어 있습니다. 버튼을 눌러 시험해 보세요.'
                : '버튼을 누른 뒤 알림 권한 요청에서 허용을 선택해 주세요.';
        }
    }

    function withTimeout(promise, milliseconds) {
        let timer;
        return Promise.race([
            promise,
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error('알림 준비 시간이 초과되었습니다. 연결을 확인하고 다시 눌러 주세요.')), milliseconds);
            })
        ]).finally(() => clearTimeout(timer));
    }

    async function prepareWorker() {
        const registration = await navigator.serviceWorker.register('./notification-sw.js', { scope: './' });
        if (registration.active?.state === 'activated') return registration;
        const worker = registration.installing || registration.waiting || registration.active;
        if (!worker) throw new Error('알림 기능을 준비하지 못했습니다. 새로고침 후 다시 시도해 주세요.');
        await new Promise((resolve, reject) => {
            function check() {
                if (worker.state === 'activated' || worker.state === 'redundant') {
                    worker.removeEventListener('statechange', check);
                    if (worker.state === 'activated') resolve();
                    else reject(new Error('알림 기능 설치에 실패했습니다. 새로고침 후 다시 시도해 주세요.'));
                }
            }
            worker.addEventListener('statechange', check);
            check();
        });
        return registration;
    }

    button.addEventListener('click', async () => {
        if (busy) return;
        const reason = unsupportedReason();
        if (reason) { refresh(); return; }
        busy = true;
        button.disabled = true;
        try {
            // Request immediately inside the user gesture, before asynchronous worker setup.
            const permission = Notification.permission === 'default'
                ? await Notification.requestPermission()
                : Notification.permission;
            if (permission !== 'granted') {
                status.textContent = permission === 'denied'
                    ? '알림이 차단되어 있습니다. 사이트 또는 휴대폰의 알림 설정에서 허용한 뒤 다시 눌러 주세요.'
                    : '알림 권한을 허용하지 않았습니다. 다시 눌러 허용해 주세요.';
                return;
            }
            status.textContent = '테스트 알림을 준비하고 있습니다…';
            const registration = await withTimeout(prepareWorker(), 15000);
            await registration.showNotification('TIL 복습 알림 테스트', {
                body: '알림이 보이면 표시 테스트 성공입니다. 눌러서 TIL 페이지로 돌아오세요.',
                lang: 'ko',
                tag: 'til-notification-test-' + Date.now()
            });
            status.textContent = '브라우저에 알림 표시를 요청했습니다. 휴대폰 알림 센터를 확인해 주세요. 보이지 않으면 집중 모드와 브라우저·앱의 알림 설정도 확인해 주세요.';
        } catch (error) {
            console.error('TIL notification test failed:', error);
            status.textContent = error.name === 'NotAllowedError'
                ? '알림 권한이 허용되지 않았습니다. 사이트 및 휴대폰 설정을 확인해 주세요.'
                : '테스트에 실패했습니다. ' + error.message;
        } finally {
            busy = false;
            button.disabled = Boolean(unsupportedReason());
        }
    });
    window.addEventListener('pageshow', refresh);
    window.addEventListener('focus', refresh);
    refresh();
})();
