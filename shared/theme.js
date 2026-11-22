(() => {
    const storageKey = 'dailySpace.theme.v1';
    const paletteKey = 'dailySpace.palette.v1';
    const isPalette = value => ['blue', 'purple', 'orange', 'coral', 'pink', 'teal'].includes(value);
    let palette = 'blue';
    const fontKey = 'dailySpace.font.v1';
    // Faces declared in theme.css need no stylesheet; the others come from a CDN stylesheet.
    const fontStylesheets = {
        pretendard: null,
        'gothic-a1': 'https://fonts.googleapis.com/css2?family=Gothic+A1:wght@400;500;600;700;800&display=swap',
        wanted: 'https://cdn.jsdelivr.net/gh/wanteddev/wanted-sans@v1.0.3/packages/wanted-sans/fonts/webfonts/variable/split/WantedSansVariable.min.css',
        maruburi: null,
        gowun: 'https://fonts.googleapis.com/css2?family=Gowun+Batang:wght@400;700&display=swap',
        'noto-serif': 'https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@400..900&display=swap'
    };
    const isFont = value => Object.hasOwn(fontStylesheets, value);
    let font = 'pretendard';
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

    try {
        const stored = localStorage.getItem(fontKey);
        if (isFont(stored)) font = stored;
    } catch {
        // Default to Pretendard when storage is unavailable.
    }

    function loadFont(name) {
        const href = fontStylesheets[name];
        if (!href || document.querySelector(`link[data-font-stylesheet="${name}"]`)) return;
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        link.dataset.fontStylesheet = name;
        document.head.append(link);
    }

    function applyTheme() {
        loadFont(font);
        document.documentElement.dataset.font = font;
        document.querySelectorAll('[data-font-option]').forEach(button => {
            button.setAttribute('aria-pressed', String(button.dataset.fontOption === font));
        });
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
        // The menu stays open while trying colors; a click outside or Escape closes it.
        document.querySelectorAll('.theme-menu').forEach(menu => {
            // Load every candidate face the first time the menu opens so each option previews itself.
            menu.addEventListener('toggle', () => {
                if (menu.open) Object.keys(fontStylesheets).forEach(loadFont);
            });
            document.addEventListener('click', event => {
                if (menu.open && !menu.contains(event.target)) menu.open = false;
            });
            menu.addEventListener('keydown', event => {
                if (event.key !== 'Escape' || !menu.open) return;
                menu.open = false;
                menu.querySelector('summary').focus();
            });
        });
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
        document.querySelectorAll('[data-font-option]').forEach(button => {
            button.addEventListener('click', () => {
                const selected = button.dataset.fontOption;
                if (!isFont(selected)) return;
                font = selected;
                applyTheme();
                try { localStorage.setItem(fontKey, font); } catch {
                    // Keep the selected typeface for the current page.
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
        if (![storageKey, paletteKey, fontKey, null].includes(event.key)) return;
        if (event.key === fontKey || event.key === null) {
            font = isFont(event.newValue) ? event.newValue : 'pretendard';
        }
        if (event.key === storageKey || event.key === null) {
            preference = isTheme(event.newValue) ? event.newValue : null;
        }
        if (event.key === paletteKey || event.key === null) {
            palette = isPalette(event.newValue) ? event.newValue : 'blue';
        }
        applyTheme();
    });
})();
