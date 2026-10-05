const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
    await page.route('https://**', route => route.abort());
    await page.goto('/plan/');
    await expect(page.locator('#planInput')).toBeEnabled();
});

async function createLine(page) {
    await page.locator('#planInput').fill('아침 준비');
    await page.locator('#planForm').evaluate(form => form.requestSubmit());
    await expect(page.locator('.chain-title')).toHaveText('라인 01');
}

test('renaming preserves creation time and deleted history displays creation rather than deletion', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await createLine(page);
    const createdAt = '2025-01-02T03:04:00.000Z';
    await page.evaluate(createdAt => {
        const data = JSON.parse(localStorage.getItem('linkedPlans.v3'));
        data.chains[0].createdAt = createdAt;
        localStorage.setItem('linkedPlans.v3', JSON.stringify(data));
    }, createdAt);
    await page.reload();
    await page.locator('.rename-chain-button').click();
    await page.getByLabel('라인 이름', { exact: true }).fill('출근 준비');
    await page.locator('.rename-chain-form button[type="submit"]').click();
    await expect(page.locator('.chain-title')).toHaveText('출근 준비');
    await page.reload();
    await expect(page.locator('.chain-title')).toHaveText('출근 준비');
    await page.getByRole('button', { name: '출근 준비 전체 삭제', exact: true }).click();
    await page.locator('#historyToggle').click();
    await expect(page.locator('.history-chain-name')).toHaveText('출근 준비');
    await expect(page.locator('.history-entry time')).toHaveAttribute('datetime', createdAt);
    await expect(page.locator('.history-entry time')).toContainText('생성');
    expect(errors).toEqual([]);
});

test('mobile rename cancel and blank validation; legacy history uses unknown creation time', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await createLine(page);
    await page.evaluate(() => {
        const data = JSON.parse(localStorage.getItem('linkedPlans.v3'));
        delete data.chains[0].createdAt;
        localStorage.setItem('linkedPlans.v3', JSON.stringify(data));
    });
    await page.reload();
    await page.locator('.rename-chain-button').click();
    await page.locator('.chain-name-input').fill('취소할 이름');
    await page.locator('.cancel-chain-name').click();
    await expect(page.locator('.chain-title')).toHaveText('라인 01');
    await page.locator('.rename-chain-button').click();
    await page.locator('.chain-name-input').fill('   ');
    await page.locator('.rename-chain-form button[type="submit"]').click();
    await expect(page.locator('.chain-title')).toHaveText('라인 01');
    expect(await page.locator('.chain-name-input').evaluate(input => input.validity.valid)).toBe(false);
    await page.locator('.chain-name-input').fill('회사 업무');
    await page.locator('.rename-chain-form button[type="submit"]').click();
    await expect(page.locator('.chain-title')).toHaveText('회사 업무');
    await page.getByRole('button', { name: '회사 업무 전체 삭제', exact: true }).click();
    await page.locator('#historyToggle').click();
    await expect(page.locator('.history-entry')).toContainText('생성 시각 미기록');
    await expect(page.locator('.history-entry time')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
