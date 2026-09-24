const authForm = document.getElementById('authForm');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const submitButton = document.getElementById('authSubmit');
const message = document.getElementById('authMessage');
const authTabs = [...document.querySelectorAll('.auth-tab')];

let authMode = 'login';

function getSafeRedirect() {
    const requestedPath = new URLSearchParams(window.location.search).get('redirect');
    if (!requestedPath) return '../';

    try {
        const target = new URL(requestedPath, window.location.href);
        return target.origin === window.location.origin ? target.href : '../';
    } catch (error) {
        return '../';
    }
}

function showMessage(text, state = '') {
    message.textContent = text;
    message.className = `auth-message${state ? ` is-${state}` : ''}`;
}

function setMode(mode) {
    authMode = mode === 'signup' ? 'signup' : 'login';
    const isSignup = authMode === 'signup';

    authTabs.forEach(tab => {
        const isActive = tab.dataset.mode === authMode;
        tab.classList.toggle('is-active', isActive);
        tab.setAttribute('aria-selected', String(isActive));
        tab.tabIndex = isActive ? 0 : -1;
    });

    passwordInput.autocomplete = isSignup ? 'new-password' : 'current-password';
    submitButton.textContent = isSignup ? '계정 만들기' : '로그인';
    showMessage(isSignup
        ? '가입 후 받은 이메일의 인증 링크를 눌러 주세요.'
        : '로그인하면 이 브라우저에서 자동 로그인됩니다.');
}

function translateAuthError(error) {
    const text = error?.message || '';
    if (/invalid login credentials/i.test(text)) return '이메일 또는 비밀번호가 올바르지 않습니다.';
    if (/email not confirmed/i.test(text)) return '이메일 인증을 먼저 완료해 주세요.';
    if (/user already registered/i.test(text)) return '이미 가입된 이메일입니다.';
    if (/password/i.test(text)) return '비밀번호는 8자 이상으로 입력해 주세요.';
    return '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';
}

authTabs.forEach(tab => {
    tab.addEventListener('click', () => setMode(tab.dataset.mode));
});

authForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (!authForm.reportValidity()) return;

    submitButton.disabled = true;
    showMessage(authMode === 'signup' ? '계정을 만들고 있습니다…' : '로그인 중…');

    const credentials = {
        email: emailInput.value.trim(),
        password: passwordInput.value
    };

    try {
        if (authMode === 'signup') {
            const emailRedirectTo = new URL('./', window.location.href).href;
            const { data, error } = await window.AppBackend.client.auth.signUp({
                ...credentials,
                options: { emailRedirectTo }
            });
            if (error) throw error;

            if (data.session) {
                window.location.replace(getSafeRedirect());
                return;
            }

            authForm.reset();
            showMessage('인증 메일을 보냈습니다. 이메일의 링크를 누른 뒤 로그인해 주세요.', 'success');
        } else {
            const { error } = await window.AppBackend.client.auth.signInWithPassword(credentials);
            if (error) throw error;
            window.location.replace(getSafeRedirect());
        }
    } catch (error) {
        console.error('인증 요청을 처리하지 못했습니다.', error);
        showMessage(translateAuthError(error), 'error');
    } finally {
        submitButton.disabled = false;
    }
});

async function initializeAuthPage() {
    await window.AppBackend.ready;
    const session = await window.AppBackend.getSession();
    if (session) {
        window.location.replace(getSafeRedirect());
        return;
    }
    setMode('login');
    emailInput.focus();
}

initializeAuthPage();
