// Shared storage for the study page and the independent archive reader.
(() => {
    const KEY = 'learningRecords';
    const schema = window.TilRecordData;
    const canonical = value => JSON.stringify(value, function (key, item) {
        return item && !Array.isArray(item) && typeof item === 'object'
            ? Object.keys(item).sort().reduce((result, key) => { result[key] = item[key]; return result; }, {}) : item;
    });
    const same = (a, b) => a === b || canonical(a) === canonical(b);
    const clone = value => JSON.parse(JSON.stringify(value));
    function localDocument() {
        const raw = localStorage.getItem(KEY);
        return raw === null ? schema.empty() : schema.read(JSON.parse(raw));
    }
    function conflict() {
        const error = new Error('이 기록이 다른 화면에서 변경되었습니다. 작성 중인 내용을 복사해 둔 뒤 새로고침하고 다시 시도해 주세요.');
        error.name = 'TilConflictError';
        return error;
    }
    function create() {
        let document = null;
        let user = null;
        let busy = false;
        let generation = 0;
        async function load() {
            const request = ++generation;
            const result = await window.AppBackend.loadUserData('learning', localDocument());
            if (request !== generation) throw new Error('새로운 불러오기 요청이 있습니다.');
            document = schema.read(result.data);
            user = result.user;
            if (result.mode === 'cloud') localStorage.removeItem(KEY);
            return clone(document);
        }
        async function commit(changes) {
            if (!document || busy) throw new Error('기록을 불러오거나 저장하는 중입니다. 잠시 후 다시 시도해 주세요.');
            if (!changes.length) return clone(document);
            const expected = new Map(changes.map(change => [String(change.id), document.records.find(record => String(record.id) === String(change.id))]));
            const apply = raw => {
                const latest = schema.read(raw ?? schema.empty());
                for (const change of changes) {
                    const current = latest.records.find(record => String(record.id) === String(change.id));
                    if (!same(current, expected.get(String(change.id)))) throw conflict();
                }
                const ids = new Set(changes.map(change => String(change.id)));
                const records = [...changes.filter(change => change.value !== null).map(change => change.value),
                    ...latest.records.filter(record => !ids.has(String(record.id)))];
                return schema.write(records, latest);
            };
            busy = true;
            const request = generation;
            const owner = user;
            try {
                let saved;
                if (owner) {
                    saved = schema.read(await window.AppBackend.mutateUserData('learning', apply, { expectedUserId: owner.id }));
                } else {
                    const persist = () => {
                        const next = apply(localDocument());
                        localStorage.setItem(KEY, JSON.stringify(next));
                        return next;
                    };
                    saved = navigator.locks
                        ? await navigator.locks.request('til-library-save', persist) : persist();
                }
                if (request !== generation) throw new Error('로그인 상태 또는 기록이 다시 불러와졌습니다. 화면을 새로고침해 주세요.');
                document = saved;
                return clone(document);
            } finally { busy = false; }
        }
        return {
            load,
            get document() { return document ? clone(document) : null; },
            update(id, value) {
                if (value !== null && String(value.id) !== String(id)) throw new Error('기록 ID가 일치하지 않습니다.');
                return commit([{ id, value }]);
            },
            saveChanges(next, previous) {
                const previousById = new Map(previous.map(record => [String(record.id), record]));
                const nextIds = new Set(next.map(record => String(record.id)));
                const changes = next.filter(record => !same(record, previousById.get(String(record.id))))
                    .map(value => ({ id: value.id, value }));
                previous.filter(record => !nextIds.has(String(record.id)))
                    .forEach(record => changes.push({ id: record.id, value: null }));
                return commit(changes);
            }
        };
    }
    window.TilLibrary = { create };
})();
