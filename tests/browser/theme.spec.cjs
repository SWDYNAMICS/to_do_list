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

test.beforeEach(async ({ page }) => {
    await page.route('https://**', route => route.abort());
});

test('six palettes are readable, fit mobile, and remain independent', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto('/');
    for (const palette of ['blue', 'purple', 'orange']) {
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
                for (const key of ['ink', 'muted', 'paper', 'surface', 'primary', 'on-primary']) {
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
    await page.locator('[data-palette-option="purple"]').click();
    await page.locator('[data-theme-option="dark"]').click();
    for (const path of ['/plan/', '/todo/', '/learning/', '/auth/', '/']) {
        await page.goto(path);
        await expect(page.locator('html')).toHaveAttribute('data-palette', 'purple');
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
        await expect(page.locator('[data-palette-option="purple"]')).toHaveAttribute('aria-pressed', 'true');
    }
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
