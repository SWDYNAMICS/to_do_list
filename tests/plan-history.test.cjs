const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');

const source = fs.readFileSync(`${__dirname}/../plan/plan.js`, 'utf8');
const PlanCollection = vm.runInNewContext(
    `${source.slice(0, source.indexOf('class RoutineCollection'))}\nPlanCollection;`,
    { crypto: { randomUUID } }
);
const plain = value => JSON.parse(JSON.stringify(value));

test('deleted line snapshots survive saving, stay separate by category and do not duplicate', () => {
    const plans = PlanCollection.empty();
    const personal = plans.addChain(['씻기', '<b>밥 먹기</b>'], 'personal');
    const work = plans.addChain(['회의'], 'work');
    const kept = plans.addChain(['남아 있는 계획'], 'personal');
    const before = Date.now();
    plans.removeChain(personal.id);
    plans.removeChain(work.id);
    assert.equal(plans.removeChain(personal.id), null);
    personal.toArray()[0].text = '삭제 후 원본 수정';

    const restored = PlanCollection.fromJSON(plans.serialize());
    assert.equal(restored.chains[0].id, kept.id);
    assert.equal(restored.deletedChains.length, 2);
    assert.deepEqual(plain(restored.getDeletedChains('personal')[0].items), ['씻기', '<b>밥 먹기</b>']);
    assert.deepEqual(plain(restored.getDeletedChains('work')[0].items), ['회의']);
    assert.ok(Date.parse(restored.deletedChains[0].deletedAt) >= before);
});

test('existing saved plans without history continue loading', () => {
    const plans = PlanCollection.empty();
    plans.addChain(['기존 계획']);
    const oldData = JSON.parse(plans.serialize());
    delete oldData.deletedChains;
    const restored = PlanCollection.fromJSON(JSON.stringify(oldData));
    assert.equal(restored.chains.length, 1);
    assert.equal(restored.deletedChains.length, 0);
});

test('history-only data loads newest first and invalid records are ignored', () => {
    const plans = PlanCollection.fromJSON(JSON.stringify({
        chains: [],
        deletedChains: [
            null,
            { deletedAt: 'invalid', items: ['손상된 날짜'] },
            { deletedAt: '2026-09-24T00:00:00Z', items: ['이전 계획', null, ''] },
            { deletedAt: '2026-09-26T00:00:00Z', items: ['최근 계획'] },
            { deletedAt: '2026-09-25T00:00:00Z', items: [] }
        ]
    }));
    assert.deepEqual(plain(plans.deletedChains.map(entry => entry.items)), [['최근 계획'], ['이전 계획']]);
    assert.equal(PlanCollection.fromJSON(plans.serialize()).deletedChains.length, 2);
});

test('permanent deletion removes only the selected legacy record, even with identical timestamps', () => {
    const entry = { category: 'personal', deletedAt: '2026-09-26T00:00:00Z', items: ['같은 내용'] };
    const plans = PlanCollection.fromJSON(JSON.stringify({
        chains: [], deletedChains: [entry, entry, { ...entry, category: 'work' }]
    }));
    const active = plans.addChain(['유지할 계획']);
    const target = plans.getDeletedChains('personal')[1];
    assert.equal(plans.removeDeletedChain(target), target);
    assert.equal(plans.removeDeletedChain(target), null);
    const restored = PlanCollection.fromJSON(plans.serialize());
    assert.equal(restored.getDeletedChains('personal').length, 1);
    assert.equal(restored.getDeletedChains('work').length, 1);
    assert.equal(restored.chains[0].id, active.id);
    restored.deletedChains.slice().forEach(record => restored.removeDeletedChain(record));
    assert.equal(PlanCollection.fromJSON(restored.serialize()).deletedChains.length, 0);
});

function historyUI(saveResult, confirmed = true) {
    let focused = null;
    const element = () => ({
        children: [],
        append(...children) { this.children.push(...children); },
        appendChild(child) { this.children.push(child); },
        replaceChildren() { this.children = []; },
        setAttribute() {},
        addEventListener(event, handler) { this[event] = handler; },
        focus() { focused = this; },
        querySelectorAll() { return this.children.map(row => row.children[0].children[1]); }
    });
    const plans = PlanCollection.empty();
    plans.removeChain(plans.addChain(['삭제할 기록']).id);
    let saves = 0;
    let message = '';
    const context = {
        plans, activeCategory: 'personal', historyOpen: true, historyDeletePending: false,
        CATEGORY_INFO: { personal: { label: '개인' } }, console,
        document: { createElement: element }, window: { confirm: () => confirmed },
        savePlans: async options => {
            saves++;
            assert.equal(options.cacheOnFailure, false);
            if (saveResult instanceof Error) throw saveResult;
            return saveResult;
        },
        announce: value => { message = value; }
    };
    for (const name of ['activePlans', 'historyPanel', 'historyToggle', 'historyHint', 'historyTitle', 'historyEmpty', 'historyList']) {
        context[name] = element();
    }
    vm.createContext(context);
    vm.runInContext(source.slice(source.indexOf('function createActionButton('), source.indexOf('function createInsertForm(')), context);
    vm.runInContext(source.slice(source.indexOf('function renderHistory()'), source.indexOf('function setHistoryOpen(')), context);
    context.renderHistory();
    return { context, button: context.historyList.querySelectorAll()[0],
        result: () => ({ saves, message, focused }) };
}

test('cancel leaves the history untouched; confirmed deletion shows the empty state and moves focus', async () => {
    const canceled = historyUI(true, false);
    await canceled.button.click();
    assert.equal(canceled.context.plans.deletedChains.length, 1);
    assert.equal(canceled.result().saves, 0);
    const deleted = historyUI(true);
    const pending = deleted.button.click();
    await deleted.button.click();
    await pending;
    assert.equal(deleted.result().saves, 1);
    assert.equal(deleted.context.plans.deletedChains.length, 0);
    assert.equal(deleted.context.historyEmpty.hidden, false);
    assert.equal(deleted.result().focused, deleted.context.historyToggle);
    assert.match(deleted.result().message, /영구삭제했습니다/);
});

test('failed persistence restores the record and allows retry', async () => {
    for (const failure of [false, new Error('offline')]) {
        const ui = historyUI(failure);
        ui.context.console = { error() {} };
        await ui.button.click();
        assert.equal(ui.context.plans.deletedChains.length, 1);
        assert.equal(ui.context.historyDeletePending, false);
        assert.equal(ui.context.historyList.querySelectorAll()[0].disabled, false);
        assert.match(ui.result().message, /다시 시도/);
    }
});
