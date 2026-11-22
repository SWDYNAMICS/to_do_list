const { test, expect } = require('@playwright/test');

// A fake server kept in localStorage under testCloud:<key>, shared by every page in the test.
async function useFakeCloud(page) {
    await page.addInitScript(() => {
        const read = key => JSON.parse(localStorage.getItem(`testCloud:${key}`) || 'null');
        const write = (key, data) => localStorage.setItem(`testCloud:${key}`, JSON.stringify(data));
        Object.defineProperty(window, 'AppBackend', {
            configurable: true,
            set(backend) {
                Object.defineProperty(window, 'AppBackend', {
                    configurable: true,
                    value: {
                        ...backend,
                        loadUserData: async (key, data) => {
                            if (read(key) === null) write(key, data);
                            return { data: read(key), user: { id: 'test-user' }, mode: 'cloud' };
                        },
                        saveUserData: async (key, data) => { write(key, data); return true; },
                        hasPendingSave: () => false,
                        mutateUserData: async (key, mutate) => {
                            // testCloud:fail holds how many saves in a row should fail.
                            const failures = Number(localStorage.getItem('testCloud:fail') || 0);
                            if (failures > 0) {
                                localStorage.setItem('testCloud:fail', String(failures - 1));
                                throw new Error('network down');
                            }
                            const data = await mutate(read(key));
                            write(key, data);
                            return data;
                        }
                    }
                });
            }
        });
    });
}

// What another device would do: edit the server copy directly.
const editCloud = (page, key, change) => page.evaluate(([key, change]) => {
    const data = JSON.parse(localStorage.getItem(`testCloud:${key}`));
    new Function('data', change)(data);
    localStorage.setItem(`testCloud:${key}`, JSON.stringify(data));
}, [key, change]);

const returnToPage = page => page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
});

test.beforeEach(async ({ page }) => {
    await page.clock.install({ time: new Date('2026-11-20T12:00:00') });
    await page.route('https://**', route => route.abort());
    await useFakeCloud(page);
    await page.goto('/plan/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
});

test('workout saves merge with records another device saved, and failed saves are retried', async ({ page }) => {
    await page.locator('#fitnessTab').click();
    await page.locator('.suggestion-chip', { hasText: '벤치프레스' }).click();
    await page.locator('#recordSetButton').click();
    await expect(page.locator('#fitnessSync')).toContainText('서버에 저장됨');

    // The computer adds a set and protein while this tab stays open with the old copy.
    await editCloud(page, 'fitness', `
        const bench = data.exercises[0];
        data.sets.push({ id: 'pc-set', exerciseId: bench.id, date: '2026-11-20', weight: 80, reps: 3, at: '2026-11-20T11:59:00.000Z' });
        data.protein.entries.push({ id: 'pc-protein', date: '2026-11-20', grams: 30, label: 'PC', at: '2026-11-20T11:00:00.000Z' });`);
    await page.locator('#recordSetButton').click();
    await expect(page.locator('.log-set')).toHaveCount(3);
    await expect(page.locator('#proteinTotal')).toHaveText('30');
    let cloud = await page.evaluate(() => JSON.parse(localStorage.getItem('testCloud:fitness')));
    expect(cloud.sets.map(set => set.id)).toContain('pc-set');
    expect(cloud.sets).toHaveLength(3);

    // Coming back to the tab shows what the computer changed meanwhile.
    await editCloud(page, 'fitness', `data.sets = data.sets.filter(set => set.id !== 'pc-set');`);
    await returnToPage(page);
    await expect(page.locator('.log-set')).toHaveCount(2);

    // A failed save says so, keeps the record and succeeds on retry.
    await page.evaluate(() => localStorage.setItem('testCloud:fail', '1'));
    await page.getByRole('button', { name: '닭가슴살 100g 23g 추가' }).click();
    await expect(page.locator('#fitnessSync')).toContainText('저장하지 못했어요');
    await expect(page.locator('#proteinTotal')).toHaveText('53');
    await page.locator('.fitness-sync-retry').click();
    await expect(page.locator('#fitnessSync')).toContainText('서버에 저장됨');
    cloud = await page.evaluate(() => JSON.parse(localStorage.getItem('testCloud:fitness')));
    expect(cloud.protein.entries.map(entry => entry.grams).sort()).toEqual([23, 30]);
});

test('typing in the entry form is not interrupted when another device changes the log', async ({ page }) => {
    await page.locator('#fitnessTab').click();
    await page.locator('.suggestion-chip', { hasText: '스쿼트' }).click();
    await page.locator('#entry-weight').click();
    await editCloud(page, 'fitness', `data.protein.entries.push({ id: 'pc', date: '2026-11-20', grams: 40, label: 'PC', at: '2026-11-20T11:00:00.000Z' });`);
    await returnToPage(page);
    await page.keyboard.type('100');
    await page.locator('#entry-reps').click();
    await page.keyboard.type('5');
    await page.locator('#fitnessPrevDay').focus();
    await expect(page.locator('#proteinTotal')).toHaveText('40');
    await expect(page.locator('#entry-weight')).toHaveValue('100');
    await expect(page.locator('#entry-reps')).toHaveValue('5');
    await page.locator('#recordSetButton').click();
    await expect(page.locator('.log-set-value')).toHaveText(['100kg × 5회']);
    await expect(page.locator('#fitnessSync')).toContainText('서버에 저장됨');
    const cloud = await page.evaluate(() => JSON.parse(localStorage.getItem('testCloud:fitness')));
    expect(cloud.sets.map(set => [set.weight, set.reps])).toEqual([[100, 5]]);
});

test('returning to an open plan tab loads plans saved on another device', async ({ page }) => {
    await page.locator('#planInput').fill('기존 계획');
    await page.locator('#planForm button[type="submit"]').click();
    await expect(page.locator('.node-card')).toHaveCount(1);
    await editCloud(page, 'plans', `
        const chain = JSON.parse(JSON.stringify(data.chains[0]));
        chain.id = 'from-phone';
        chain.head = 'phone-node';
        chain.nodes = [{ ...chain.nodes[0], id: 'phone-node', next: null, text: '휴대폰에서 추가' }];
        data.chains.push(chain);`);
    await returnToPage(page);
    await expect(page.locator('.node-card')).toHaveCount(2);
    await expect(page.getByText('휴대폰에서 추가')).toBeVisible();
});

test('a workout change whose save never finished is sent on the next visit', async ({ page }) => {
    await page.locator('#fitnessTab').click();
    await page.locator('.suggestion-chip', { hasText: '풀업' }).click();
    await page.locator('#recordSetButton').click();
    await expect(page.locator('#fitnessSync')).toContainText('서버에 저장됨');

    // The network stays down until the page is gone, so even the saves tried while closing fail.
    await page.addInitScript(() => {
        if (!sessionStorage.getItem('testCloud:recover')) return;
        sessionStorage.removeItem('testCloud:recover');
        localStorage.removeItem('testCloud:fail');
    });
    await page.evaluate(() => localStorage.setItem('testCloud:fail', '99'));
    await page.locator('#recordSetButton').click();
    await expect(page.locator('#fitnessSync')).toContainText('저장하지 못했어요');
    // Meanwhile the computer adds protein.
    await editCloud(page, 'fitness', `data.protein.entries.push({ id: 'pc', date: '2026-11-20', grams: 25, label: 'PC', at: '2026-11-20T11:00:00.000Z' });`);
    await page.evaluate(() => sessionStorage.setItem('testCloud:recover', '1'));
    await page.reload();

    await expect(page.locator('.log-set')).toHaveCount(2);
    await expect(page.locator('#proteinTotal')).toHaveText('25');
    await expect(page.locator('#fitnessSync')).toContainText('서버에 저장됨');
    const cloud = await page.evaluate(() => JSON.parse(localStorage.getItem('testCloud:fitness')));
    expect(cloud.sets).toHaveLength(2);
    expect(cloud.protein.entries).toHaveLength(1);
    expect(await page.evaluate(() => localStorage.getItem('fitnessPending.v1:test-user'))).toBeNull();
});
