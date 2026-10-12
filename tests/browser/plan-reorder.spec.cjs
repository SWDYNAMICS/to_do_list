const { test, expect } = require('@playwright/test');
const stored = { version: 3, chains: [{ id: 'line', head: 'a', category: 'personal', name: '순서 테스트',
    nodes: ['A', 'B', 'C', 'D'].map((text, i) => ({ id: text.toLowerCase(), text, completed: text === 'C', next: ['b', 'c', 'd', null][i] })) }], deletedChains: [] };
async function titles(page) { return page.locator('.node-title').allTextContents(); }
test.beforeEach(async ({ page }) => {
    await page.route('https://**', route => route.abort());
    await page.goto('/plan/');
    await page.evaluate(data => localStorage.setItem('linkedPlans.v3', JSON.stringify(data)), stored);
    await page.reload();
    await expect(page.locator('.node-title')).toHaveCount(4);
});
async function drag(page, from, to, after = false) {
    const handle = await page.getByRole('button', { name: `${from} 순서 이동`, exact: true }).boundingBox();
    const card = await page.locator('.plan-node').filter({ has: page.locator('.node-title', { hasText: new RegExp(`^${to}$`) }) }).boundingBox();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(card.x + card.width * (after ? .8 : .2), card.y + card.height / 2, { steps: 8 });
}
test('mouse moves across rows, updates pointers, and persists completed nodes', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1400 });
    await page.locator('.chain-group').scrollIntoViewIfNeeded();
    await drag(page, 'D', 'A');
    await expect(page.locator('.drop-before')).toHaveCount(1);
    await page.mouse.up();
    await expect(page.locator('.node-title')).toHaveText(['D', 'A', 'B', 'C']);
    await page.reload();
    expect(await titles(page)).toEqual(['D', 'A', 'B', 'C']);
    await expect(page.getByLabel('C 완료 상태', { exact: true })).toBeChecked();
    await expect(page.locator('.node-pointer').last()).toHaveText('NEXT → END');
});
test('keyboard moves and failed saving restores the old order', async ({ page }) => {
    await page.getByRole('button', { name: 'A 순서 이동', exact: true }).press('End');
    await expect(page.locator('.node-title')).toHaveText(['B', 'C', 'D', 'A']);
    await page.evaluate(() => { Storage.prototype.setItem = () => { throw new Error('full'); }; });
    await page.getByRole('button', { name: 'A 순서 이동', exact: true }).press('Home');
    await expect(page.locator('#liveMessage')).toContainText('원래 순서');
    expect(await titles(page)).toEqual(['B', 'C', 'D', 'A']);
    await expect(page.locator('.plan-page')).not.toHaveAttribute('inert', '');
});
test('escape and dropping outside the line cancel without saving', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1400 });
    await page.locator('.chain-group').scrollIntoViewIfNeeded();
    await drag(page, 'D', 'A');
    await page.keyboard.press('Escape');
    await page.mouse.up();
    expect(await titles(page)).toEqual(['A', 'B', 'C', 'D']);
    await expect(page.locator('.node-drag-ghost')).toHaveCount(0);
    await drag(page, 'D', 'A');
    await page.mouse.move(5, 5);
    await page.mouse.up();
    expect(await titles(page)).toEqual(['A', 'B', 'C', 'D']);
});
test('touch handle scrolls the mobile vertical layout and reorders without opening history', async ({ page, context }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.node-drag-handle').first().scrollIntoViewIfNeeded();
    const handle = await page.locator('.node-drag-handle').first().boundingBox();
    const initialScroll = await page.evaluate(() => scrollY);
    const client = await context.newCDPSession(page);
    const point = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 };
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 195, y: 830 }] });
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(initialScroll + 150);
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(() => titles(page)).not.toEqual(['A', 'B', 'C', 'D']);
    await expect(page.locator('#historyPanel')).toBeHidden();
});
