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

const logSets = page => page.locator('.log-set');

test('workout tab records sets from one form and lists them by exercise below', async ({ page }) => {
    await expect(page.locator('.composer')).toBeHidden();
    await expect(page.locator('.routine-manager')).toBeHidden();
    await expect(page.locator('#categoryPanel')).toBeHidden();
    await expect(page.locator('#planTitle')).toHaveText('운동 기록');
    await expect(page.locator('.log-empty')).toBeVisible();

    await page.locator('.suggestion-chip', { hasText: '벤치프레스' }).click();
    await expect(page.locator('#recordSetButton')).toBeFocused();
    await expect(page.locator('#recordSetButton')).toHaveText('1세트 기록');
    await expect(page.locator('#entry-weight')).toHaveValue('20');
    await expect(page.locator('#entry-reps')).toHaveValue('10');

    // The numbers stay after recording, so the same set again is one tap.
    await page.locator('#entry-weight').fill('60');
    await page.locator('#recordSetButton').click();
    await expect(logSets(page)).toHaveCount(1);
    await expect(logSets(page).first()).toContainText('60kg × 10회');
    await expect(page.locator('#entry-weight')).toHaveValue('60');
    await expect(page.locator('#recordSetButton')).toHaveText('2세트 기록');
    await expect(page.locator('#recordSetButton')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(logSets(page)).toHaveCount(2);

    await page.getByRole('button', { name: '무게 2.5kg 늘리기' }).click();
    await expect(page.locator('#entry-weight')).toHaveValue('62.5');
    await page.locator('#entry-reps').press('Enter');
    await expect(logSets(page)).toHaveCount(3);
    await expect(logSets(page).nth(2).locator('.record-badge')).toHaveText('PR');
    await expect(page.locator('.fitness-summary')).toHaveText('3세트 · 볼륨 1,825kg');
    await expect(page.locator('.exercise-meta .is-best')).toContainText('62.5kg × 10회');
    await expect(page.locator('.log-group-meta')).toHaveText('3세트 · 1,825kg');
    await expect(page.locator('#fitnessTabCount')).toHaveText('3');

    // An invalid number is pointed out and nothing is recorded.
    await page.locator('#entry-reps').fill('0');
    await page.locator('#recordSetButton').click();
    await expect(page.locator('#setError')).toContainText('횟수(1회 이상)');
    await expect(page.locator('#entry-reps')).toHaveAttribute('aria-invalid', 'true');
    await expect(logSets(page)).toHaveCount(3);
    await page.locator('#entry-reps').fill('10');
    await expect(page.locator('#setError')).toBeHidden();

    // Tapping a line loads it into the form; saving changes only that set.
    await logSets(page).nth(1).click();
    await expect(page.locator('.editing-badge')).toHaveText('2세트 수정 중');
    await expect(page.locator('#entry-weight')).toHaveValue('60');
    await expect(page.locator('#recordSetButton')).toHaveText('2세트 수정 저장');
    await expect(logSets(page).nth(1)).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#entry-reps').fill('12');
    await page.locator('#recordSetButton').click();
    await expect(logSets(page).nth(1)).toContainText('60kg × 12회');
    await expect(logSets(page)).toHaveCount(3);
    await expect(page.locator('#recordSetButton')).toHaveText('4세트 기록');
    await expect(page.locator('#entry-weight')).toHaveValue('62.5');

    await logSets(page).first().click();
    await page.getByRole('button', { name: '취소' }).click();
    await expect(page.locator('.editing-badge')).toHaveCount(0);
    await expect(logSets(page).first()).toBeFocused();
    await logSets(page).first().click();
    await page.getByRole('button', { name: '삭제', exact: true }).click();
    await expect(logSets(page)).toHaveCount(2);
    await expect(page.locator('#recordSetButton')).toHaveText('3세트 기록');

    // Exercises are grouped in the order they were first done today.
    await page.locator('#addExerciseToggle').click();
    await page.locator('.suggestion-chip', { hasText: '풀업' }).click();
    await page.locator('#recordSetButton').click();
    await page.locator('.exercise-chip', { hasText: '벤치프레스' }).click();
    await page.locator('#recordSetButton').click();
    await expect(page.locator('.log-group h5')).toHaveText(['벤치프레스', '풀업']);
    await expect(page.locator('.log-group').first().locator('.log-set')).toHaveCount(3);

    await page.reload();
    await expect(page.locator('#fitnessTab')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.log-group h5')).toHaveText(['벤치프레스', '풀업']);
    await expect(page.locator('.log-group').first().locator('.log-set-value')).toHaveText(['60kg × 12회', '62.5kg × 10회', '62.5kg × 10회']);
    expect((await stored(page)).sets.filter(set => set.weight !== undefined).map(set => [set.date, set.weight, set.reps])).toEqual([
        ['2026-11-20', 60, 12], ['2026-11-20', 62.5, 10], ['2026-11-20', 62.5, 10]]);

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
    await page.locator('#entry-reps').fill('8');
    await page.locator('#recordSetButton').click();
    await expect(page.locator('#workoutLogTitle')).toHaveText('11/19 기록');
    await expect(page.locator('#fitness-day-2026-11-19')).toHaveClass(/has-workout/);
    await expect(page.locator('#fitness-day-2026-11-20')).not.toHaveClass(/has-workout/);

    await page.locator('.fitness-today-button').click();
    await expect(page.locator('#workoutLogTitle')).toHaveText('오늘의 기록');
    await expect(page.locator('.log-empty')).toBeVisible();
    await expect(page.locator('.exercise-meta')).toContainText('지난번 11/19');
    await expect(page.locator('.exercise-meta')).toContainText('8회');
    await expect(page.locator('#entry-reps')).toHaveValue('8');
    await page.locator('#recordSetButton').click();
    await expect(page.locator('.log-set-previous')).toHaveText(['지난번 8회']);
    await page.getByRole('button', { name: '횟수 1회 늘리기' }).click();
    await page.locator('#recordSetButton').click();
    await expect(logSets(page).nth(1).locator('.record-badge')).toHaveText('PR');
    await expect(page.locator('#fitnessTabCount')).toHaveText('2');
    expect((await stored(page)).sets.map(set => set.reps)).toEqual([8, 8, 9]);

    await page.locator('#exerciseHistoryToggle').click();
    await page.getByRole('button', { name: '11월 19일 목요일로 이동' }).click();
    await expect(logSets(page)).toHaveCount(1);
    await expect(logSets(page).first()).toContainText('8회');

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
