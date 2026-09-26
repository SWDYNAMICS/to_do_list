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
