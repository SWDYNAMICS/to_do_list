(function initializeBackend() {
    const config = window.APP_SUPABASE_CONFIG;
    const sdk = window.supabase;
    const DATA_TABLE = 'user_app_data';
    const CACHE_PREFIX = 'userAppCache.v1';
    let currentSession = null;

    if (!config?.url || !config?.publishableKey || !sdk?.createClient) {
        console.error('Supabase 클라이언트를 초기화하지 못했습니다.');
        window.AppBackend = createUnavailableBackend();
        renderAuthNavigation(null, '서버 연결 설정을 확인해 주세요.');
        return;
    }

    const client = sdk.createClient(config.url, config.publishableKey, {
        auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true,
            storage: window.localStorage
        }
    });

    const ready = client.auth.getSession()
        .then(({ data, error }) => {
            if (error) throw error;
            currentSession = data.session;
            renderAuthNavigation(currentSession);
            return currentSession;
        })
        .catch(error => {
            console.error('로그인 상태를 확인하지 못했습니다.', error);
            renderAuthNavigation(null, '로그인 상태 확인 실패');
            return null;
        });

    client.auth.onAuthStateChange((event, session) => {
        currentSession = session;
        renderAuthNavigation(session);
        window.dispatchEvent(new CustomEvent('app-auth-change', {
            detail: { event, session }
        }));
    });

    function getCacheKey(dataKey, userId) {
        return `${CACHE_PREFIX}:${userId}:${dataKey}`;
    }

    function readCache(dataKey, userId) {
        if (!userId) return null;
        try {
            const value = localStorage.getItem(getCacheKey(dataKey, userId));
            return value ? JSON.parse(value) : null;
        } catch (error) {
            console.error('동기화 캐시를 불러오지 못했습니다.', error);
            return null;
        }
    }

    function writeCache(dataKey, userId, data) {
        if (!userId) return;
        try {
            localStorage.setItem(getCacheKey(dataKey, userId), JSON.stringify(data));
        } catch (error) {
            console.error('동기화 캐시를 저장하지 못했습니다.', error);
        }
    }

    async function getSession() {
        await ready;
        return currentSession;
    }

    async function getUserData(dataKey) {
        const session = await getSession();
        if (!session?.user) return null;

        const { data, error } = await client
            .from(DATA_TABLE)
            .select('data')
            .eq('user_id', session.user.id)
            .eq('data_key', dataKey)
            .maybeSingle();

        if (error) throw error;
        return data?.data ?? null;
    }

    async function upsertUserData(dataKey, data) {
        const session = await getSession();
        if (!session?.user) return false;

        const { error } = await client
            .from(DATA_TABLE)
            .upsert({
                user_id: session.user.id,
                data_key: dataKey,
                data,
                updated_at: new Date().toISOString()
            }, { onConflict: 'user_id,data_key' });

        if (error) throw error;
        writeCache(dataKey, session.user.id, data);
        return true;
    }

    async function loadUserData(dataKey, localData) {
        const session = await getSession();
        if (!session?.user) {
            setSyncStatus('로그인하면 기기 간 동기화됩니다.', 'local');
            return { data: localData, mode: 'local', user: null };
        }

        try {
            const remoteData = await getUserData(dataKey);
            const resolvedData = remoteData === null ? localData : remoteData;

            if (remoteData === null) {
                await upsertUserData(dataKey, resolvedData);
            } else {
                writeCache(dataKey, session.user.id, resolvedData);
            }

            setSyncStatus('서버와 동기화됨', 'synced');
            return { data: resolvedData, mode: 'cloud', user: session.user };
        } catch (error) {
            const cachedData = readCache(dataKey, session.user.id);
            console.error(`${dataKey} 데이터를 동기화하지 못했습니다.`, error);
            setSyncStatus(formatSyncError(error), 'error');
            return {
                data: cachedData ?? localData,
                mode: 'offline',
                user: session.user,
                error
            };
        }
    }

    async function saveUserData(dataKey, data) {
        const session = await getSession();
        if (!session?.user) return false;

        writeCache(dataKey, session.user.id, data);
        setSyncStatus('저장 중…', 'syncing');
        try {
            await upsertUserData(dataKey, data);
            setSyncStatus('서버와 동기화됨', 'synced');
            return true;
        } catch (error) {
            console.error(`${dataKey} 데이터를 서버에 저장하지 못했습니다.`, error);
            setSyncStatus(formatSyncError(error), 'error');
            return false;
        }
    }

    window.AppBackend = {
        client,
        ready,
        getSession,
        loadUserData,
        saveUserData,
        setSyncStatus
    };

    function formatSyncError(error) {
        if (
            error?.code === 'PGRST205'
            || error?.code === '23514'
            || /user_app_data/i.test(error?.message || '')
        ) {
            return 'DB 설정이 필요합니다.';
        }
        return '오프라인 · 연결되면 다시 저장해 주세요.';
    }

    function createUnavailableBackend() {
        return {
            client: null,
            ready: Promise.resolve(null),
            getSession: async () => null,
            loadUserData: async (dataKey, localData) => ({
                data: localData,
                mode: 'local',
                user: null
            }),
            saveUserData: async () => false,
            setSyncStatus
        };
    }

    function setSyncStatus(message, state = 'local') {
        document.querySelectorAll('[data-sync-status]').forEach(element => {
            element.textContent = message;
            element.dataset.state = state;
        });
    }

    function renderAuthNavigation(session, statusMessage = '') {
        document.querySelectorAll('[data-auth-nav]').forEach(container => {
            const loginHref = container.dataset.loginHref || './auth/';
            const status = document.createElement('span');
            status.className = 'auth-sync-status';
            status.dataset.syncStatus = '';

            if (statusMessage) {
                status.textContent = statusMessage;
                status.dataset.state = 'error';
            } else if (session?.user) {
                status.textContent = '서버 연결됨';
                status.dataset.state = 'synced';
            } else {
                status.textContent = '이 브라우저에 저장 중';
                status.dataset.state = 'local';
            }

            const controls = document.createElement('div');
            controls.className = 'auth-controls';

            if (session?.user) {
                const email = document.createElement('span');
                email.className = 'auth-email';
                email.textContent = session.user.email || '로그인 사용자';
                email.title = session.user.email || '';

                const logoutButton = document.createElement('button');
                logoutButton.type = 'button';
                logoutButton.className = 'auth-action auth-logout';
                logoutButton.textContent = '로그아웃';
                logoutButton.addEventListener('click', async () => {
                    logoutButton.disabled = true;
                    const { error } = await client.auth.signOut();
                    if (error) {
                        logoutButton.disabled = false;
                        setSyncStatus('로그아웃하지 못했습니다.', 'error');
                        return;
                    }
                    window.location.reload();
                });
                controls.append(email, logoutButton);
            } else {
                const loginLink = document.createElement('a');
                loginLink.className = 'auth-action auth-login';
                loginLink.href = loginHref;
                loginLink.textContent = '로그인';
                controls.appendChild(loginLink);
            }

            container.replaceChildren(status, controls);
        });
    }
})();
