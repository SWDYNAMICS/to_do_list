const { test, expect } = require('@playwright/test');

const record = (id, overrides = {}) => ({
    id, title: `기록 ${id}`, date: '2026-10-28', category: 'JavaScript',
    location: 'desk', content: `내용 ${id}`, review: null, ...overrides
});
const richRecord = record('rich', {
    title: '보이는 참조 개념', location: 'bookcase', content: '참조 보존할 코드 const values = [];',
    contentFormat: 'tiptap-v1', customField: { keep: ['all', 'fields'] },
    richContent: { type: 'doc', content: [
        { type: 'paragraph', content: [
            { type: 'text', text: '참조', marks: [{ type: 'underline' }, { type: 'textColor', attrs: { color: 'blue' } }] },
            { type: 'text', text: ' 보존할 코드', marks: [{ type: 'bold' }] }
        ] },
        { type: 'codeBlock', attrs: { language: 'js' }, content: [{ type: 'text', text: 'const values = [];' }] }
    ] },
    review: { version: 2, dueAt: '2026-01-01T00:00:00.000Z', outcome: 'incorrect', results: [false] }
});

async function seed(page, records) {
    await page.goto('/learning/');
    await page.evaluate(records => localStorage.setItem('learningRecords', JSON.stringify({
        version: 3, metadata: { preserve: true }, records
    })), records);
    await page.reload();
    await expect(page.locator('#saveRecord')).toBeEnabled();
}

async function stored(page) {
    return page.evaluate(() => JSON.parse(localStorage.getItem('learningRecords')));
}

const filter = (page, name) => page.locator(`#categoryFilters [data-category-filter="${name}"]`);
const batchButton = page => page.locator('#archiveCategoryButton');

test.beforeEach(async ({ context }) => {
    await context.route('https://**', route => route.abort());
});

test('bookcase category transfer includes search-hidden normalized matches in one write and preserves other records', async ({ page }) => {
    const hidden = record('hidden', { category: '  JAVASCRIPT  ', location: 'bookcase', customField: 'keep hidden' });
    const untouched = [
        record('desk-same-category'),
        record('bookcase-other', { category: '영어', location: 'bookcase' }),
        record('already-archived', { location: 'archive', archivedAt: '2026-10-20T01:00:00.000Z' })
    ];
    await seed(page, [richRecord, hidden, ...untouched]);
    await page.locator('#bookcaseTab').click();
    await expect(batchButton(page)).toBeDisabled();
    await filter(page, 'category:javascript').click();
    await page.locator('#recordSearch').fill('보이는');
    await expect(page.locator('.record-card')).toHaveCount(1);
    await expect(batchButton(page)).toContainText('2개');
    await expect(page.locator('#categoryArchiveHelp')).toContainText('북케이스');
    await expect(page.locator('#categoryArchiveHelp')).toContainText('검색');
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(batchButton(page)).toBeVisible();
    await page.evaluate(() => {
        const original = Storage.prototype.setItem;
        window.learningWriteCount = 0;
        Storage.prototype.setItem = function (key, value) {
            if (key === 'learningRecords') window.learningWriteCount++;
            return original.call(this, key, value);
        };
    });
    await batchButton(page).click();
    await expect(page.locator('#recordMoveStatus')).toContainText('아카이브');
    await expect(page.locator('#recordMoveStatus')).toContainText('2개');
    await expect(page.locator('#recordMoveStatus')).toContainText('JavaScript');
    expect(await page.evaluate(() => window.learningWriteCount)).toBe(1);
    const data = await stored(page);
    expect(data.metadata).toEqual({ preserve: true });
    expect(data.records).toHaveLength(5);
    const movedRich = data.records.find(item => item.id === richRecord.id);
    const movedHidden = data.records.find(item => item.id === hidden.id);
    expect(movedRich).toMatchObject({ ...richRecord, location: 'archive' });
    expect(movedHidden).toMatchObject({ ...hidden, category: 'JAVASCRIPT', location: 'archive' });
    expect(Number.isFinite(Date.parse(movedRich.archivedAt))).toBe(true);
    expect(movedHidden.archivedAt).toBe(movedRich.archivedAt);
    for (const original of untouched) {
        expect(data.records.find(item => item.id === original.id)).toEqual(original);
    }
    await expect(page.locator('#archiveCount')).toHaveText('3');
    await expect(page.locator('#bookcaseTab .record-tab-count')).toHaveText('1');
    await expect(page.locator('#deskTab .record-tab-count')).toHaveText('1');
    await page.goto('/learning/archive/');
    await expect(page.locator('.archive-card-link')).toHaveCount(3);
    await page.getByRole('link', { name: /보이는 참조 개념/ }).click();
    await expect(page.locator('#articleContent u')).toHaveText('참조');
    await expect(page.locator('#articleContent pre')).toHaveText('const values = [];');
});

test('desk uncategorized transfer leaves bookcase records and named categories in place', async ({ page }) => {
    const records = [
        record('empty', { category: '' }),
        record('whitespace', { category: '   ' }),
        record('named'),
        record('bookcase-empty', { category: '', location: 'bookcase' })
    ];
    await seed(page, records);
    await expect(batchButton(page)).toBeDisabled();
    await filter(page, 'uncategorized').click();
    await expect(batchButton(page)).toBeEnabled();
    await expect(batchButton(page)).toContainText('2개');
    await expect(page.locator('#categoryArchiveHelp')).toContainText('데스크');
    await batchButton(page).click();
    await expect(page.locator('#recordMoveStatus')).toContainText('미분류');
    await expect(page.locator('#recordMoveStatus')).toContainText('2개');
    const data = await stored(page);
    for (const id of ['empty', 'whitespace']) expect(data.records.find(item => item.id === id).location).toBe('archive');
    expect(data.records.find(item => item.id === 'named')).toEqual(records[2]);
    expect(data.records.find(item => item.id === 'bookcase-empty')).toEqual(records[3]);
    await expect(batchButton(page)).toBeDisabled();
    await filter(page, 'all').click();
    await expect(batchButton(page)).toBeDisabled();
    await expect(page.locator('.record-card')).toHaveCount(1);
});

test('a failed category transfer retains every original and succeeds as one batch when retried', async ({ page }) => {
    await seed(page, [record('first'), record('second'), record('other', { category: '영어' })]);
    await filter(page, 'category:javascript').click();
    const original = await stored(page);
    await page.evaluate(() => {
        window.originalStorageSet = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
            if (key === 'learningRecords') throw new Error('quota');
            return window.originalStorageSet.call(this, key, value);
        };
    });
    await batchButton(page).click();
    await expect(page.locator('#recordMoveStatus')).toContainText('못했습니다');
    expect(await stored(page)).toEqual(original);
    await expect(page.locator('.record-card')).toHaveCount(2);
    await expect(page.locator('#archiveCount')).toHaveText('0');
    await expect(batchButton(page)).toBeEnabled();
    await page.evaluate(() => { Storage.prototype.setItem = window.originalStorageSet; });
    await batchButton(page).click();
    await expect(page.locator('#recordMoveStatus')).toContainText('아카이브');
    const data = await stored(page);
    expect(data.records.filter(item => item.location === 'archive').map(item => item.id).sort()).toEqual(['first', 'second']);
    expect(data.records.find(item => item.id === 'other')).toEqual(original.records[2]);
});

test('a concurrent edit to one selected record cancels the entire category transfer', async ({ page }) => {
    await seed(page, [record('first'), record('second')]);
    await filter(page, 'category:javascript').click();
    // Simulate another page saving after this page loaded its revision.
    await page.evaluate(() => {
        const data = JSON.parse(localStorage.getItem('learningRecords'));
        data.records[1].content = '다른 화면에서 저장한 최신 내용';
        localStorage.setItem('learningRecords', JSON.stringify(data));
    });
    const external = await stored(page);
    await batchButton(page).click();
    await expect(page.locator('#recordMoveStatus')).toContainText('다른 화면에서 변경');
    expect(await stored(page)).toEqual(external);
    await expect(page.locator('.record-card')).toHaveCount(2);
    await expect(page.locator('#archiveCount')).toHaveText('0');
    await expect(batchButton(page)).toBeEnabled();
});

test('an edited target blocks its category transfer while another category can move without losing the draft', async ({ page }) => {
    await seed(page, [record('editing'), record('peer'), record('other', { category: '영어' })]);
    await filter(page, 'category:javascript').click();
    await page.getByRole('button', { name: '기록 editing 기록 수정', exact: true }).click();
    await page.locator('#learningTitle').fill('저장하지 않은 제목');
    await page.locator('.editor-document').fill('저장하지 않은 중요한 본문');
    await page.locator('#recordSearch').fill('peer');
    await expect(page.locator('.record-card')).toHaveCount(1);
    await expect(batchButton(page)).toBeDisabled();
    await expect(page.locator('#categoryArchiveHelp')).toContainText('수정');
    await page.locator('#recordSearch').fill('');
    await filter(page, 'category:영어').click();
    await expect(batchButton(page)).toBeEnabled();
    await batchButton(page).click();
    await expect(page.locator('#recordMoveStatus')).toContainText('아카이브');
    await expect(page.locator('#learningTitle')).toHaveValue('저장하지 않은 제목');
    await expect(page.locator('.editor-document')).toHaveText('저장하지 않은 중요한 본문');
    await filter(page, 'category:javascript').click();
    await expect(batchButton(page)).toBeDisabled();
    await page.locator('#cancelEdit').click();
    await expect(batchButton(page)).toBeEnabled();
    const data = await stored(page);
    expect(data.records.find(item => item.id === 'editing')).toMatchObject({ title: '기록 editing', content: '내용 editing', location: 'desk' });
    expect(data.records.find(item => item.id === 'peer').location).toBe('desk');
    expect(data.records.find(item => item.id === 'other').location).toBe('archive');
});
