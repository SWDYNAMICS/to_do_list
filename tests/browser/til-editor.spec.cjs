const { test, expect } = require('@playwright/test');
const legacy = { id: 123, title: '기존 기록', category: '기초', date: '2026-09-27', content: '# 원문\n<b>문자 그대로</b>\n끝' };

async function paste(page, text, html = '') {
    await page.locator('.editor-document').focus();
    await page.locator('.editor-document').evaluate((element, data) => {
        const clipboardData = new DataTransfer();
        clipboardData.setData('text/plain', data.text);
        if (data.html) clipboardData.setData('text/html', data.html);
        element.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
    }, { text, html });
}

async function save(page, title = '새 기록') {
    await page.locator('#learningTitle').fill(title);
    await page.locator('#saveRecord').click();
    await expect(page.locator('#formStatus')).toContainText(/저장했습니다|수정했습니다/);
}

test.beforeEach(async ({ page }) => {
    await page.route('https://**', route => route.abort());
    await page.goto('/learning/');
    await expect(page.locator('.editor-document')).toHaveAttribute('contenteditable', 'true');
    await expect(page.locator('.notification-panel, #notificationTest, #pushSend')).toHaveCount(0);
});

test('legacy records remain literal; editing, cancel and draft restoration retain content', async ({ page }) => {
    await page.evaluate(record => localStorage.setItem('learningRecords', JSON.stringify([record])), legacy);
    await page.reload();
    await expect(page.locator('.record-content')).toHaveText(legacy.content);
    await expect(page.locator('.record-content h1, .record-content b')).toHaveCount(0);
    await paste(page, '**새 초안**');
    await page.locator('.edit-record').click();
    await expect(page.locator('.editor-document')).toContainText('<b>문자 그대로</b>');
    await expect(page.locator('.editor-document h1')).toHaveCount(0);
    await expect(page.locator('[data-command="undo"]')).toBeDisabled();
    await page.locator('#cancelEdit').click();
    await expect(page.locator('.editor-document strong')).toHaveText('새 초안');
    await page.locator('.edit-record').click();
    await save(page, '수정한 기존 기록');
    const record = await page.evaluate(() => JSON.parse(localStorage.getItem('learningRecords'))[0]);
    expect(record.id).toBe(123);
    expect(record.content).toBe(legacy.content);
    expect(record.contentFormat).toBe('tiptap-v1');
    await page.reload();
    await expect(page.locator('.record-title')).toHaveText('수정한 기존 기록');
    await expect(page.locator('.record-content')).toContainText('<b>문자 그대로</b>');
});

test('HTML paste retains headings, nesting, links, tables and code safely across reload', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await paste(page, 'ChatGPT 답변', '<h2>오늘의 학습</h2><p><strong>중요</strong> <em>개념</em> <a href="https://example.com">참고</a></p><ul><li><p>상위</p><ul><li><p>하위</p></li></ul></li></ul><table><tr><th>항목</th><th>설명</th></tr><tr><td>JS</td><td>언어</td></tr></table><pre><code class="language-js">const x = 1;\nconsole.log(x);</code></pre><p><a href="javascript:alert(1)">위험 링크</a><img src=x onerror="alert(1)"></p><script>alert(1)</script>');
    await expect(page.locator('.editor-document h2')).toHaveText('오늘의 학습');
    await expect(page.locator('.editor-document ul ul li')).toHaveCount(1);
    await expect(page.locator('.editor-document table')).toHaveCount(1);
    await save(page);
    await page.reload();
    await expect(page.locator('.record-content strong')).toHaveText('중요');
    await expect(page.locator('.record-content pre')).toContainText('console.log(x)');
    await expect(page.locator('.record-content table')).toHaveCount(1);
    await expect(page.locator('.record-content script, .record-content img, .record-content a[href^="javascript:"]')).toHaveCount(0);
    await page.locator('.edit-record').click();
    await expect(page.locator('.editor-document table')).toHaveCount(1);
    expect(errors).toEqual([]);
});

test('Markdown paste supports lists, tasks, table, code and automatic outline', async ({ page }) => {
    await paste(page, '# 학습\n\n## 복습\n\n- 첫 번째\n  - 두 번째\n\n- [x] 완료\n- [ ] 예정\n\n| 항목 | 설명 |\n| --- | --- |\n| A | B |\n\n```js\nconst x = 1;\n```');
    await expect(page.locator('.editor-document h1')).toHaveText('학습');
    await expect(page.locator('.editor-document li[data-type="taskItem"]')).toHaveCount(2);
    await expect(page.locator('.editor-document table')).toHaveCount(1);
    await expect(page.locator('#editorOutline button')).toHaveCount(2);
    await page.locator('.editor-shell summary').click();
    await page.locator('#editorOutline button').nth(1).click();
    await save(page);
    await expect(page.locator('.record-content .editor-outline')).toContainText('목차 · 2');
    await page.reload();
    await page.locator('.edit-record').click();
    await expect(page.locator('.editor-document li[data-checked="true"]')).toHaveCount(1);
});

test('explicit paste modes override HTML detection and plain text keeps syntax', async ({ page }) => {
    await page.locator('#pasteMode').selectOption('plain');
    await paste(page, '**있는 그대로**', '<strong>있는 그대로</strong>');
    await expect(page.locator('.editor-document')).toHaveText('**있는 그대로**');
    await expect(page.locator('.editor-document strong')).toHaveCount(0);
    await page.locator('#pasteMode').selectOption('markdown');
    await paste(page, '\n\n## 마크다운', '<p>## 마크다운</p>');
    await expect(page.locator('.editor-document h2')).toHaveText('마크다운');
});

test('list Tab indentation, mobile indent buttons and table commands work', async ({ page }) => {
    await paste(page, '- 하나\n- 둘');
    await page.locator('.editor-document li p').nth(1).click();
    await page.keyboard.press('Tab');
    await expect(page.locator('.editor-document ul ul li')).toHaveCount(1);
    await page.keyboard.press('Shift+Tab');
    await expect(page.locator('.editor-document ul ul')).toHaveCount(0);
    await page.locator('[data-command="indent"]').click();
    await expect(page.locator('.editor-document ul ul li')).toHaveCount(1);
    await page.locator('[data-command="outdent"]').click();
    await expect(page.locator('.editor-document ul ul')).toHaveCount(0);
    await page.locator('[data-command="table"]').click();
    await expect(page.locator('.editor-document table')).toHaveCount(1);
    await page.locator('.editor-document td').first().click();
    await page.locator('[data-command="addRow"]').click();
    await expect(page.locator('.editor-document tr')).toHaveCount(4);
    await page.locator('[data-command="deleteTable"]').click();
    await expect(page.locator('.editor-document table')).toHaveCount(0);
});

test('empty validation and failed save preserve the rich draft', async ({ page }) => {
    await page.locator('#learningTitle').fill('실패 테스트');
    await page.locator('#saveRecord').click();
    await expect(page.locator('#formStatus')).toContainText('내용을 입력');
    await paste(page, '# 소중한 초안');
    await page.evaluate(() => { Storage.prototype.setItem = () => { throw new Error('quota'); }; });
    await page.locator('#saveRecord').click();
    await expect(page.locator('#formStatus')).toContainText('저장하지 못했습니다');
    await expect(page.locator('.editor-document h1')).toHaveText('소중한 초안');
    await expect(page.locator('.record-card')).toHaveCount(0);
    await expect(page.locator('#saveRecord')).toBeEnabled();
});

test('long content and both themes fit desktop and mobile', async ({ page }) => {
    await paste(page, '# 긴 기록\n\n' + '긴 본문입니다. '.repeat(350) + '\n\n| 이름 | 내용 |\n| --- | --- |\n| 긴단어 | ' + 'a'.repeat(250) + ' |');
    for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1100 });
        for (const mode of ['light', 'dark']) {
            await page.locator(`[data-theme-option="${mode}"]`).click();
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        }
    }
    await save(page, '긴 글 저장');
    await expect(page.locator('.record-content')).toContainText('긴 본문입니다.');
    await page.reload();
    await page.locator('.edit-record').click();
    await expect(page.locator('.editor-document')).toContainText('긴 본문입니다.');
});

test('cloud save/load contract retains rich JSON without creating duplicate records', async ({ page }) => {
    await page.addInitScript(() => {
        Object.defineProperty(window, 'AppBackend', {
            configurable: true,
            set(backend) {
                Object.defineProperty(window, 'AppBackend', {
                    configurable: true,
                    value: {
                        ...backend,
                        loadUserData: async (key, data) => ({
                            data: JSON.parse(localStorage.getItem(`testCloud:${key}`) || 'null') || data,
                            user: { id: 'test-user' }, mode: 'cloud'
                        }),
                        saveUserData: async (key, data) => {
                            localStorage.setItem(`testCloud:${key}`, JSON.stringify(data));
                            return true;
                        }
                    }
                });
            }
        });
    });
    await page.reload();
    await paste(page, '## 동기화\n\n- [x] 서식 유지');
    await save(page, '서버 저장');
    const data = await page.evaluate(() => JSON.parse(localStorage.getItem('testCloud:learning')));
    expect(data.records[0].richContent.type).toBe('doc');
    await page.reload();
    await page.locator('.edit-record').click();
    await expect(page.locator('.editor-document h2')).toHaveText('동기화');
    await save(page, '서버 수정');
    const updated = await page.evaluate(() => JSON.parse(localStorage.getItem('testCloud:learning')));
    expect(updated.records).toHaveLength(1);
    expect(updated.records[0].id).toBe(data.records[0].id);
    expect(updated.records[0].contentFormat).toBe('tiptap-v1');
});

test('text palette colors a selection, survives reload and adapts to both themes', async ({ page }) => {
    await paste(page, '강조 일반');
    await page.locator('.editor-document p').evaluate(element => {
        const range = document.createRange();
        range.setStart(element.firstChild, 0);
        range.setEnd(element.firstChild, 2);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        document.dispatchEvent(new Event('selectionchange'));
    });
    await page.locator('[data-text-color-option="red"]').click();
    await expect(page.locator('.editor-document span[data-text-color="red"]')).toHaveText('강조');
    await expect(page.locator('.editor-document')).toHaveText('강조 일반');
    await save(page, '색상 기록');
    await page.reload();
    const colored = page.locator('.record-content [data-text-color="red"]');
    await expect(colored).toHaveText('강조');
    const light = await colored.evaluate(element => getComputedStyle(element).color);
    await page.locator('[data-theme-option="dark"]').click();
    expect(await colored.evaluate(element => getComputedStyle(element).color)).not.toBe(light);
    await page.locator('.edit-record').click();
    await expect(page.locator('.editor-document [data-text-color="red"]')).toHaveText('강조');
    await page.locator('.editor-document').focus();
    await page.keyboard.press('ControlOrMeta+a');
    await page.locator('[data-text-color-option=""]').click();
    await expect(page.locator('.editor-document [data-text-color]')).toHaveCount(0);
    await save(page, '색상 해제');
    await page.reload();
    await expect(page.locator('.record-content [data-text-color]')).toHaveCount(0);
});

test('all recommended colors have readable contrast on light and dark surfaces', async ({ page }) => {
    for (const mode of ['light', 'dark']) {
        await page.locator(`[data-theme-option="${mode}"]`).click();
        const ratios = await page.evaluate(() => {
            const root = getComputedStyle(document.documentElement);
            const luminance = hex => {
                const rgb = hex.trim().slice(1).match(/../g).map(v => parseInt(v, 16) / 255)
                    .map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
                return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
            };
            return ['blue', 'green', 'teal', 'orange', 'red', 'purple'].flatMap(color =>
                ['surface', 'surface-soft', 'surface-hover'].map(surface => {
                    const a = luminance(root.getPropertyValue(`--text-${color}`));
                    const b = luminance(root.getPropertyValue(`--${surface}`));
                    return { color, surface, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) };
                }));
        });
        for (const result of ratios) expect(result.ratio, JSON.stringify({ mode, ...result })).toBeGreaterThanOrEqual(4.5);
    }
});

test('editing an older record moves it first without duplication and persists after reload', async ({ page }) => {
    await page.evaluate(record => localStorage.setItem('learningRecords', JSON.stringify([
        { ...record, id: 1, title: '첫 기록' },
        { ...record, id: 2, title: '두 번째 기록' },
        { ...record, id: 3, title: '이전 기록' }
    ])), legacy);
    await page.reload();
    await page.locator('.edit-record').nth(2).click();
    await page.locator('#cancelEdit').click();
    await expect(page.locator('.record-title')).toHaveText(['첫 기록', '두 번째 기록', '이전 기록']);
    await page.locator('.edit-record').nth(2).click();
    await save(page, '수정한 이전 기록');
    await expect(page.locator('.record-title')).toHaveText(['수정한 이전 기록', '첫 기록', '두 번째 기록']);
    const records = await page.evaluate(() => JSON.parse(localStorage.getItem('learningRecords')));
    expect(records.map(record => record.id)).toEqual([3, 1, 2]);
    expect(records[0].date).toBe(legacy.date);
    await page.reload();
    await expect(page.locator('.record-title')).toHaveText(['수정한 이전 기록', '첫 기록', '두 번째 기록']);
});
