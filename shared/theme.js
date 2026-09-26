(() => {
    const storageKey = 'dailySpace.theme.v1';
    const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
    const isTheme = value => value === 'light' || value === 'dark';
    let preference = null;

    try {
        const stored = localStorage.getItem(storageKey);
        if (isTheme(stored)) preference = stored;
    } catch {
        // Theme switching still works when browser storage is unavailable.
    }

    function applyTheme() {
        const theme = preference || (systemTheme.matches ? 'dark' : 'light');
        document.documentElement.dataset.theme = theme;
        document.querySelectorAll('[data-theme-option]').forEach(button => {
            button.setAttribute('aria-pressed', String(button.dataset.themeOption === theme));
        });
    }

    // Run in the head before styles paint to avoid flashing the wrong theme.
    applyTheme();

    document.addEventListener('DOMContentLoaded', () => {
        applyTheme();
        document.querySelectorAll('[data-theme-option]').forEach(button => {
            button.addEventListener('click', () => {
                const theme = button.dataset.themeOption;
                if (!isTheme(theme)) return;
                preference = theme;
                applyTheme();
                try {
                    localStorage.setItem(storageKey, theme);
                } catch {
                    // Keep the selected theme for the current page.
                }
            });
        });
    });

    systemTheme.addEventListener('change', () => {
        if (!preference) applyTheme();
    });

    window.addEventListener('storage', event => {
        if (event.key !== storageKey && event.key !== null) return;
        preference = isTheme(event.newValue) ? event.newValue : null;
        applyTheme();
    });
})();
