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

test('legacy local array loads in bookcase without rewriting; next save persists a v3 envelope', async ({ page }) => {
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
    expect(saved.version).toBe(3);
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

for (const version of [2, 4]) {
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
test(`${mode} v1 loads safely; failure preserves v1 and retry saves v3`, async ({ page }) => {
    await page.addInitScript(({ payload, mode }) => {
        if (!localStorage.getItem('mockCloud')) localStorage.setItem('mockCloud', JSON.stringify(payload));
        Object.defineProperty(window, 'AppBackend', { configurable: true, set(backend) {
            Object.defineProperty(window, 'AppBackend', { configurable: true, value: {
                ...backend,
                loadUserData: async () => ({ data: JSON.parse(localStorage.getItem('mockCloud')), user: { id: 'test' }, mode }),
                mutateUserData: async (key, mutate) => {
                    if (!window.allowSave) throw new Error('offline');
                    const data = await mutate(JSON.parse(localStorage.getItem('mockCloud')));
                    localStorage.setItem('mockCloud', JSON.stringify(data));
                    return data;
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
    expect(saved.version).toBe(3);
    expect(saved.metadata).toBe('keep');
    expect(saved.records[0].richContent).toEqual(record.richContent);
    await page.reload();
    await expect(page.locator('.review-blank')).toHaveCount(1);
});

}

test('v2 bookcase keeps its location, rich content and review when upgraded by an edit', async ({ page }) => {
    const existing = { ...record, location: 'bookcase' };
    await open(page, { version: 2, metadata: 'keep', records: [existing] });
    await page.locator('#bookcaseTab').click();
    await expect(page.locator('.record-title')).toHaveText(record.title);
    await page.locator('.edit-record').click();
    await page.locator('#learningTitle').fill('북케이스 제목 수정');
    await page.locator('#saveRecord').click();
    await expect(page.locator('#formStatus')).toContainText('수정했습니다');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('learningRecords')));
    expect(saved.version).toBe(3);
    expect(saved.metadata).toBe('keep');
    expect(saved.records[0]).toMatchObject({ ...existing, title: '북케이스 제목 수정',
        review: { ...existing.review, dueAt: new Date(existing.review.dueAt).toISOString() } });
});

test('v3 archive stays out of desk and bookcase and remains untouched by a new desk record', async ({ page }) => {
    const archived = { ...record, archivedAt: '2026-10-27T00:00:00Z' };
    await open(page, { version: 3, records: [archived] });
    await expect(page.locator('#archiveCount')).toHaveText('1');
    await expect(page.locator('.record-card')).toHaveCount(0);
    await page.locator('#bookcaseTab').click();
    await expect(page.locator('.record-card')).toHaveCount(0);
    await page.locator('#learningTitle').fill('새 데스크 기록');
    await page.locator('.editor-document').fill('새 공부 내용');
    await page.locator('#saveRecord').click();
    await expect(page.locator('#formStatus')).toContainText('저장했습니다');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('learningRecords')));
    expect(saved.version).toBe(3);
    expect(saved.records).toHaveLength(2);
    expect(saved.records.find(item => item.id === archived.id)).toEqual(archived);
    await page.reload();
    await expect(page.locator('#archiveCount')).toHaveText('1');
    await expect(page.locator('#bookcaseTab .record-tab-count')).toHaveText('0');
});
