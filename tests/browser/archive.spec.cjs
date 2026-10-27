const { test, expect } = require('@playwright/test');

const richRecord = {
    id: 'rich/id?한글', title: '배열과 참조', date: '2026-10-27', category: 'JavaScript',
    location: 'bookcase', content: '배열의 핵심 참조 보존할 본문 const values = [];',
    contentFormat: 'tiptap-v1', customField: { keep: true },
    richContent: { type: 'doc', content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '배열의 핵심' }] },
        { type: 'paragraph', content: [
            { type: 'text', text: '참조', marks: [{ type: 'underline' }, { type: 'textColor', attrs: { color: 'blue' } }] },
            { type: 'text', text: ' 보존할 본문', marks: [{ type: 'bold' }] }
        ] },
        { type: 'codeBlock', attrs: { language: 'js' }, content: [{ type: 'text', text: 'const values = [];' }] }
    ] },
    review: { version: 2, dueAt: '2020-01-01T00:00:00.000Z', outcome: 'incorrect', results: [false] }
};

async function seed(page, records, path = '/learning/') {
    await page.goto('/learning/');
    await page.evaluate(records => localStorage.setItem('learningRecords', JSON.stringify({
        version: 3, metadata: 'preserve document metadata', records
    })), records);
    await page.goto(path);
}

async function stored(page) {
    return page.evaluate(() => JSON.parse(localStorage.getItem('learningRecords')));
}

const editPath = id => `/learning/?edit=${encodeURIComponent(id)}&return=archive`;
const articlePath = id => `/learning/archive/?id=${encodeURIComponent(id)}`;

test.beforeEach(async ({ context }) => {
    await context.route('https://**', route => route.abort());
});

test('moving a rich bookcase record to archive preserves its source and removes it from both study tabs', async ({ page }) => {
    await seed(page, [richRecord]);
    await page.locator('#bookcaseTab').click();
    await expect(page.locator('.record-title')).toHaveText(richRecord.title);
    await page.getByRole('button', { name: `${richRecord.title} 기록 아카이브로 보내기`, exact: true }).click();
    await expect(page.locator('#recordMoveStatus')).toContainText('아카이브로 옮겼습니다');
    await expect(page.locator('.record-card')).toHaveCount(0);
    const data = await stored(page);
    expect(data.version).toBe(3);
    expect(data.metadata).toBe('preserve document metadata');
    expect(data.records).toHaveLength(1);
    expect(data.records[0]).toMatchObject({ ...richRecord, location: 'archive' });
    expect(Number.isFinite(Date.parse(data.records[0].archivedAt))).toBe(true);
    await page.reload();
    await expect(page.locator('#saveRecord')).toBeEnabled();
    await expect(page.locator('.record-card')).toHaveCount(0);
    await page.locator('#bookcaseTab').click();
    await expect(page.locator('.record-card')).toHaveCount(0);
    await expect(page.locator('a.archive-link')).toHaveAttribute('href', './archive/');
});

test('archive shows 12 summaries per page, searches title/body/category and reads the original without quizzes', async ({ page }) => {
    const records = Array.from({ length: 25 }, (_, index) => index === 0
        ? { ...richRecord, location: 'archive', archivedAt: '2026-10-27T01:00:00.000Z' }
        : { id: `article-${index}`, title: `개념 ${String(index + 1).padStart(2, '0')}`,
            date: '2026-10-26', category: index % 2 === 0 ? 'JavaScript' : '독서', location: 'archive',
            content: index === 24 ? '본문전용검색어를 담은 설명입니다.' : `개념 ${index + 1}의 정리된 본문입니다.` });
    await seed(page, records, '/learning/archive/');
    await expect(page.locator('.archive-card-link')).toHaveCount(12);
    await expect(page.locator('#archiveResultCount')).toHaveText('25편 · 1 / 3 페이지');
    await expect(page.locator('.editor-document, .review-blank')).toHaveCount(0);
    await page.locator('.archive-card-link').first().click();
    await expect(page.locator('#articleTitle')).toHaveText(richRecord.title);
    await expect(page.locator('#articleContent u')).toHaveText('참조');
    await expect(page.locator('#articleContent strong')).toHaveText(' 보존할 본문');
    await expect(page.locator('#articleContent pre')).toHaveText('const values = [];');
    await expect(page.locator('#articleContent [data-text-color="blue"]')).toHaveText('참조');
    await expect(page.locator('.review-blank, .review-correct, .review-incorrect')).toHaveCount(0);
    await page.reload();
    await expect(page.locator('#articleTitle')).toHaveText(richRecord.title);
    await page.locator('#archiveBack').click();
    await page.locator('#archivePagination').getByRole('button', { name: '다음 →', exact: true }).click();
    await expect(page.locator('#archiveResultCount')).toHaveText('25편 · 2 / 3 페이지');
    await expect(page.locator('.archive-card-link')).toHaveCount(12);
    await page.locator('#archivePagination').getByRole('button', { name: '다음 →', exact: true }).click();
    await expect(page.locator('.archive-card-link')).toHaveCount(1);
    await page.locator('.archive-card-link').click();
    await expect(page.locator('#articleTitle')).toHaveText('개념 25');
    await page.locator('#archiveBack').click();
    await expect(page.locator('#archiveResultCount')).toHaveText('25편 · 3 / 3 페이지');
    for (const query of ['개념 25', '본문전용검색어']) {
        await page.locator('#archiveSearch').fill(query);
        await expect(page.locator('.archive-card-link')).toHaveCount(1);
        await expect(page.locator('.archive-card-link h3')).toHaveText('개념 25');
    }
    await page.locator('#archiveSearch').fill('JavaScript');
    await expect(page.locator('#archiveResultCount')).toHaveText('13편 · 1 / 2 페이지');
    await page.locator('#archiveSearch').fill('');
    await page.locator('#archiveCategories [data-category-filter="category:javascript"]').click();
    await expect(page.locator('#archiveResultCount')).toHaveText('13편 · 1 / 2 페이지');
    await expect(page.locator('.archive-card-link')).toHaveCount(12);
    await page.locator('#archivePagination').getByRole('button', { name: '다음 →', exact: true }).click();
    await expect(page.locator('.archive-card-link')).toHaveCount(1);
    for (const width of [390, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
});

test('archive can return a record to bookcase or directly to a desk quiz', async ({ page }) => {
    const original = { ...richRecord, location: 'archive' };
    await seed(page, [original], articlePath(original.id));
    await expect(page.locator('#articleContent u')).toHaveText('참조');
    await page.locator('#articleToBookcase').click();
    await expect(page.locator('#archiveStatus')).toContainText('북케이스로 보냈습니다');
    const bookcase = (await stored(page)).records[0];
    expect(bookcase.location).toBe('bookcase');
    expect(bookcase.richContent).toEqual(original.richContent);
    expect(bookcase.review).toEqual(original.review);
    await page.goto('/learning/');
    await page.locator('#bookcaseTab').click();
    await expect(page.locator('.record-title')).toHaveText(original.title);
    await expect(page.locator('.review-blank')).toHaveCount(0);
    await page.locator('.archive-record').click();
    await expect(page.locator('.record-card')).toHaveCount(0);
    await page.goto(articlePath(original.id));
    await page.locator('#articleToDesk').click();
    await expect(page.locator('#archiveStatus')).toContainText('데스크로 보냈습니다');
    const desk = (await stored(page)).records[0];
    expect(desk.location).toBe('desk');
    expect(desk.review.outcome).toBeNull();
    expect(Date.parse(desk.review.dueAt)).toBeLessThanOrEqual(Date.now());
    expect(desk.richContent).toEqual(original.richContent);
    await page.goto('/learning/');
    await expect(page.locator('.review-blank')).toHaveCount(1);
    await page.reload();
    await expect(page.locator('.review-blank')).toHaveCount(1);
});

test('failed archive transfer leaves the original record intact and can be retried', async ({ page }) => {
    await seed(page, [richRecord]);
    await page.locator('#bookcaseTab').click();
    const original = await stored(page);
    await page.evaluate(() => {
        window.originalStorageSet = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
            if (key === 'learningRecords') throw new Error('quota');
            return window.originalStorageSet.call(this, key, value);
        };
    });
    await page.locator('.archive-record').click();
    await expect(page.locator('#recordMoveStatus')).toContainText('이동하지 못했습니다');
    await expect(page.locator('.record-title')).toHaveText(richRecord.title);
    expect(await stored(page)).toEqual(original);
    await page.evaluate(() => { Storage.prototype.setItem = window.originalStorageSet; });
    await page.locator('.archive-record').click();
    await expect(page.locator('.record-card')).toHaveCount(0);
    expect((await stored(page)).records[0].location).toBe('archive');
});

test('editing an archive article preserves its archive location and review state even when the body changes', async ({ page }) => {
    const original = { ...richRecord, location: 'archive', archivedAt: '2026-10-27T01:00:00.000Z' };
    await seed(page, [original], editPath(original.id));
    await expect(page.locator('#learningTitle')).toHaveValue(original.title);
    await page.locator('#learningTitle').fill('배열과 참조 정리');
    await page.locator('.editor-document').click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.insertText(' 수정 내용');
    await page.locator('#saveRecord').click();
    await expect(page.locator('#formStatus')).toContainText('수정했습니다');
    const saved = (await stored(page)).records[0];
    expect(saved.id).toBe(original.id);
    expect(saved.location).toBe('archive');
    expect(saved.archivedAt).toBe(original.archivedAt);
    expect(saved.review).toEqual(original.review);
    expect(saved.customField).toEqual(original.customField);
    expect(saved.content).toContain('수정 내용');
    await expect(page.locator('#archiveReturn')).toHaveAttribute('href', `./archive/?id=${encodeURIComponent(original.id)}`);
});

test('a second editor cannot overwrite changes saved from another tab and keeps its draft', async ({ page, context }) => {
    const original = { ...richRecord, location: 'archive' };
    await seed(page, [original], editPath(original.id));
    await expect(page.locator('#learningTitle')).toHaveValue(original.title);
    const second = await context.newPage();
    await second.goto(editPath(original.id));
    await expect(second.locator('#learningTitle')).toHaveValue(original.title);
    await page.locator('#learningTitle').fill('첫 탭에서 저장한 제목');
    await page.locator('#saveRecord').click();
    await expect(page.locator('#formStatus')).toContainText('수정했습니다');
    await second.locator('#learningTitle').fill('두 번째 탭의 아직 저장 안 된 초안');
    await second.locator('#saveRecord').click();
    await expect(second.locator('#formStatus')).toContainText('이 기록이 다른 화면에서 변경되었습니다.');
    await expect(second.locator('#learningTitle')).toHaveValue('두 번째 탭의 아직 저장 안 된 초안');
    const saved = (await stored(second)).records;
    expect(saved).toHaveLength(1);
    expect(saved[0].title).toBe('첫 탭에서 저장한 제목');
    expect(saved[0].location).toBe('archive');
});

test('moving an archive article from a stale tab preserves a new record created in the study page', async ({ page, context }) => {
    const original = { ...richRecord, location: 'archive' };
    await seed(page, [original], articlePath(original.id));
    await expect(page.locator('#articleTitle')).toHaveText(original.title);
    const study = await context.newPage();
    await study.goto('/learning/');
    await expect(study.locator('#saveRecord')).toBeEnabled();
    await study.locator('#learningTitle').fill('다른 탭의 새 기록');
    await study.locator('.editor-document').fill('새로 배운 개념을 보존합니다.');
    await study.locator('#saveRecord').click();
    await expect(study.locator('#formStatus')).toContainText('저장했습니다');
    await page.locator('#articleToBookcase').click();
    await expect(page.locator('#archiveStatus')).toContainText('북케이스로 보냈습니다');
    const saved = (await stored(page)).records;
    expect(saved).toHaveLength(2);
    expect(saved.find(record => record.id === original.id).location).toBe('bookcase');
    expect(saved.find(record => record.title === '다른 탭의 새 기록')).toMatchObject({
        location: 'desk', content: '새로 배운 개념을 보존합니다.'
    });
});

test('moving an unrelated record keeps an open editor’s original revision and prevents stale draft overwrite', async ({ page, context }) => {
    const original = { ...richRecord, location: 'archive' };
    const other = { id: 'other', title: '다른 공부', date: '2026-10-27', location: 'desk', content: '관련 없는 본문' };
    await seed(page, [original, other], editPath(original.id));
    await expect(page.locator('#learningTitle')).toHaveValue(original.title);
    await page.locator('#learningTitle').fill('현재 탭에 남겨 둔 초안');
    await page.locator('.editor-document').fill('아직 저장하지 않은 중요한 내용');

    const second = await context.newPage();
    await second.goto(editPath(original.id));
    await expect(second.locator('#learningTitle')).toHaveValue(original.title);
    await second.locator('#learningTitle').fill('다른 탭에서 확정한 제목');
    await second.locator('.editor-document').fill('다른 탭에서 저장한 최신 본문');
    await second.locator('#saveRecord').click();
    await expect(second.locator('#formStatus')).toContainText('수정했습니다');
    const externallySaved = (await stored(second)).records.find(record => record.id === original.id);
    expect(externallySaved.content).toContain('다른 탭에서 저장한 최신 본문');

    // Saving B refreshes A in the document, but must not adopt that newer A as
    // the expected revision for the old A draft still visible in this editor.
    await page.locator('.move-record').click();
    await expect(page.locator('#recordMoveStatus')).toContainText('북케이스로 옮겼습니다');
    await page.locator('#saveRecord').click();
    await expect(page.locator('#formStatus')).toContainText('이 기록이 다른 화면에서 변경되었습니다.');
    await expect(page.locator('#learningTitle')).toHaveValue('현재 탭에 남겨 둔 초안');
    await expect(page.locator('.editor-document')).toHaveText('아직 저장하지 않은 중요한 내용');
    const saved = (await stored(page)).records;
    expect(saved.find(record => record.id === original.id)).toEqual(externallySaved);
    expect(saved.find(record => record.id === other.id).location).toBe('bookcase');
});
