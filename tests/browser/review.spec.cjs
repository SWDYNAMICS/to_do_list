const { test, expect } = require('@playwright/test');
const record = {
    id: 'quiz', title: '복습 기록', date: '2026-10-09', category: '', location: 'desk',
    content: '핵심 정답 설명 두번째', contentFormat: 'tiptap-v1',
    richContent: { type: 'doc', content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '핵심 ' }, { type: 'text', text: '정답', marks: [{ type: 'underline' }] }] },
        { type: 'paragraph', content: [{ type: 'text', text: '설명 ' }, { type: 'text', text: '두', marks: [{ type: 'underline' }] }, { type: 'text', text: '번째', marks: [{ type: 'underline' }, { type: 'bold' }] }] }
    ] }, review: { version: 1, dueAt: '2020-01-01T00:00:00Z', outcome: null }
};
async function seed(page, value = record) {
    await page.evaluate(value => localStorage.setItem('learningRecords', JSON.stringify([value])), value);
    await page.reload();
    await expect(page.locator('#saveRecord')).toBeEnabled();
}
test.beforeEach(async ({ page }) => {
    await page.route('https://**', route => route.abort());
    await page.goto('/learning/');
    await expect(page.locator('#saveRecord')).toBeEnabled();
});

test('due rich records hide answers including outline; correct result persists in archive', async ({ page }) => {
    await seed(page);
    await expect(page.locator('.review-blank')).toHaveCount(2);
    await expect(page.locator('.record-content')).not.toContainText('정답');
    await expect(page.locator('.record-content .editor-outline')).toHaveCount(0);
    await page.locator('.check-review').click();
    await expect(page.locator('.review-panel')).toContainText('모든 빈칸');
    await page.getByRole('textbox', { name: '빈칸 1', exact: true }).fill(' 정답 ');
    await page.getByRole('textbox', { name: '빈칸 2', exact: true }).fill('두번째');
    await page.locator('.check-review').click();
    await expect(page.locator('#recordMoveStatus')).toContainText('정답입니다');
    await page.reload();
    await page.locator('[data-record-view="archive"]').click();
    await expect(page.locator('.record-content')).toContainText('정답');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('learningRecords'))[0].richContent)).toEqual(record.richContent);
});

test('wrong answer is revealed across reload, then becomes a question again after deadline', async ({ page }) => {
    await page.clock.install();
    await seed(page);
    await page.locator('.review-blank').nth(0).fill('오답');
    await page.locator('.review-blank').nth(1).fill('두번째');
    await page.locator('.check-review').click();
    await expect(page.locator('.review-answers')).toContainText('정답');
    await page.reload();
    await expect(page.locator('.review-blank')).toHaveCount(0);
    await expect(page.locator('.review-panel')).toContainText('다음 출제');
    await page.clock.fastForward(30 * 60 * 1000 + 30000);
    await expect(page.locator('.review-blank')).toHaveCount(2);
    await expect(page.locator('.review-answers')).toHaveCount(0);
});

test('failed result save keeps answers and allows retry without premature archive', async ({ page }) => {
    await seed(page);
    await page.locator('.review-blank').nth(0).fill('정답');
    await page.locator('.review-blank').nth(1).fill('두번째');
    await page.evaluate(() => { window.originalSet = Storage.prototype.setItem; Storage.prototype.setItem = () => { throw new Error('full'); }; });
    await page.locator('.check-review').click();
    await expect(page.locator('.review-panel')).toContainText('저장하지 못했습니다');
    await expect(page.locator('.review-blank').nth(0)).toHaveValue('정답');
    await page.evaluate(() => { Storage.prototype.setItem = window.originalSet; });
    await page.locator('.check-review').click();
    await expect(page.locator('#recordMoveStatus')).toContainText('정답입니다');
});

test('editor underline, preview, scheduling and content edit reset preserve source', async ({ page }) => {
    await page.locator('#learningTitle').fill('새 문제');
    await page.locator('.editor-document').click();
    await page.locator('[data-command="underline"]').click();
    await page.keyboard.insertText('직접 쓴 정답');
    await page.locator('#previewReview').click();
    await expect(page.locator('#reviewPreview .review-blank')).toHaveCount(1);
    await page.locator('#saveRecord').click();
    await expect(page.locator('.record-content u')).toHaveText('직접 쓴 정답');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('learningRecords'))[0]);
    expect(Date.parse(saved.review.dueAt) - Date.now()).toBeGreaterThan(29 * 60000);
    expect(Date.parse(saved.review.dueAt) - Date.now()).toBeLessThanOrEqual(30 * 60000);
    await page.locator('.edit-record').click();
    await page.locator('#learningTitle').fill('제목만 수정');
    await page.locator('#saveRecord').click();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('learningRecords'))[0].review.dueAt)).toBe(saved.review.dueAt);
    await seed(page, { ...record, location: 'archive', review: { ...record.review, outcome: 'correct' } });
    await page.locator('[data-record-view="archive"]').click();
    await page.locator('.edit-record').click();
    await page.locator('.editor-document').click();
    await page.keyboard.press('End');
    await page.keyboard.insertText('변경');
    await page.locator('#saveRecord').click();
    await expect(page.locator('[data-record-view="desk"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.review-panel')).toContainText('출제 예정');
});


test('returning an archived record immediately quizzes it and stays due after reload', async ({ page }) => {
    await seed(page, { ...record, location: 'archive', review: null });
    await page.locator('[data-record-view="archive"]').click();
    await page.locator('.move-record').click();
    await page.locator('[data-record-view="desk"]').click();
    await expect(page.locator('.review-blank')).toHaveCount(2);
    await page.reload();
    await expect(page.locator('.review-blank')).toHaveCount(2);
});

test('legacy 24-hour schedules use 30 minutes from the original start', async ({ page }) => {
    await seed(page, { ...record, review: { version: 1, outcome: null,
        dueAt: new Date(Date.now() + 23 * 3600000).toISOString() } });
    await expect(page.locator('.review-blank')).toHaveCount(2);
});
