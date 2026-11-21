const { test, expect } = require('@playwright/test');

const stored = page => page.evaluate(() => JSON.parse(localStorage.getItem('fitnessLog.v1')));

test.beforeEach(async ({ page }) => {
    await page.clock.install({ time: new Date('2026-11-20T12:00:00') });
    await page.route('https://**', route => route.abort());
    await page.goto('/plan/');
    await page.evaluate(() => {
        localStorage.removeItem('fitnessLog.v1');
        localStorage.removeItem('linkedPlans.activeCategory.v1');
    });
    await page.reload();
    await page.locator('#fitnessTab').click();
});

const field = (page, row, label) => page.locator('.set-row').nth(row).getByLabel(label);

test('workout tab hides plan sections, adds editable rows in one tap and restores them after reload', async ({ page }) => {
    await expect(page.locator('.composer')).toBeHidden();
    await expect(page.locator('.routine-manager')).toBeHidden();
    await expect(page.locator('#categoryPanel')).toBeHidden();
    await expect(page.locator('#planTitle')).toHaveText('운동 기록');

    await page.locator('.suggestion-chip', { hasText: '벤치프레스' }).click();
    await expect(page.locator('#addSetButton')).toBeFocused();
    await expect(page.locator('#addSetButton')).toContainText('1세트 추가');
    await expect(page.locator('#addSetButton')).toContainText('기본값 · 20kg × 10회');
    await expect(page.locator('.set-row')).toHaveCount(0);

    await page.locator('#addSetButton').click();
    await expect(field(page, 0, '1세트 무게 (kg)')).toHaveValue('20');
    await field(page, 0, '1세트 무게 (kg)').click();
    await page.keyboard.type('60');
    await expect(field(page, 0, '1세트 무게 (kg)')).toHaveValue('60');
    await expect(page.locator('#addSetButton')).toContainText('직전 세트 그대로 · 60kg × 10회');

    await page.locator('#addSetButton').click();
    await expect(page.locator('#addSetButton')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('.set-row')).toHaveCount(3);
    await expect(field(page, 2, '3세트 무게 (kg)')).toHaveValue('60');
    await expect(page.locator('.record-badge')).toHaveCount(0);

    await field(page, 2, '3세트 무게 (kg)').fill('62.5');
    await expect(page.locator('.set-row').nth(2).locator('.record-badge')).toHaveText('PR');
    await expect(page.locator('.fitness-summary')).toHaveText('3세트 · 볼륨 1,825kg');
    await expect(page.locator('.exercise-meta .is-best')).toContainText('62.5kg × 10회');
    await expect(page.locator('#fitnessTabCount')).toHaveText('3');

    // Enter moves to the next value, and an invalid value is put back when leaving the field.
    await field(page, 2, '3세트 무게 (kg)').press('Enter');
    await expect(field(page, 2, '3세트 횟수 (회)')).toBeFocused();
    await page.keyboard.type('0');
    await expect(field(page, 2, '3세트 횟수 (회)')).toHaveAttribute('aria-invalid', 'true');
    await page.keyboard.press('Tab');
    await expect(page.locator('#setError')).toContainText('이전 값으로 되돌렸어요');
    await expect(field(page, 2, '3세트 횟수 (회)')).toHaveValue('10');

    await page.getByRole('button', { name: '2세트 삭제' }).click();
    await expect(page.locator('.set-row')).toHaveCount(2);

    await page.reload();
    await expect(page.locator('#fitnessTab')).toHaveAttribute('aria-selected', 'true');
    await expect(field(page, 0, '1세트 무게 (kg)')).toHaveValue('60');
    await expect(field(page, 1, '2세트 무게 (kg)')).toHaveValue('62.5');
    await expect(field(page, 1, '2세트 횟수 (회)')).toHaveValue('10');
    await expect(page.locator('#addSetButton')).toContainText('3세트 추가');
    expect((await stored(page)).sets.map(set => [set.date, set.weight, set.reps])).toEqual([
        ['2026-11-20', 60, 10], ['2026-11-20', 62.5, 10]]);

    await page.locator('#personalTab').click();
    await expect(page.locator('.composer')).toBeVisible();
    await expect(page.locator('#fitnessPanel')).toBeHidden();
});

test('past days can be logged, show in the week strip and seed the next session', async ({ page }) => {
    await page.locator('.suggestion-chip', { hasText: '풀업' }).click();
    await expect(page.locator('#fitnessNextDay')).toBeDisabled();
    await expect(page.locator('#fitness-day-2026-11-22')).toBeDisabled();
    await page.locator('#fitnessPrevDay').click();
    await expect(page.locator('.fitness-date')).toContainText('11월 19일 목요일');
    await page.locator('#addSetButton').click();
    await field(page, 0, '1세트 횟수 (회)').fill('8');
    await field(page, 0, '1세트 횟수 (회)').blur();
    await expect(page.locator('#fitness-day-2026-11-19')).toHaveClass(/has-workout/);
    await expect(page.locator('#fitness-day-2026-11-20')).not.toHaveClass(/has-workout/);

    await page.locator('.fitness-today-button').click();
    await expect(page.locator('.exercise-meta')).toContainText('지난번 11/19');
    await expect(page.locator('.exercise-meta')).toContainText('8회');
    await expect(page.locator('#addSetButton')).toContainText('지난번 첫 세트 · 8회');
    await page.locator('#addSetButton').click();
    await expect(page.locator('.set-previous')).toHaveText(['8회']);
    await expect(field(page, 0, '1세트 횟수 (회)')).toHaveValue('8');
    await field(page, 0, '1세트 횟수 (회)').fill('9');
    await expect(page.locator('.record-badge')).toHaveText('PR');
    await expect(page.locator('#fitnessTabCount')).toHaveText('1');
    await field(page, 0, '1세트 횟수 (회)').press('Escape');
    await expect(field(page, 0, '1세트 횟수 (회)')).toHaveValue('8');
    await expect(page.locator('.record-badge')).toHaveCount(0);
    await field(page, 0, '1세트 횟수 (회)').fill('9');
    await field(page, 0, '1세트 횟수 (회)').blur();
    expect((await stored(page)).sets.map(set => set.reps)).toEqual([8, 9]);

    await page.locator('#exerciseHistoryToggle').click();
    await page.getByRole('button', { name: '11월 19일 목요일로 이동' }).click();
    await expect(field(page, 0, '1세트 횟수 (회)')).toHaveValue('8');
    await expect(page.locator('.set-row')).toHaveCount(1);

    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: '풀업 종목 삭제' }).click();
    expect((await stored(page)).sets).toHaveLength(0);
    await expect(page.locator('.exercise-form')).toBeVisible();
});

test('protein quick add, custom foods, goal and deletions persist', async ({ page }) => {
    await page.getByRole('button', { name: '닭가슴살 100g 23g 추가' }).click();
    await page.getByRole('button', { name: '닭가슴살 100g 23g 추가' }).click();
    await expect(page.locator('#proteinTotal')).toHaveText('46');
    await page.locator('#proteinName').fill('연어 스테이크');
    await page.locator('#proteinGrams').fill('30.5');
    await page.locator('#proteinGrams').press('Enter');
    await expect(page.locator('#proteinTotal')).toHaveText('76.5');
    await expect(page.locator('.protein-status')).toHaveText('23.5g 남았어요');
    await expect(page.getByRole('button', { name: '연어 스테이크 30.5g 추가' })).toBeVisible();

    await page.locator('#proteinGoalButton').click();
    await page.locator('#proteinGoalInput').fill('70');
    await page.locator('#proteinGoalInput').press('Enter');
    await expect(page.locator('.protein-status')).toHaveText('목표 달성!');

    await page.locator('#editFoodsButton').click();
    await page.getByRole('button', { name: '계란 1개 빠른 추가에서 지우기' }).click();
    await page.locator('#editFoodsButton').click();
    await expect(page.getByRole('button', { name: /계란 1개/ })).toHaveCount(0);
    await page.getByRole('button', { name: '닭가슴살 100g 23g 삭제' }).first().click();

    await page.reload();
    await expect(page.locator('#proteinTotal')).toHaveText('53.5');
    await expect(page.locator('#proteinGoalButton')).toContainText('목표 70g');
    await expect(page.locator('.entry-label')).toHaveText(['닭가슴살 100g', '연어 스테이크']);
    await expect(page.locator('#fitness-day-2026-11-20 .fitness-day-protein span')).toHaveAttribute('style', /width: 76\.4/);
    const data = await stored(page);
    expect(data.protein.goal).toBe(70);
    expect(data.protein.foods.map(food => food.name)).not.toContain('계란 1개');
});
