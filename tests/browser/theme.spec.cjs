const { test, expect } = require('@playwright/test');

const luminance = color => {
    const rgb = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => {
        const s = value / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
};
const contrast = (a, b) => {
    const values = [luminance(a), luminance(b)].sort((a, b) => b - a);
    return (values[0] + 0.05) / (values[1] + 0.05);
};

// Colors and brightness live in the settings menu of the top bar.
async function openThemeMenu(page) {
    const menu = page.locator('.theme-menu');
    if (!await menu.evaluate(element => element.open)) await menu.locator('summary').click();
    await expect(page.locator('.theme-controls')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
    await page.route('https://**', route => route.abort());
});

test('all palettes in both brightness modes are readable, fit mobile, and remain independent', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto('/');
    await openThemeMenu(page);
    for (const palette of ['blue', 'purple', 'orange', 'coral', 'pink', 'teal']) {
        await page.locator(`[data-palette-option="${palette}"]`).click();
        for (const mode of ['light', 'dark']) {
            await page.locator(`[data-theme-option="${mode}"]`).click();
            await expect(page.locator('html')).toHaveAttribute('data-palette', palette);
            await expect(page.locator('html')).toHaveAttribute('data-theme', mode);
            await expect(page.locator('[data-palette-option][aria-pressed="true"]')).toHaveCount(1);
            await expect(page.locator('[data-theme-option][aria-pressed="true"]')).toHaveCount(1);
            const colors = await page.evaluate(() => {
                const probe = document.createElement('span');
                document.body.append(probe);
                const result = {};
                for (const key of ['ink', 'muted', 'paper', 'surface', 'primary', 'on-primary', 'danger']) {
                    probe.style.color = `var(--${key})`;
                    result[key] = getComputedStyle(probe).color;
                }
                probe.remove();
                return result;
            });
            expect(contrast(colors.ink, colors.paper)).toBeGreaterThanOrEqual(4.5);
            expect(contrast(colors.muted, colors.surface)).toBeGreaterThanOrEqual(4.5);
            expect(contrast(colors.primary, colors.surface)).toBeGreaterThanOrEqual(4.5);
            expect(contrast(colors['on-primary'], colors.primary)).toBeGreaterThanOrEqual(4.5);
            expect(contrast(colors.danger, colors.surface)).toBeGreaterThanOrEqual(4.5);
            for (const control of await page.locator('.theme-controls button').all()) {
                const box = await control.boundingBox();
                expect(box.x).toBeGreaterThanOrEqual(0);
                expect(box.x + box.width).toBeLessThanOrEqual(320);
                expect(box.height).toBeGreaterThanOrEqual(44);
            }
        }
    }
});

test('palette and brightness persist across pages and reloads', async ({ page }) => {
    await page.goto('/');
    await openThemeMenu(page);
    await page.locator('[data-palette-option="purple"]').click();
    await page.locator('[data-theme-option="dark"]').click();
    for (const path of ['/plan/', '/todo/', '/learning/', '/auth/', '/']) {
        await page.goto(path);
        await expect(page.locator('html')).toHaveAttribute('data-palette', 'purple');
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
        await expect(page.locator('[data-palette-option="purple"]')).toHaveAttribute('aria-pressed', 'true');
    }
    await openThemeMenu(page);
    await page.locator('[data-theme-option="light"]').click();
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-palette', 'purple');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('existing brightness preference and system mode remain compatible', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('html')).toHaveAttribute('data-palette', 'blue');
    await openThemeMenu(page);
    await page.locator('[data-palette-option="orange"]').click();
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.locator('html')).toHaveAttribute('data-palette', 'orange');
    await page.locator('[data-theme-option="dark"]').click();
    await page.evaluate(() => localStorage.removeItem('dailySpace.palette.v1'));
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('html')).toHaveAttribute('data-palette', 'blue');
});

test('the settings menu stays open while choosing and closes with Escape or a click outside', async ({ page }) => {
    await page.goto('/plan/');
    const menu = page.locator('.theme-menu');
    await openThemeMenu(page);
    await page.locator('[data-palette-option="teal"]').click();
    await page.locator('[data-theme-option="dark"]').click();
    await expect(menu).toHaveAttribute('open', '');
    await page.keyboard.press('Escape');
    await expect(menu).not.toHaveAttribute('open', '');
    await expect(menu.locator('summary')).toBeFocused();
    await openThemeMenu(page);
    await page.locator('#planInput').click();
    await expect(menu).not.toHaveAttribute('open', '');
    await expect(page.locator('html')).toHaveAttribute('data-palette', 'teal');
});

test('the top bar keeps one row on a narrow phone and links the sections', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    for (const path of ['/', '/plan/', '/learning/', '/learning/archive/', '/auth/', '/todo/']) {
        await page.goto(path);
        const bar = page.locator('.app-bar');
        await expect(bar.locator('.auth-sync-status').or(bar.locator('.theme-menu')).first()).toBeVisible();
        const tops = await bar.evaluate(element => [...element.querySelectorAll(':scope > .app-brand, :scope > .app-nav, .app-bar-end > .theme-menu, .app-bar-end > .auth-nav .auth-login')]
            .filter(item => item.getClientRects().length)
            .map(item => Math.round(item.getBoundingClientRect().top + item.getBoundingClientRect().height / 2)));
        expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(2);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await page.goto('/plan/');
    await expect(page.locator('.app-nav a[aria-current="page"]')).toHaveText('계획');
    await page.locator('.app-nav').getByRole('link', { name: 'TIL' }).click();
    await expect(page).toHaveURL(/\/learning\/$/);
    await expect(page.locator('.app-nav a[aria-current="page"]')).toHaveText('TIL');
});
