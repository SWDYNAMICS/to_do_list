const { test, expect } = require('@playwright/test');
const record = { id: 'old', title: '기존 보관 기록', date: '2026-10-25', content: '원본 내용',
    location: 'archive', category: '보존', customField: 'keep',
    contentFormat: 'tiptap-v1', richContent: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '원본 내용', marks: [{ type: 'underline' }] }] }] },
    review: { version: 2, dueAt: '2026-10-01T00:00:00Z', outcome: 'correct', results: [true] } };
async function open(page, payload) {
    await page.goto('/learning/');
    await page.evaluate(payload => localStorage.setItem('learningRecords', JSON.stringify(payload)), payload);
    await page.reload();
}
test.beforeEach(async ({ page }) => { await page.route('https://**', route => route.abort()); });

test('legacy local array loads in bookcase without rewriting; next save persists a v2 envelope', async ({ page }) => {
    await open(page, [record]);
    await expect(page.locator('.record-card')).toHaveCount(0);
    await page.locator('#bookcaseTab').click();
    await expect(page.locator('.record-title')).toHaveText(record.title);
    await expect(page.locator('.review-blank')).toHaveCount(0);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('learningRecords')))).toEqual([record]);
    await page.locator('.edit-record').click();
    await page.locator('#learningTitle').fill('제목 수정');
    await page.locator('#saveRecord').click();
    await expect(page.locator('#formStatus')).toContainText('수정했습니다');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('learningRecords')));
    expect(saved.version).toBe(2);
    expect(saved.records[0].location).toBe('bookcase');
    expect(saved.records[0].customField).toBe('keep');
    expect(saved.records[0].richContent).toEqual(record.richContent);
    expect(saved.records[0].review).toEqual({ ...record.review, dueAt: new Date(record.review.dueAt).toISOString() });
    await page.reload();
    await page.locator('#bookcaseTab').click();
    await expect(page.locator('.record-title')).toHaveText('제목 수정');
    await page.locator('.move-record').click();
    await page.locator('#deskTab').click();
    await expect(page.locator('.review-blank')).toHaveCount(1);
});

for (const version of [2, 3]) {
    test(`unsupported location or version ${version} blocks edits without changing source`, async ({ page }) => {
        const original = { version, records: [record] };
        await open(page, original);
        await expect(page.locator('#formStatus')).toContainText('기록을 불러오지 못했습니다');
        await expect(page.locator('#saveRecord')).toBeDisabled();
        await expect(page.locator('#deskTab')).toBeDisabled();
        expect(await page.evaluate(() => JSON.parse(localStorage.getItem('learningRecords')))).toEqual(original);
        await page.reload();
        await expect(page.locator('#saveRecord')).toBeDisabled();
    });
}

for (const mode of ['cloud', 'offline']) {
test(`${mode} v1 loads safely; failure preserves v1 and retry saves v2`, async ({ page }) => {
    await page.addInitScript(({ payload, mode }) => {
        if (!localStorage.getItem('mockCloud')) localStorage.setItem('mockCloud', JSON.stringify(payload));
        Object.defineProperty(window, 'AppBackend', { configurable: true, set(backend) {
            Object.defineProperty(window, 'AppBackend', { configurable: true, value: {
                ...backend,
                loadUserData: async () => ({ data: JSON.parse(localStorage.getItem('mockCloud')), user: { id: 'test' }, mode }),
                saveUserData: async (key, data, options) => {
                    if (options.cacheOnFailure !== false) throw new Error('must preserve source on failure');
                    if (!window.allowSave) return false;
                    localStorage.setItem('mockCloud', JSON.stringify(data));
                    return true;
                }
            } });
        } });
    }, { payload: { version: 1, records: [record], metadata: 'keep' }, mode });
    await page.goto('/learning/');
    await page.locator('#bookcaseTab').click();
    await expect(page.locator('.record-title')).toHaveText(record.title);
    await page.locator('.move-record').click();
    await expect(page.locator('#recordMoveStatus')).toContainText('이동하지 못했습니다');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('mockCloud')).version)).toBe(1);
    await page.evaluate(() => { window.allowSave = true; });
    await page.locator('.move-record').click();
    await expect(page.locator('#recordMoveStatus')).toContainText('데스크로 옮겼습니다');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('mockCloud')));
    expect(saved.version).toBe(2);
    expect(saved.metadata).toBe('keep');
    expect(saved.records[0].richContent).toEqual(record.richContent);
    await page.reload();
    await expect(page.locator('.review-blank')).toHaveCount(1);
});

}
