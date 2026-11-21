// Workout sets and protein intake. Independent from the linked plan data.
(function initializeFitnessModel() {
    const DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
    const NAME_MAX_LENGTH = 40;
    const DEFAULT_GOAL = 100;

    // Each kind decides which numbers a set records.
    const KINDS = Object.freeze({
        weight: Object.freeze({ label: '무게', hint: 'kg × 회' }),
        reps: Object.freeze({ label: '맨몸', hint: '회' }),
        cardio: Object.freeze({ label: '유산소', hint: '분 · km' })
    });

    const LIMITS = Object.freeze({
        weight: { min: 0, max: 1000, decimals: 2 },
        reps: { min: 1, max: 1000, decimals: 0 },
        minutes: { min: 0, max: 1440, decimals: 0 },
        km: { min: 0, max: 1000, decimals: 2 },
        grams: { min: 0.1, max: 500, decimals: 1 },
        goal: { min: 1, max: 500, decimals: 0 }
    });

    const SUGGESTED_EXERCISES = Object.freeze([
        ['벤치프레스', 'weight'], ['스쿼트', 'weight'], ['데드리프트', 'weight'],
        ['오버헤드프레스', 'weight'], ['바벨로우', 'weight'], ['랫풀다운', 'weight'],
        ['풀업', 'reps'], ['푸시업', 'reps'], ['러닝', 'cardio'], ['사이클', 'cardio']
    ].map(([name, kind]) => Object.freeze({ name, kind })));

    // Values for the very first row of an exercise with no history.
    const DEFAULT_SET_VALUES = Object.freeze({
        weight: Object.freeze({ weight: 20, reps: 10 }),
        reps: Object.freeze({ reps: 10 }),
        cardio: Object.freeze({ minutes: 30, km: 0 })
    });

    // Approximate protein per serving; users can edit or delete these.
    const DEFAULT_FOODS = Object.freeze([
        ['닭가슴살 100g', 23], ['계란 1개', 6], ['프로틴 1스쿱', 24],
        ['우유 200ml', 6], ['그릭요거트', 10], ['두부 반 모', 12]
    ].map(([name, grams]) => Object.freeze({ name, grams })));

    function createId() {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return crypto.randomUUID();
        }
        return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }

    const isValidId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
    const isDateKey = value => typeof value === 'string' && DATE_PATTERN.test(value);
    const normalizeName = value => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, NAME_MAX_LENGTH) : '';
    const normalizeTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value))
        ? new Date(value).toISOString() : null;

    // Returns null for missing or out-of-range numbers instead of silently clamping user input.
    function readNumber(value, { min, max, decimals }) {
        if (value === '' || value === null || value === undefined) return null;
        const number = Number(value);
        if (!Number.isFinite(number) || number < min || number > max) return null;
        const factor = 10 ** decimals;
        return Math.round(number * factor) / factor;
    }

    function readSetValues(kind, values = {}) {
        if (kind === 'weight') {
            const weight = readNumber(values.weight, LIMITS.weight);
            const reps = readNumber(values.reps, LIMITS.reps);
            return weight === null || reps === null ? null : { weight, reps };
        }
        if (kind === 'reps') {
            const reps = readNumber(values.reps, LIMITS.reps);
            return reps === null ? null : { reps };
        }
        // Cardio may record only time or only distance; a blank field means zero.
        const blank = value => value === '' || value === null || value === undefined;
        const minutes = blank(values.minutes) ? 0 : readNumber(values.minutes, LIMITS.minutes);
        const km = blank(values.km) ? 0 : readNumber(values.km, LIMITS.km);
        if (minutes === null || km === null || (minutes === 0 && km === 0)) return null;
        return { minutes, km };
    }

    // Weight: heavier wins, then more reps. Reps: more wins. Cardio: farther, then longer.
    function compareSets(kind, a, b) {
        if (kind === 'weight') return a.weight - b.weight || a.reps - b.reps;
        if (kind === 'reps') return a.reps - b.reps;
        return a.km - b.km || a.minutes - b.minutes;
    }

    const chronological = (a, b) => a.date.localeCompare(b.date) || a.at.localeCompare(b.at);
    const roundGrams = value => Math.round(value * 10) / 10;

    class FitnessLog {
        constructor({ exercises = [], sets = [], goal = DEFAULT_GOAL, foods = null, entries = [] } = {}) {
            this.exercises = exercises;
            this.sets = sets;
            this.proteinGoal = goal;
            this.foods = foods ?? DEFAULT_FOODS.map(food => ({ id: createId(), ...food }));
            this.proteinEntries = entries;
        }

        static empty() {
            return new FitnessLog();
        }

        static fromData(data) {
            if (!data || typeof data !== 'object') return FitnessLog.empty();
            const unique = () => {
                const seen = new Set();
                return item => item && isValidId(item.id) && !seen.has(item.id) && seen.add(item.id);
            };

            const exercises = (Array.isArray(data.exercises) ? data.exercises : [])
                .filter(unique())
                .map(item => ({
                    id: item.id,
                    name: normalizeName(item.name),
                    kind: Object.hasOwn(KINDS, item.kind) ? item.kind : 'weight',
                    createdAt: normalizeTime(item.createdAt) || new Date(0).toISOString()
                }))
                .filter(item => item.name);
            const kinds = new Map(exercises.map(item => [item.id, item.kind]));

            const sets = (Array.isArray(data.sets) ? data.sets : [])
                .filter(unique())
                .filter(item => kinds.has(item.exerciseId) && isDateKey(item.date))
                .map(item => {
                    const values = readSetValues(kinds.get(item.exerciseId), item);
                    return values && {
                        id: item.id,
                        exerciseId: item.exerciseId,
                        date: item.date,
                        ...values,
                        at: normalizeTime(item.at) || `${item.date}T00:00:00.000Z`
                    };
                })
                .filter(Boolean);

            const protein = data.protein && typeof data.protein === 'object' ? data.protein : {};
            const entries = (Array.isArray(protein.entries) ? protein.entries : [])
                .filter(unique())
                .filter(item => isDateKey(item.date))
                .map(item => ({
                    id: item.id,
                    date: item.date,
                    grams: readNumber(item.grams, LIMITS.grams),
                    label: normalizeName(item.label),
                    at: normalizeTime(item.at) || `${item.date}T00:00:00.000Z`
                }))
                .filter(item => item.grams !== null);
            // A missing food list means the defaults were never seeded; an empty list is a user choice.
            const foods = Array.isArray(protein.foods)
                ? protein.foods.filter(unique())
                    .map(item => ({ id: item.id, name: normalizeName(item.name), grams: readNumber(item.grams, LIMITS.grams) }))
                    .filter(item => item.name && item.grams !== null)
                : null;

            return new FitnessLog({
                exercises,
                sets,
                goal: readNumber(protein.goal, LIMITS.goal) ?? DEFAULT_GOAL,
                foods,
                entries
            });
        }

        toData() {
            return {
                version: 1,
                exercises: this.exercises,
                sets: this.sets,
                protein: { goal: this.proteinGoal, foods: this.foods, entries: this.proteinEntries }
            };
        }

        findExercise(exerciseId) {
            return this.exercises.find(item => item.id === exerciseId) || null;
        }

        findExerciseByName(name) {
            const key = normalizeName(name).toLocaleLowerCase('ko-KR');
            return this.exercises.find(item => item.name.toLocaleLowerCase('ko-KR') === key) || null;
        }

        // Adding an existing name returns that exercise instead of creating a duplicate.
        addExercise(name, kind = 'weight') {
            const cleanName = normalizeName(name);
            if (!cleanName || !Object.hasOwn(KINDS, kind)) return null;
            const existing = this.findExerciseByName(cleanName);
            if (existing) return { exercise: existing, created: false };
            const exercise = { id: createId(), name: cleanName, kind, createdAt: new Date().toISOString() };
            this.exercises.push(exercise);
            return { exercise, created: true };
        }

        renameExercise(exerciseId, name) {
            const exercise = this.findExercise(exerciseId);
            const cleanName = normalizeName(name);
            if (!exercise || !cleanName) return null;
            const duplicate = this.findExerciseByName(cleanName);
            if (duplicate && duplicate.id !== exerciseId) return null;
            exercise.name = cleanName;
            return exercise;
        }

        removeExercise(exerciseId) {
            const index = this.exercises.findIndex(item => item.id === exerciseId);
            if (index < 0) return null;
            const removedSets = this.sets.filter(item => item.exerciseId === exerciseId).length;
            this.sets = this.sets.filter(item => item.exerciseId !== exerciseId);
            return { exercise: this.exercises.splice(index, 1)[0], removedSets };
        }

        // Most recently used first, so today's exercises stay within reach.
        orderedExercises() {
            const lastUsed = new Map();
            this.sets.forEach(item => {
                const key = `${item.date}${item.at}`;
                if ((lastUsed.get(item.exerciseId) || '') < key) lastUsed.set(item.exerciseId, key);
            });
            return [...this.exercises].sort((a, b) =>
                (lastUsed.get(b.id) || '').localeCompare(lastUsed.get(a.id) || '')
                || a.createdAt.localeCompare(b.createdAt));
        }

        addSet(exerciseId, date, values) {
            const exercise = this.findExercise(exerciseId);
            const clean = exercise && isDateKey(date) ? readSetValues(exercise.kind, values) : null;
            if (!clean) return null;
            const set = { id: createId(), exerciseId, date, ...clean, at: new Date().toISOString() };
            this.sets.push(set);
            return { set, record: this.recordSetIds(exerciseId).has(set.id) };
        }

        // Edits keep the set's day and position; invalid values leave it unchanged.
        updateSet(setId, values) {
            const set = this.sets.find(item => item.id === setId);
            const exercise = set && this.findExercise(set.exerciseId);
            const clean = exercise ? readSetValues(exercise.kind, { ...set, ...values }) : null;
            if (!clean) return null;
            Object.assign(set, clean);
            return set;
        }

        // A new row repeats the day's last set, else opens with the nearest session's first set.
        nextSetValues(exerciseId, date) {
            const exercise = this.findExercise(exerciseId);
            if (!exercise) return null;
            const sameDay = this.setsFor(exerciseId, date);
            const sessions = this.sessions(exerciseId);
            const nearest = sessions.find(session => session.date < date) || sessions[sessions.length - 1];
            const source = sameDay[sameDay.length - 1] || nearest?.sets[0];
            return source ? readSetValues(exercise.kind, source) : { ...DEFAULT_SET_VALUES[exercise.kind] };
        }

        // The latest session before the given day, used for the "previous" column.
        previousSession(exerciseId, date) {
            return this.sessions(exerciseId).find(session => session.date < date) || null;
        }

        removeSet(setId) {
            const index = this.sets.findIndex(item => item.id === setId);
            return index < 0 ? null : this.sets.splice(index, 1)[0];
        }

        setsFor(exerciseId, date = null) {
            return this.sets
                .filter(item => item.exerciseId === exerciseId && (!date || item.date === date))
                .sort(chronological);
        }

        setsOnDate(date) {
            return this.sets.filter(item => item.date === date).sort(chronological);
        }

        lastSet(exerciseId) {
            const sets = this.setsFor(exerciseId);
            return sets[sets.length - 1] || null;
        }

        // Sessions grouped by day, newest first.
        sessions(exerciseId) {
            const byDate = new Map();
            this.setsFor(exerciseId).forEach(item => {
                if (!byDate.has(item.date)) byDate.set(item.date, []);
                byDate.get(item.date).push(item);
            });
            return [...byDate].map(([date, sets]) => ({ date, sets })).reverse();
        }

        best(exerciseId) {
            const exercise = this.findExercise(exerciseId);
            if (!exercise) return null;
            return this.setsFor(exerciseId).reduce((best, item) =>
                !best || compareSets(exercise.kind, item, best) > 0 ? item : best, null);
        }

        // A set is a record when it beats every earlier set; the very first set is not.
        recordSetIds(exerciseId) {
            const exercise = this.findExercise(exerciseId);
            const records = new Set();
            if (!exercise) return records;
            let best = null;
            this.setsFor(exerciseId).forEach(item => {
                if (best && compareSets(exercise.kind, item, best) > 0) records.add(item.id);
                if (!best || compareSets(exercise.kind, item, best) > 0) best = item;
            });
            return records;
        }

        static volume(sets) {
            return sets.reduce((total, item) => total + (item.weight ?? 0) * (item.reps ?? 0), 0);
        }

        addProtein(date, grams, label = '') {
            const clean = readNumber(grams, LIMITS.grams);
            if (!isDateKey(date) || clean === null) return null;
            const entry = { id: createId(), date, grams: clean, label: normalizeName(label), at: new Date().toISOString() };
            this.proteinEntries.push(entry);
            return entry;
        }

        removeProtein(entryId) {
            const index = this.proteinEntries.findIndex(item => item.id === entryId);
            return index < 0 ? null : this.proteinEntries.splice(index, 1)[0];
        }

        proteinOn(date) {
            return this.proteinEntries.filter(item => item.date === date).sort(chronological);
        }

        proteinTotal(date) {
            return roundGrams(this.proteinOn(date).reduce((total, item) => total + item.grams, 0));
        }

        setProteinGoal(grams) {
            const goal = readNumber(grams, LIMITS.goal);
            if (goal === null) return null;
            this.proteinGoal = goal;
            return goal;
        }

        // Saving a food with an existing name updates its amount.
        saveFood(name, grams) {
            const cleanName = normalizeName(name);
            const clean = readNumber(grams, LIMITS.grams);
            if (!cleanName || clean === null) return null;
            const existing = this.foods.find(item => item.name === cleanName);
            if (existing) {
                existing.grams = clean;
                return existing;
            }
            const food = { id: createId(), name: cleanName, grams: clean };
            this.foods.push(food);
            return food;
        }

        removeFood(foodId) {
            const index = this.foods.findIndex(item => item.id === foodId);
            return index < 0 ? null : this.foods.splice(index, 1)[0];
        }
    }

    const EMPTY_DATA = Object.freeze({ version: 1, exercises: [], sets: [], protein: { goal: DEFAULT_GOAL, foods: [], entries: [] } });
    const readData = data => FitnessLog.fromData(data && typeof data === 'object' ? data : EMPTY_DATA).toData();

    // Items added, edited or deleted locally since `base` are replayed onto `remote`;
    // everything else follows `remote`. A remote deletion wins over a local edit.
    function mergeList(base, local, remote) {
        const baseItems = new Map(base.map(item => [item.id, JSON.stringify(item)]));
        const localItems = new Map(local.map(item => [item.id, item]));
        const merged = remote
            .filter(item => !(baseItems.has(item.id) && !localItems.has(item.id)))
            .map(item => {
                const mine = localItems.get(item.id);
                return mine && baseItems.has(item.id) && baseItems.get(item.id) !== JSON.stringify(mine) ? mine : item;
            });
        const ids = new Set(merged.map(item => item.id));
        local.forEach(item => {
            if (!baseItems.has(item.id) && !ids.has(item.id)) merged.push(item);
        });
        return merged;
    }

    // Combines the changes made on this device with a newer server copy, so a phone and
    // a computer saving in turn never erase each other's records.
    function mergeData(base, local, remote) {
        const [b, l, r] = [readData(base), readData(local), readData(remote ?? base)];
        let exercises = mergeList(b.exercises, l.exercises, r.exercises);
        let sets = mergeList(b.sets, l.sets, r.sets);

        // The same exercise created on two devices becomes one; the first (server) copy keeps its id.
        const byName = new Map();
        const renamed = new Map();
        exercises = exercises.filter(item => {
            const key = item.name.toLocaleLowerCase('ko-KR');
            if (!byName.has(key)) {
                byName.set(key, item.id);
                return true;
            }
            renamed.set(item.id, byName.get(key));
            return false;
        });
        sets = sets.map(item => renamed.has(item.exerciseId) ? { ...item, exerciseId: renamed.get(item.exerciseId) } : item);

        const foodNames = new Set();
        const foods = mergeList(b.protein.foods, l.protein.foods, r.protein.foods)
            .filter(item => !foodNames.has(item.name) && foodNames.add(item.name));

        return readData({
            version: 1,
            exercises,
            sets,
            protein: {
                goal: l.protein.goal !== b.protein.goal ? l.protein.goal : r.protein.goal,
                foods,
                entries: mergeList(b.protein.entries, l.protein.entries, r.protein.entries)
            }
        });
    }

    window.FitnessModel = Object.freeze({
        mergeData,
        KINDS,
        LIMITS,
        NAME_MAX_LENGTH,
        SUGGESTED_EXERCISES,
        FitnessLog
    });
})();
