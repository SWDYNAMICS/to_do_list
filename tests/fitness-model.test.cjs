const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');

// Every new timestamp is 1 ms later, so ordering never depends on how fast the test runs.
let tick = Date.parse('2026-11-20T00:00:00Z');
class TickingDate extends Date {
    constructor(...args) { super(...(args.length ? args : [tick += 1])); }
    static now() { return tick += 1; }
}
const context = { window: {}, crypto: { randomUUID }, Date: TickingDate };
vm.runInNewContext(fs.readFileSync(`${__dirname}/../plan/fitness-model.js`, 'utf8'), context);
const { FitnessLog } = context.window.FitnessModel;
const plain = value => JSON.parse(JSON.stringify(value));

test('sets are validated per kind, ordered, and flag records only when they beat earlier sets', () => {
    const log = FitnessLog.empty();
    const bench = log.addExercise(' 벤치프레스 ', 'weight').exercise;
    assert.equal(bench.name, '벤치프레스');
    assert.equal(log.addExercise('벤치프레스', 'reps').created, false);
    assert.equal(log.addExercise('   '), null);

    assert.equal(log.addSet(bench.id, '2026-11-18', { weight: 60, reps: 0 }), null);
    assert.equal(log.addSet(bench.id, '2026-11-18', { weight: '', reps: 5 }), null);
    assert.equal(log.addSet(bench.id, '2026-13-01', { weight: 60, reps: 5 }), null);
    assert.equal(log.addSet(bench.id, '2026-11-18', { weight: 60, reps: 10 }).record, false);
    assert.equal(log.addSet(bench.id, '2026-11-18', { weight: 60, reps: 8 }).record, false);
    assert.equal(log.addSet(bench.id, '2026-11-20', { weight: 60, reps: 11 }).record, true);
    assert.equal(log.addSet(bench.id, '2026-11-20', { weight: '62.5', reps: '5' }).record, true);
    assert.deepEqual(plain(log.best(bench.id)), plain({ ...log.lastSet(bench.id) }));
    assert.deepEqual(plain(log.sessions(bench.id).map(session => [session.date, session.sets.length])), [['2026-11-20', 2], ['2026-11-18', 2]]);
    assert.equal(FitnessLog.volume(log.setsFor(bench.id, '2026-11-18')), 1080);

    const run = log.addExercise('러닝', 'cardio').exercise;
    assert.equal(log.addSet(run.id, '2026-11-20', { minutes: '', km: '' }), null);
    assert.deepEqual(plain(log.addSet(run.id, '2026-11-20', { minutes: 30, km: '' }).set).km, 0);
    const pullup = log.addExercise('풀업', 'reps').exercise;
    assert.equal(log.addSet(pullup.id, '2026-11-19', { reps: 8, weight: 999 }).set.weight, undefined);
    assert.deepEqual(plain(log.orderedExercises().map(item => item.name)), ['러닝', '벤치프레스', '풀업']);

    const removed = log.removeExercise(bench.id);
    assert.equal(removed.removedSets, 4);
    assert.equal(log.sets.some(item => item.exerciseId === bench.id), false);
});

test('rows are edited in place and new rows start from the latest matching values', () => {
    const log = FitnessLog.empty();
    const squat = log.addExercise('스쿼트', 'weight').exercise;
    assert.deepEqual(plain(log.nextSetValues(squat.id, '2026-11-18')), { weight: 20, reps: 10 });

    const first = log.addSet(squat.id, '2026-11-18', log.nextSetValues(squat.id, '2026-11-18')).set;
    assert.equal(log.updateSet(first.id, { weight: '100' }).weight, 100);
    assert.equal(log.updateSet(first.id, { reps: '' }), null);
    assert.equal(log.updateSet(first.id, { weight: 1001 }), null);
    assert.equal(log.updateSet('missing', { weight: 50 }), null);
    assert.deepEqual(plain([first.weight, first.reps, first.date]), [100, 10, '2026-11-18']);
    log.addSet(squat.id, '2026-11-18', { weight: 80, reps: 8 });
    assert.deepEqual(plain(log.nextSetValues(squat.id, '2026-11-18')), { weight: 80, reps: 8 });

    // A new day opens with the nearest earlier session's first set, then repeats the day's last row.
    assert.deepEqual(plain(log.nextSetValues(squat.id, '2026-11-20')), { weight: 100, reps: 10 });
    assert.deepEqual(plain(log.nextSetValues(squat.id, '2026-11-01')), { weight: 100, reps: 10 });
    const today = log.addSet(squat.id, '2026-11-20', log.nextSetValues(squat.id, '2026-11-20')).set;
    log.updateSet(today.id, { reps: 12 });
    assert.deepEqual(plain(log.nextSetValues(squat.id, '2026-11-20')), { weight: 100, reps: 12 });
    assert.equal(log.previousSession(squat.id, '2026-11-20').date, '2026-11-18');
    assert.equal(log.previousSession(squat.id, '2026-11-18'), null);
    assert.equal(log.recordSetIds(squat.id).has(today.id), true);

    const run = log.addExercise('러닝', 'cardio').exercise;
    const lap = log.addSet(run.id, '2026-11-20', log.nextSetValues(run.id, '2026-11-20')).set;
    assert.deepEqual(plain([lap.minutes, lap.km]), [30, 0]);
    assert.equal(log.updateSet(lap.id, { minutes: '' }), null);
    assert.equal(log.updateSet(lap.id, { km: 5 }).km, 5);
    assert.equal(log.updateSet(lap.id, { minutes: '' }).minutes, 0);
});

test('saving from two devices merges their changes instead of overwriting', () => {
    const { mergeData } = context.window.FitnessModel;
    const start = FitnessLog.empty();
    const bench = start.addExercise('벤치프레스', 'weight').exercise;
    const kept = start.addSet(bench.id, '2026-11-19', { weight: 60, reps: 10 }).set;
    const edited = start.addSet(bench.id, '2026-11-19', { weight: 60, reps: 8 }).set;
    const removed = start.addSet(bench.id, '2026-11-19', { weight: 60, reps: 6 }).set;
    const base = plain(start.toData());

    // Phone: adds a set, edits one, deletes one, adds a squat, changes the goal.
    const phone = FitnessLog.fromData(plain(base));
    const phoneSet = phone.addSet(bench.id, '2026-11-20', { weight: 62.5, reps: 5 }).set;
    phone.updateSet(edited.id, { reps: 9 });
    phone.removeSet(removed.id);
    const phoneSquat = phone.addExercise('스쿼트', 'weight').exercise;
    phone.addSet(phoneSquat.id, '2026-11-20', { weight: 100, reps: 5 });
    phone.setProteinGoal(140);

    // Computer, meanwhile: adds its own set, protein, and also creates 스쿼트.
    const computer = FitnessLog.fromData(plain(base));
    const computerSet = computer.addSet(bench.id, '2026-11-20', { weight: 65, reps: 3 }).set;
    computer.addProtein('2026-11-20', 30, '닭가슴살');
    const computerSquat = computer.addExercise('스쿼트', 'weight').exercise;
    computer.addSet(computerSquat.id, '2026-11-20', { weight: 90, reps: 8 });

    const merged = FitnessLog.fromData(mergeData(base, phone.toData(), computer.toData()));
    assert.deepEqual(plain(merged.setsFor(bench.id).map(item => item.id)).sort(),
        [kept.id, edited.id, phoneSet.id, computerSet.id].sort());
    assert.equal(merged.sets.find(item => item.id === edited.id).reps, 9);
    assert.equal(merged.proteinTotal('2026-11-20'), 30);
    assert.equal(merged.proteinGoal, 140);
    assert.deepEqual(plain(merged.exercises.map(item => item.name)), ['벤치프레스', '스쿼트']);
    assert.deepEqual(plain(merged.setsFor(computerSquat.id).map(item => item.weight)).sort(), [100, 90]);

    // A deletion on the server wins over an edit here; nothing changed here keeps the server copy.
    const server = FitnessLog.fromData(plain(base));
    server.removeSet(edited.id);
    const after = FitnessLog.fromData(mergeData(base, phone.toData(), server.toData()));
    assert.equal(after.sets.some(item => item.id === edited.id), false);
    assert.deepEqual(plain(mergeData(base, base, server.toData())), plain(FitnessLog.fromData(server.toData()).toData()));
    assert.equal(FitnessLog.fromData(mergeData(null, phone.toData(), null)).sets.length, 4);
});

test('protein entries, goal and foods round-trip through the stored document', () => {
    const log = FitnessLog.empty();
    assert.equal(log.foods.length, 6);
    log.addProtein('2026-11-20', 23, '닭가슴살 100g');
    log.addProtein('2026-11-20', '12.35');
    log.addProtein('2026-11-19', 30);
    assert.equal(log.addProtein('2026-11-20', 0), null);
    assert.equal(log.proteinTotal('2026-11-20'), 35.4);
    assert.equal(log.setProteinGoal(0), null);
    assert.equal(log.setProteinGoal(130), 130);
    log.saveFood('닭가슴살 100g', 25);
    log.saveFood('연어 100g', 20);
    log.removeFood(log.foods.find(food => food.name === '계란 1개').id);

    const restored = FitnessLog.fromData(plain(log.toData()));
    assert.equal(restored.proteinGoal, 130);
    assert.equal(restored.proteinTotal('2026-11-20'), 35.4);
    assert.deepEqual(plain(restored.foods.map(food => [food.name, food.grams])).slice(-2), [['두부 반 모', 12], ['연어 100g', 20]]);
    assert.equal(restored.foods.find(food => food.name === '닭가슴살 100g').grams, 25);
    assert.equal(restored.foods.some(food => food.name === '계란 1개'), false);
    assert.equal(FitnessLog.fromData({ version: 1, protein: { foods: [] } }).foods.length, 0);
});

test('invalid stored data is dropped without losing valid records', () => {
    const restored = FitnessLog.fromData({
        version: 1,
        exercises: [{ id: 'a', name: '스쿼트', kind: 'weight' }, { id: 'a', name: '중복' }, { id: 'b', name: ' ', kind: 'reps' }, { id: 'c', name: '플랭크', kind: 'unknown' }],
        sets: [
            { id: 's1', exerciseId: 'a', date: '2026-11-20', weight: 100, reps: 5, at: '2026-11-20T10:00:00Z' },
            { id: 's2', exerciseId: 'missing', date: '2026-11-20', weight: 100, reps: 5 },
            { id: 's3', exerciseId: 'a', date: 'yesterday', weight: 100, reps: 5 },
            { id: 's4', exerciseId: 'a', date: '2026-11-20', weight: -5, reps: 5 }
        ],
        protein: { goal: 'lots', entries: [{ id: 'p1', date: '2026-11-20', grams: 20 }, { id: 'p2', date: '2026-11-20', grams: 9999 }] }
    });
    assert.deepEqual(plain(restored.exercises.map(item => [item.id, item.kind])), [['a', 'weight'], ['c', 'weight']]);
    assert.deepEqual(plain(restored.sets.map(item => item.id)), ['s1']);
    assert.equal(restored.proteinGoal, 100);
    assert.equal(restored.proteinTotal('2026-11-20'), 20);
    assert.equal(FitnessLog.fromData(null).exercises.length, 0);
});
