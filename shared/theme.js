(() => {
    const storageKey = 'dailySpace.theme.v1';
    const paletteKey = 'dailySpace.palette.v1';
    const isPalette = value => ['blue', 'purple', 'orange'].includes(value);
    let palette = 'blue';
    const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
    const isTheme = value => value === 'light' || value === 'dark';
    let preference = null;

    try {
        const stored = localStorage.getItem(storageKey);
        if (isTheme(stored)) preference = stored;
    } catch {
        // Theme switching still works when browser storage is unavailable.
    }

    try {
        const stored = localStorage.getItem(paletteKey);
        if (isPalette(stored)) palette = stored;
    } catch {
        // Default to blue when storage is unavailable.
    }

    function applyTheme() {
        const theme = preference || (systemTheme.matches ? 'dark' : 'light');
        document.documentElement.dataset.theme = theme;
        document.documentElement.dataset.palette = palette;
        document.querySelectorAll('[data-palette-option]').forEach(button => {
            button.setAttribute('aria-pressed', String(button.dataset.paletteOption === palette));
        });
        document.querySelectorAll('[data-theme-option]').forEach(button => {
            button.setAttribute('aria-pressed', String(button.dataset.themeOption === theme));
        });
    }

    // Run in the head before styles paint to avoid flashing the wrong theme.
    applyTheme();

    document.addEventListener('DOMContentLoaded', () => {
        applyTheme();
        document.querySelectorAll('[data-palette-option]').forEach(button => {
            button.addEventListener('click', () => {
                const selected = button.dataset.paletteOption;
                if (!isPalette(selected)) return;
                palette = selected;
                applyTheme();
                try { localStorage.setItem(paletteKey, palette); } catch {
                    // Keep the selected palette for the current page.
                }
            });
        });
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
        if (![storageKey, paletteKey, null].includes(event.key)) return;
        if (event.key === storageKey || event.key === null) {
            preference = isTheme(event.newValue) ? event.newValue : null;
        }
        if (event.key === paletteKey || event.key === null) {
            palette = isPalette(event.newValue) ? event.newValue : 'blue';
        }
        applyTheme();
    });
})();
