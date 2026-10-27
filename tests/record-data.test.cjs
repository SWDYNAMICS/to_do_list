const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = { window: {} };
vm.runInNewContext(fs.readFileSync(`${__dirname}/../learning/record-data.js`, 'utf8'), context);
const data = context.window.TilRecordData;
const plain = value => JSON.parse(JSON.stringify(value));
const record = { id: 'a', title: '기록', date: '2026-10-25', content: '내용',
    richContent: { type: 'doc', content: [] }, review: { version: 2, outcome: 'correct', results: [true], dueAt: '2026-11-01T00:00:00Z' }, custom: { retained: true } };

test('legacy arrays and v1 documents migrate only location while preserving data and order', () => {
    for (const input of [[{ ...record, location: 'archive' }, { ...record, id: 'b' }],
        { version: 1, extra: 'preserved', records: [{ ...record, location: 'archive' }, { ...record, id: 'b' }] }]) {
        const original = JSON.stringify(input);
        const result = data.read(input);
        assert.equal(result.version, 3);
        assert.equal(result.records[0].location, 'bookcase');
        assert.equal(result.records[1].location, 'desk');
        assert.deepEqual(plain(result.records[0]), { ...record, location: 'bookcase' });
        assert.equal(JSON.stringify(input), original);
        assert.deepEqual(plain(data.read(result)), plain(result));
        if (!Array.isArray(input)) assert.equal(result.extra, 'preserved');
    }
});

test('v2 rejects archive; unknown schemas and locations are rejected', () => {
    for (const version of [2, 4, undefined]) {
        assert.throws(() => data.read({ version, records: [{ ...record, location: 'archive' }] }));
    }
    for (const location of ['typo', '', null, undefined]) {
        assert.throws(() => data.read({ version: 2, records: [{ ...record, location }] }));
    }
    assert.throws(() => data.read({ version: 1, records: [{ ...record, location: 'typo' }] }));
    assert.throws(() => data.read({ version: 1, records: [null] }));
});

test('v2 records retain location and all fields when upgrading to v3', () => {
    const source = { version: 2, metadata: 'keep', records: [
        { ...record, location: 'bookcase' }, { ...record, id: 'b', location: 'desk' }
    ] };
    const original = JSON.stringify(source);
    const result = data.read(source);
    assert.deepEqual(plain(result), { ...source, version: 3 });
    assert.equal(JSON.stringify(source), original);
});

test('v3 archive remains a separate location and survives repeated reads and writes', () => {
    const source = { version: 3, records: [{ ...record, location: 'archive', archivedAt: '2026-10-27T00:00:00Z' }] };
    assert.deepEqual(plain(data.read(source)), source);
    const result = data.write(data.read(source).records, source);
    assert.deepEqual(plain(result), source);
    assert.equal(data.LOCATION.ARCHIVE, 'archive');
});

test('new saves use v3 vocabulary and retain envelope metadata', () => {
    const result = data.write([{ ...record, location: data.LOCATION.BOOKCASE }], { version: 1, extra: 'keep' });
    assert.equal(result.version, 3);
    assert.equal(result.extra, 'keep');
    assert.equal(result.records[0].location, 'bookcase');
    assert.equal(data.write([{ ...record, location: 'archive' }]).records[0].location, 'archive');
    assert.throws(() => data.write([{ ...record, location: 'invalid' }]));
});
