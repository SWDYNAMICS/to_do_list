const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');

const context = { window: {}, crypto: { randomUUID } };
vm.runInNewContext(fs.readFileSync(`${__dirname}/../plan/model.js`, 'utf8'), context);
const { PlanCollection } = context.window.PlanModel;
const plain = value => JSON.parse(JSON.stringify(value));
const texts = node => plain(node.notes.map(note => note.text));

test('notes chain below an element, survive serialization and never count as plan items', () => {
    const plans = PlanCollection.empty();
    const chain = plans.addChain(['조사하기'], 'personal');
    const [node] = chain.toArray();
    const first = chain.addNote(node.id, '  첫 발견  ');
    const third = chain.addNote(node.id, '세 번째');
    chain.addNote(node.id, '두 번째', first.id);
    assert.deepEqual(texts(node), ['첫 발견', '두 번째', '세 번째']);
    assert.equal(chain.addNote(node.id, '   '), null);
    assert.equal(chain.updateNote(node.id, third.id, '고친 내용').previousText, '세 번째');
    assert.equal(chain.removeNote(node.id, first.id).text, '첫 발견');
    assert.equal(chain.removeNote(node.id, first.id), null);

    const restored = PlanCollection.fromJSON(plans.serialize());
    const restoredNode = restored.chains[0].toArray()[0];
    assert.deepEqual(texts(restoredNode), ['두 번째', '고친 내용']);
    assert.equal(restored.getAllNodes('personal').length, 1);
});

test('legacy nodes gain empty notes and invalid note entries are dropped', () => {
    const data = { version: 3, deletedChains: [], chains: [{ id: 'c', head: 'a', category: 'work', nodes: [
        { id: 'a', text: '옛 계획', completed: true, next: 'b' },
        { id: 'b', text: '메모 있음', completed: false, next: null, notes: [
            { id: 'n1', text: '유지' }, { id: 'n1', text: '중복 id' }, { id: 'bad id', text: '잘못된 id' },
            { id: 'n2', text: '   ' }, { id: 'n3', text: 'x'.repeat(600) }, null] }
    ] }] };
    const [legacy, withNotes] = PlanCollection.fromJSON(JSON.stringify(data)).chains[0].toArray();
    assert.deepEqual(texts(legacy), []);
    assert.deepEqual(plain(withNotes.notes.map(note => note.id)), ['n1', 'n3']);
    assert.equal(withNotes.notes[1].text.length, 500);
});
