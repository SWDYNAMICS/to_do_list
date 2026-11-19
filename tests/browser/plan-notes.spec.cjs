const { test, expect } = require('@playwright/test');
const stored = { version: 3, deletedChains: [], chains: [{ id: 'line', head: 'a', category: 'personal', name: '메모 테스트',
    nodes: [{ id: 'a', text: 'A', completed: false, next: 'b' }, { id: 'b', text: 'B', completed: false, next: null }] }] };
const saved = page => page.evaluate(() => JSON.parse(localStorage.getItem('linkedPlans.v3')).chains[0].nodes);

test.beforeEach(async ({ page }) => {
    await page.route('https://**', route => route.abort());
    await page.goto('/plan/');
    await page.evaluate(data => localStorage.setItem('linkedPlans.v3', JSON.stringify(data)), stored);
    await page.reload();
    await expect(page.locator('.node-title')).toHaveCount(2);
});

test('notes hang below an element, chain in order, edit, delete and persist without affecting progress', async ({ page }) => {
    await page.getByRole('button', { name: 'A 아래에 메모 달기', exact: true }).click();
    const input = page.getByRole('textbox', { name: 'A 아래에 달 메모', exact: true });
    await input.fill('첫 발견');
    await input.press('Enter');
    await expect(page.locator('.node-note')).toHaveCount(1);
    await expect(page.locator('.node-note')).toBeFocused();

    await page.getByRole('button', { name: 'A 아래에 메모 달기', exact: true }).click();
    await page.getByRole('textbox', { name: 'A 아래에 달 메모', exact: true }).fill('세 번째');
    await page.locator('.note-submit').click();
    await page.getByRole('button', { name: '메모 1 아래에 메모 추가', exact: true }).click();
    const between = page.getByRole('textbox', { name: 'A 아래에 달 메모', exact: true });
    await between.fill('두 번째');
    await between.press('Shift+Enter');
    await between.pressSequentially('줄');
    await between.press('Enter');
    await expect(page.locator('.node-note-text')).toHaveText(['첫 발견', '두 번째\n줄', '세 번째']);
    await expect(page.locator('.node-note .complete-toggle, .node-note input[type="checkbox"]')).toHaveCount(0);
    await expect(page.locator('.chain-count')).toHaveText('0 / 2 완료');

    await page.getByRole('button', { name: '메모 3 수정', exact: true }).click();
    const edit = page.getByRole('textbox', { name: 'A 메모 수정', exact: true });
    await edit.fill('고친 세 번째');
    await edit.press('Enter');
    await page.getByRole('button', { name: '메모 1 삭제', exact: true }).click();
    await expect(page.locator('.node-note-text')).toHaveText(['두 번째\n줄', '고친 세 번째']);
    expect((await saved(page))[0].notes.map(note => note.text)).toEqual(['두 번째\n줄', '고친 세 번째']);

    await page.reload();
    await expect(page.locator('.plan-node').first().locator('.node-note-text')).toHaveText(['두 번째\n줄', '고친 세 번째']);
    await expect(page.locator('.plan-node').nth(1).locator('.node-note')).toHaveCount(0);
});

test('escape cancels a note, blank notes are rejected and reordering keeps notes with their element', async ({ page }) => {
    await page.getByRole('button', { name: 'B 아래에 메모 달기', exact: true }).click();
    const input = page.getByRole('textbox', { name: 'B 아래에 달 메모', exact: true });
    await input.fill('   ');
    await input.press('Enter');
    await expect(input).toBeVisible();
    await input.press('Escape');
    await expect(page.locator('.note-form')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'B 아래에 메모 달기', exact: true })).toBeFocused();
    expect((await saved(page))[1].notes ?? []).toEqual([]);

    await page.getByRole('button', { name: 'B 아래에 메모 달기', exact: true }).click();
    await page.getByRole('textbox', { name: 'B 아래에 달 메모', exact: true }).fill('B의 메모');
    await page.locator('.note-submit').click();
    await page.getByRole('button', { name: 'B 순서 이동', exact: true }).press('Home');
    await expect(page.locator('.node-title')).toHaveText(['B', 'A']);
    await expect(page.locator('.plan-node').first().locator('.node-note-text')).toHaveText('B의 메모');
});
