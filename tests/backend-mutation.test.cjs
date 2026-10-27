const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(`${__dirname}/../shared/backend.js`, 'utf8');
const plain = value => value == null ? value : JSON.parse(JSON.stringify(value));
const user = { id: 'user-a', email: 'a@example.test' };
const initialRow = () => ({ user_id: user.id, data_key: 'learning', updated_at: '2026-10-27T00:00:00.123456Z',
    data: { version: 3, records: [{ id: 'a', location: 'bookcase' }, { id: 'b', title: 'original' }] } });

function backend({ row = initialRow(), beforeWrite, failure, session = { user }, available = true } = {}) {
    const state = { row: plain(row), queries: [], writes: [], cache: new Map(), writeCount: 0 };
    const client = {
        auth: { getSession: async () => ({ data: { session }, error: null }),
            onAuthStateChange(callback) { state.changeSession = session => callback('SIGNED_IN', session); } },
        from(table) {
            assert.equal(table, 'user_app_data');
            const query = { action: 'read', filters: {}, values: null };
            const builder = {
                select(fields) { query.fields = fields; return builder; },
                eq(key, value) { query.filters[key] = value; return builder; },
                update(values) { query.action = 'update'; query.values = plain(values); return builder; },
                insert(values) { query.action = 'insert'; query.values = plain(values); return builder; },
                async maybeSingle() {
                    state.queries.push(plain(query));
                    if (failure?.action === query.action) return { data: null, error: failure.error };
                    if (query.action === 'read') return { data: plain(state.row), error: null };
                    state.writeCount++;
                    if (beforeWrite) beforeWrite(state, query);
                    if (query.action === 'insert') {
                        if (state.row) return { data: null, error: { code: '23505', message: 'duplicate key' } };
                        state.row = plain(query.values);
                    } else {
                        const matches = state.row && Object.entries(query.filters).every(([key, value]) => state.row[key] === value);
                        if (!matches) return { data: null, error: null };
                        state.row = { ...state.row, ...plain(query.values) };
                    }
                    state.writes.push(plain(state.row));
                    return { data: { data: plain(state.row.data) }, error: null };
                }
            };
            return builder;
        }
    };
    class FixedDate extends Date { static now() { return Date.parse(initialRow().updated_at); } }
    const window = {
        APP_SUPABASE_CONFIG: available ? { url: 'https://example.test', publishableKey: 'public' } : null,
        supabase: { createClient: () => client },
        dispatchEvent() {}
    };
    vm.runInNewContext(source, {
        window, Date: FixedDate, CustomEvent: class {}, console: { error() {} },
        localStorage: { getItem: key => state.cache.get(key) ?? null, setItem: (key, value) => state.cache.set(key, value) },
        document: { querySelectorAll: () => [] }
    });
    return { api: window.AppBackend, state };
}

const archiveFirst = data => ({ ...data, records: data.records.map(record => record.id === 'a' ? { ...record, location: 'archive' } : record) });
const cacheKey = `userAppCache.v1:${user.id}:learning`;

test('mutation confirms its write, scopes the CAS by owner/key/version, and advances even a microsecond timestamp', async () => {
    const { api, state } = backend();
    const saved = await api.mutateUserData('learning', archiveFirst);
    assert.equal(saved.records[0].location, 'archive');
    assert.equal(saved.records[1].title, 'original');
    assert.deepEqual(state.queries[1].filters, { user_id: user.id, data_key: 'learning', updated_at: initialRow().updated_at });
    assert.equal(state.row.updated_at, '2026-10-27T00:00:00.124Z');
    assert.deepEqual(JSON.parse(state.cache.get(cacheKey)), plain(saved));
});

test('a concurrent update is reread and the independent change survives the retried mutation', async () => {
    const { api, state } = backend({ beforeWrite(state) {
        if (state.writeCount !== 1) return;
        state.row.data.records[1].title = 'edited in the other page';
        state.row.updated_at = '2026-10-27T00:00:00.124Z';
    } });
    let mutations = 0;
    const saved = await api.mutateUserData('learning', data => { mutations++; return archiveFirst(data); });
    assert.equal(mutations, 2);
    assert.equal(saved.records[0].location, 'archive');
    assert.equal(saved.records[1].title, 'edited in the other page');
    assert.equal(state.writes.length, 1);
    assert.equal(state.row.updated_at, '2026-10-27T00:00:00.125Z');
    assert.deepEqual(JSON.parse(state.cache.get(cacheKey)), plain(saved));
});

test('a missing document can be inserted, and an insert race merges with the winning document', async () => {
    const fresh = backend({ row: null });
    const created = { version: 3, records: [{ id: 'new' }] };
    assert.deepEqual(plain(await fresh.api.mutateUserData('learning', latest => {
        assert.equal(latest, null);
        return created;
    })), created);
    assert.equal(fresh.state.queries[1].action, 'insert');

    const raced = backend({ row: null, beforeWrite(state) {
        if (state.writeCount === 1) state.row = initialRow();
    } });
    const saved = await raced.api.mutateUserData('learning', latest => ({
        version: 3, records: [...(latest?.records || []), { id: 'new' }]
    }));
    assert.deepEqual(plain(saved.records.map(record => record.id)), ['a', 'b', 'new']);
    assert.equal(raced.state.writes.length, 1);
    assert.deepEqual(raced.state.queries.map(query => query.action), ['read', 'insert', 'read', 'update']);
});

test('three conflicts reject without caching an uncommitted snapshot', async () => {
    const { api, state } = backend({ beforeWrite(state) {
        state.row.updated_at = new Date(Date.parse(state.row.updated_at) + 10).toISOString();
    } });
    state.cache.set(cacheKey, 'previous cache');
    await assert.rejects(api.mutateUserData('learning', archiveFirst), /다른 화면/);
    assert.equal(state.writeCount, 3);
    assert.equal(state.writes.length, 0);
    assert.equal(state.row.data.records[0].location, 'bookcase');
    assert.equal(state.cache.get(cacheKey), 'previous cache');
});

test('read/write errors and rejected changes retain the cache and never report success', async () => {
    for (const action of ['read', 'update', 'insert']) {
        const failure = { action, error: { code: 'offline', message: 'offline' } };
        const { api, state } = backend({ failure, row: action === 'insert' ? null : initialRow() });
        state.cache.set(cacheKey, 'previous cache');
        await assert.rejects(api.mutateUserData('learning', () => ({ version: 3, records: [] })), error => error === failure.error);
        assert.equal(state.writes.length, 0);
        assert.equal(state.cache.get(cacheKey), 'previous cache');
    }
    const { api, state } = backend();
    await assert.rejects(api.mutateUserData('learning', () => { throw new Error('record changed'); }), /record changed/);
    await assert.rejects(api.mutateUserData('learning', () => undefined), /데이터가 없습니다/);
    assert.equal(state.writeCount, 0);
    assert.equal(state.cache.size, 0);
});

test('signed-out and unavailable backends reject without a database write', async () => {
    const signedOut = backend({ session: null });
    await assert.rejects(signedOut.api.mutateUserData('learning', archiveFirst), /로그인/);
    assert.equal(signedOut.state.queries.length, 0);
    const unavailable = backend({ available: false });
    await assert.rejects(unavailable.api.mutateUserData('learning', archiveFirst), /연결/);
    assert.equal(unavailable.state.queries.length, 0);
});

test('an account mismatch or account switch during mutation prevents writing another user’s data', async () => {
    const mismatched = backend();
    await assert.rejects(mismatched.api.mutateUserData('learning', archiveFirst, { expectedUserId: 'different-user' }), /계정이 변경/);
    assert.equal(mismatched.state.queries.length, 0);
    assert.equal(mismatched.state.cache.size, 0);

    const switched = backend();
    await assert.rejects(switched.api.mutateUserData('learning', async data => {
        switched.state.changeSession({ user: { id: 'different-user' } });
        return archiveFirst(data);
    }, { expectedUserId: user.id }), /계정이 변경/);
    assert.equal(switched.state.writeCount, 0);
    assert.equal(switched.state.cache.size, 0);
});
