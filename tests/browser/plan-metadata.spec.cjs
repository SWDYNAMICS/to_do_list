const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
    await page.route('https://**', route => route.abort());
    await page.goto('/plan/');
    await expect(page.locator('#planInput')).toBeEnabled();
});

// Left unnamed, a new line is named after the time it was made.
const TIME_NAME = /^\d{1,2}월 \d{1,2}일 \d{2}:\d{2}$/;

async function createLine(page) {
    await page.locator('#planInput').fill('아침 준비');
    await page.locator('#planForm').evaluate(form => form.requestSubmit());
    await expect(page.locator('.chain-title')).toHaveText(TIME_NAME);
    return page.locator('.chain-title').textContent();
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
    const name = await createLine(page);
    await page.evaluate(() => {
        const data = JSON.parse(localStorage.getItem('linkedPlans.v3'));
        delete data.chains[0].createdAt;
        localStorage.setItem('linkedPlans.v3', JSON.stringify(data));
    });
    await page.reload();
    await page.locator('.rename-chain-button').click();
    await page.locator('.chain-name-input').fill('취소할 이름');
    await page.locator('.cancel-chain-name').click();
    await expect(page.locator('.chain-title')).toHaveText(name);
    await page.locator('.rename-chain-button').click();
    await page.locator('.chain-name-input').fill('   ');
    await page.locator('.rename-chain-form button[type="submit"]').click();
    await expect(page.locator('.chain-title')).toHaveText(name);
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

test('a new line takes the typed name or the time it was made, and a loaded routine keeps its name', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-11-28T14:05:00') });
    await page.evaluate(() => localStorage.setItem('linkedPlanRoutines.v1', JSON.stringify({
        version: 1,
        routines: [{ id: 'morning', name: '아침 루틴', items: ['물 마시기', '스트레칭'], category: 'personal' }]
    })));
    await page.reload();
    const titles = page.locator('.chain-title');

    // Enter in the name moves on to the steps rather than submitting an empty line.
    await page.locator('#planName').fill('주간 보고');
    await page.locator('#planName').press('Enter');
    await expect(page.locator('#planInput')).toBeFocused();
    await expect(titles).toHaveCount(0);
    await page.locator('#planInput').fill('자료 모으기\n초안 쓰기');
    await page.locator('#planForm button[type="submit"]').click();
    await expect(titles.first()).toHaveText('주간 보고');
    await expect(page.locator('#planName')).toHaveValue('');

    await page.locator('#planInput').fill('산책');
    await page.locator('#planForm button[type="submit"]').click();
    await expect(titles.first()).toHaveText('11월 28일 14:05');

    await page.locator('#routineToggle').click();
    await page.locator('.routine-load-button').click();
    await expect(titles.first()).toHaveText('아침 루틴');

    // A half-typed name stays with its own tab.
    await page.locator('#planName').fill('쓰다 만 이름');
    await page.locator('#workTab').click();
    await expect(page.locator('#planName')).toHaveValue('');
    await page.locator('#personalTab').click();
    await expect(page.locator('#planName')).toHaveValue('쓰다 만 이름');

    await page.reload();
    await expect(titles).toHaveText(['아침 루틴', '11월 28일 14:05', '주간 보고']);
});
