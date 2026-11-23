// Workout and protein log. Sets are entered in one form and shown, grouped by exercise, in the day's log below it.
(function initializeFitness() {
    const app = window.PlanApp;
    const { dom, state, announce } = app;
    const { KINDS, LIMITS, NAME_MAX_LENGTH, SUGGESTED_EXERCISES, FitnessLog, mergeData } = window.FitnessModel;

    const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
    const FIELDS = {
        weight: [{ key: 'weight', label: '무게', unit: 'kg' }, { key: 'reps', label: '횟수', unit: '회' }],
        reps: [{ key: 'reps', label: '횟수', unit: '회' }],
        cardio: [{ key: 'minutes', label: '시간', unit: '분' }, { key: 'km', label: '거리', unit: 'km' }]
    };
    const SET_ERRORS = {
        weight: '무게(0 이상)와 횟수(1회 이상)를 확인해 주세요.',
        reps: '횟수를 1회 이상 입력해 주세요.',
        cardio: '시간이나 거리 중 하나는 입력해 주세요.'
    };
    const ICONS = {
        minus: 'M5 12h14',
        plus: 'M12 5v14M5 12h14',
        edit: 'M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4',
        delete: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
        prev: 'M15 6l-6 6 6 6',
        next: 'M9 6l6 6-6 6'
    };

    const ui = {
        loaded: false,
        date: null, // null follows today, even across midnight
        exerciseId: null,
        addingExercise: false,
        renaming: false,
        showHistory: false,
        editingSetId: null, // a set from the log loaded into the form
        draft: null, // the form's values, kept between records so the same set is one tap
        editingGoal: false,
        editingFoods: false,
        pane: 'workout', // on phones only one of the two cards shows; the other is a swipe away
        renderPending: false,
        flashId: null
    };

    // --- Dates are local calendar days stored as YYYY-MM-DD. ---
    const pad = value => String(value).padStart(2, '0');
    const toKey = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    const fromKey = key => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); };
    const shiftKey = (key, days) => { const date = fromKey(key); date.setDate(date.getDate() + days); return toKey(date); };
    const todayKey = () => toKey(new Date());
    const currentDate = () => ui.date || todayKey();
    const formatDate = key => { const d = fromKey(key); return `${d.getMonth() + 1}월 ${d.getDate()}일 ${WEEKDAYS[d.getDay()]}요일`; };
    const shortDate = key => { const d = fromKey(key); return `${d.getMonth() + 1}/${d.getDate()}`; };
    function relativeLabel(key) {
        const days = Math.round((fromKey(todayKey()) - fromKey(key)) / 86400000);
        return days === 0 ? '오늘' : days === 1 ? '어제' : `${days}일 전`;
    }

    const fmt = value => Number(value).toLocaleString('ko-KR', { maximumFractionDigits: 2 });
    function formatSet(set) {
        if (set.weight !== undefined) return `${fmt(set.weight)}kg × ${set.reps}회`;
        if (set.reps !== undefined) return `${set.reps}회`;
        return [set.minutes ? `${fmt(set.minutes)}분` : '', set.km ? `${fmt(set.km)}km` : ''].filter(Boolean).join(' · ');
    }
    const formatTime = iso => { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

    // --- Small DOM helpers. ---
    function h(tag, props = {}, ...children) {
        const element = document.createElement(tag);
        Object.entries(props).forEach(([key, value]) => {
            if (value === null || value === undefined || value === false) return;
            if (key === 'class') element.className = value;
            else if (key === 'text') element.textContent = value;
            else if (key === 'for') element.htmlFor = value;
            else if (key === 'style') element.style.cssText = value;
            else if (key.startsWith('on')) element.addEventListener(key.slice(2), value);
            else if (key.startsWith('aria-') || key.startsWith('data-') || key === 'role') element.setAttribute(key, value);
            else if (key in element) element[key] = value;
            else element.setAttribute(key, value);
        });
        element.append(...children.flat().filter(child => child !== null && child !== undefined && child !== false));
        return element;
    }

    function icon(name) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('focusable', 'false');
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', ICONS[name]);
        svg.append(path);
        return svg;
    }

    function iconButton(name, label, onclick, props = {}) {
        return h('button', { type: 'button', ...props, class: `fitness-icon-button ${props.class || ''}`.trim(),
            'aria-label': label, title: label, onclick }, icon(name));
    }

    // --- Phones: the workout and diet cards sit side by side and are swiped between. ---
    // The cards form a horizontal scroll-snap strip, so the page follows the finger natively.
    // Once it settles, the strip is only as tall as the card shown and the other card is inert.
    const PANES = [
        { key: 'workout', label: '운동' },
        { key: 'protein', label: '식단' }
    ];
    const stacked = window.matchMedia('(max-width: 900px)');
    const paneIndex = key => Math.max(0, PANES.findIndex(pane => pane.key === key));
    const clampPane = value => Math.min(PANES.length - 1, Math.max(0, value));
    const motion = () => (window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');
    let panesMoving = false;
    let panesTouched = false;
    let panesAutoScrolling = false; // moving because the switch was pressed, not a swipe
    let settleTimer = null;
    const paneObserver = 'ResizeObserver' in window ? new ResizeObserver(() => { if (!panesMoving) layoutPanes(); }) : null;

    // The switch's underline follows the strip as it moves; `pressed` is the card it lands on.
    function markPaneSwitch(position, pressed) {
        const switcher = document.getElementById('fitnessSwitch');
        if (!switcher) return;
        switcher.style.setProperty('--pane-progress', position.toFixed(3));
        switcher.querySelectorAll('.fitness-switch-button').forEach((button, index) =>
            button.setAttribute('aria-pressed', String(index === pressed)));
    }

    function layoutPanes({ align = true } = {}) {
        const panes = document.getElementById('fitnessPanes');
        if (!panes) return;
        const index = paneIndex(ui.pane);
        const items = [...panes.children];
        const isStacked = stacked.matches;
        items.forEach((item, i) => { item.inert = isStacked && i !== index; });
        markPaneSwitch(index, index);
        if (!isStacked) {
            panes.style.removeProperty('--pane-height');
            return;
        }
        panes.style.setProperty('--pane-height', `${items[index].offsetHeight}px`);
        const left = index * panes.clientWidth;
        if (align && Math.abs(panes.scrollLeft - left) > 1) panes.scrollLeft = left;
        if (panes.scrollTop) panes.scrollTop = 0;
    }

    function settlePanes(panes) {
        window.clearTimeout(settleTimer);
        settleTimer = null;
        if (!panesMoving) return;
        const width = panes.clientWidth;
        const position = width ? panes.scrollLeft / width : 0;
        const index = clampPane(Math.round(position));
        if (panes.isConnected && Math.abs(position - index) > 0.01) {
            // A finger resting between the cards: the snap finishes the move once it lifts.
            if (!panesTouched) panes.scrollTo({ left: index * width, behavior: motion() });
            settleTimer = window.setTimeout(() => settlePanes(panes), 150);
            return;
        }
        panesMoving = false;
        panesAutoScrolling = false;
        panes.classList.remove('is-moving');
        if (!panes.isConnected) return;
        ui.pane = PANES[index].key;
        layoutPanes({ align: false });
        flushPendingRender();
    }

    function onPanesScroll(event) {
        const panes = event.currentTarget;
        const width = panes.clientWidth;
        if (!stacked.matches || !width) return;
        const position = clampPane(panes.scrollLeft / width);
        if (!panesMoving && Math.abs(position - paneIndex(ui.pane)) < 0.01) return;
        if (!panesMoving) {
            panesMoving = true;
            // While moving, the strip is as tall as the taller card so neither is cut off mid-swipe.
            panes.classList.add('is-moving');
        }
        markPaneSwitch(position, panesAutoScrolling ? paneIndex(ui.pane) : Math.round(position));
        window.clearTimeout(settleTimer);
        settleTimer = window.setTimeout(() => settlePanes(panes), 150);
    }

    function setupPanes() {
        const panes = document.getElementById('fitnessPanes');
        window.clearTimeout(settleTimer);
        settleTimer = null;
        panesMoving = false;
        panesAutoScrolling = false;
        panes.addEventListener('scroll', onPanesScroll, { passive: true });
        panes.addEventListener('scrollend', () => settlePanes(panes));
        panes.addEventListener('touchstart', () => { panesTouched = true; panesAutoScrolling = false; }, { passive: true });
        ['touchend', 'touchcancel'].forEach(type => panes.addEventListener(type, event => {
            panesTouched = event.touches.length > 0;
        }, { passive: true }));
        paneObserver?.disconnect();
        [...panes.children].forEach(pane => paneObserver?.observe(pane));
        layoutPanes();
    }

    function showPane(key) {
        const panes = document.getElementById('fitnessPanes');
        if (!panes) return;
        ui.pane = key;
        const left = paneIndex(key) * panes.clientWidth;
        if (!stacked.matches || Math.abs(panes.scrollLeft - left) <= 1) {
            layoutPanes();
            return;
        }
        panesAutoScrolling = true;
        markPaneSwitch(panes.scrollLeft / panes.clientWidth, paneIndex(key));
        panes.scrollTo({ left, behavior: motion() });
    }

    stacked.addEventListener?.('change', () => layoutPanes());

    function renderPaneSwitch(date) {
        const meta = {
            workout: `${state.fitness.setsOnDate(date).length}세트`,
            protein: `${fmt(state.fitness.proteinTotal(date))}/${state.fitness.proteinGoal}g`
        };
        const current = paneIndex(ui.pane);
        return h('div', { id: 'fitnessSwitch', class: 'fitness-switch', role: 'group', 'aria-label': '운동과 식단 전환',
            style: `--pane-progress: ${current}` },
        PANES.map((pane, index) => h('button', {
            type: 'button',
            id: `fitnessSwitch-${pane.key}`,
            class: 'fitness-switch-button',
            'aria-pressed': String(index === current),
            'aria-controls': `fitnessPane-${pane.key}`,
            onclick: () => showPane(pane.key)
        },
        h('span', { class: 'fitness-switch-label', text: pane.label }),
        h('span', { class: 'fitness-switch-meta', text: meta[pane.key] }))),
        h('span', { class: 'fitness-switch-indicator', 'aria-hidden': 'true' }));
    }

    // --- Saving ---
    // Logged out, the whole log is written to this browser. Logged in, only the changes made on
    // this device since the last sync are applied to the newest server copy (FitnessModel.mergeData),
    // so a phone and a computer never erase each other's records. Saves run one at a time.
    const sync = { state: 'idle', savedAt: null, dirty: false };
    let saving = null;
    let saveAgain = false;
    let editTimer = null;
    let retryTimer = null;
    let retryDelay = 4000;

    const clone = data => JSON.parse(JSON.stringify(data));

    // Until the server confirms a save, the unsaved changes also live in this browser, so they
    // survive the phone closing the page mid-request and are sent on the next visit.
    const pendingKey = () => `fitnessPending.v1:${state.cloudUser.id}`;
    function keepPending() {
        if (!state.cloudUser) return;
        try {
            localStorage.setItem(pendingKey(), JSON.stringify({ base: state.fitnessBase, local: state.fitness.toData() }));
        } catch (error) {
            console.error('저장 대기 중인 운동 기록을 보관하지 못했습니다.', error);
        }
    }
    function readPending() {
        try {
            const pending = JSON.parse(localStorage.getItem(pendingKey()) || 'null');
            return pending && pending.local ? pending : null;
        } catch {
            return null;
        }
    }
    function clearPending() {
        try { localStorage.removeItem(pendingKey()); } catch { /* nothing to clear */ }
    }

    function persist() {
        window.clearTimeout(editTimer);
        editTimer = null;
        window.clearTimeout(retryTimer);
        retryTimer = null;
        sync.dirty = true;
        keepPending();
        if (saving) {
            saveAgain = true;
            return saving;
        }
        saving = (async () => {
            do {
                saveAgain = false;
                await saveOnce();
            } while (saveAgain);
            saving = null;
        })();
        return saving;
    }

    // Typing saves after a short pause; leaving the field or the page saves at once.
    function persistSoon() {
        sync.dirty = true;
        keepPending();
        window.clearTimeout(editTimer);
        editTimer = window.setTimeout(persist, 500);
    }

    async function saveOnce() {
        if (!state.cloudUser) {
            const saved = window.PlanStorage.saveFitness(state.fitness);
            if (saved && !saveAgain && !editTimer) sync.dirty = false;
            setSyncState(saved ? 'saved' : 'error');
            if (!saved) announce('브라우저 저장 공간에 운동 기록을 저장하지 못했습니다.');
            return;
        }
        const snapshot = clone(state.fitness.toData());
        const base = state.fitnessBase;
        setSyncState('saving');
        try {
            const saved = await window.AppBackend.mutateUserData('fitness',
                remote => mergeData(base, snapshot, remote ?? base),
                { expectedUserId: state.cloudUser.id });
            state.fitnessBase = clone(saved);
            // Keep anything typed while the request was in flight on top of the merged copy.
            applyLog(mergeData(snapshot, state.fitness.toData(), saved));
            if (!saveAgain && !editTimer) {
                sync.dirty = false;
                clearPending();
            } else {
                keepPending();
            }
            retryDelay = 4000;
            setSyncState('saved');
        } catch (error) {
            console.error('운동 기록을 서버에 저장하지 못했습니다.', error);
            setSyncState('error');
            scheduleRetry();
        }
    }

    // A failed save (weak signal at the gym, app switched away) is retried until it succeeds.
    function scheduleRetry() {
        if (retryTimer) return;
        retryTimer = window.setTimeout(() => {
            retryTimer = null;
            if (sync.dirty && navigator.onLine !== false) persist();
            else if (sync.dirty) scheduleRetry();
        }, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 60000);
    }

    // Replaces the shown log; the screen is redrawn later if the user is typing in it.
    function applyLog(data) {
        const next = FitnessLog.fromData(data);
        const changed = JSON.stringify(next.toData()) !== JSON.stringify(state.fitness.toData());
        state.fitness = next;
        if (changed) renderWhenIdle();
    }

    function isTypingInPanel() {
        const active = document.activeElement;
        return Boolean(active && dom.fitnessPanel.contains(active) && active.matches('input, textarea'));
    }

    // Redraws caused by a save or a refresh wait while someone types in the panel or presses a
    // button in it: redrawing then would drop the value being typed or swallow the click.
    let pointerDown = false;
    function flushPendingRender() {
        if (!ui.renderPending || pointerDown || panesMoving || isTypingInPanel()) return;
        const active = document.activeElement;
        render({ id: active && dom.fitnessPanel.contains(active) ? active.id : null });
    }

    function renderWhenIdle() {
        ui.renderPending = true;
        updateTabCount();
        // Focus is still moving while change and blur events run, so look again once it has settled.
        window.setTimeout(flushPendingRender, 0);
    }

    dom.fitnessPanel.addEventListener('pointerdown', () => { pointerDown = true; }, true);
    ['pointerup', 'pointercancel'].forEach(type => window.addEventListener(type, () => {
        if (!pointerDown) return;
        pointerDown = false;
        // The click that follows usually redraws by itself; this covers presses that do not.
        window.setTimeout(flushPendingRender, 300);
    }, true));
    dom.fitnessPanel.addEventListener('focusout', () => window.setTimeout(flushPendingRender, 0));

    // A phone tab can sit in the background for days; show the newest records when it returns.
    let refreshing = false;
    async function refresh() {
        if (!state.cloudUser || !ui.loaded || refreshing || document.hidden) return;
        if (sync.dirty || saving || editTimer) {
            persist();
            return;
        }
        refreshing = true;
        try {
            const result = await window.AppBackend.loadUserData('fitness', state.fitnessBase);
            if (result.mode !== 'cloud' || sync.dirty || saving || editTimer) return;
            state.fitnessBase = clone(result.data);
            applyLog(result.data);
            setSyncState('saved');
        } finally {
            refreshing = false;
        }
    }

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            // Mobile browsers rarely fire pagehide when switching apps, so save while still allowed.
            if (sync.dirty || editTimer) persist();
        } else {
            refresh();
        }
    });
    window.addEventListener('pagehide', () => { if (sync.dirty || editTimer) persist(); });
    window.addEventListener('pageshow', event => { if (event.persisted) refresh(); });
    window.addEventListener('online', () => { if (sync.dirty) persist(); });

    function syncText() {
        if (sync.state === 'saving') return '저장 중…';
        if (sync.state === 'error') return state.cloudUser ? '저장하지 못했어요 · 자동으로 다시 시도합니다' : '이 브라우저에 저장하지 못했어요';
        if (sync.dirty) return '저장 대기 중…';
        const where = state.cloudUser ? '서버에 저장됨' : '이 브라우저에 저장됨';
        return sync.savedAt ? `${where} · ${formatTime(sync.savedAt)}` : (state.cloudUser ? '서버와 동기화됨' : '이 브라우저에 저장됨');
    }

    function renderSync() {
        return h('div', { id: 'fitnessSync', class: 'fitness-sync', 'data-state': sync.state, role: 'status' },
            h('span', { class: 'fitness-sync-dot', 'aria-hidden': 'true' }),
            h('span', { class: 'fitness-sync-text', text: syncText() }),
            sync.state === 'error' ? h('button', { type: 'button', class: 'fitness-sync-retry', text: '지금 다시 시도', onclick: () => persist() }) : null);
    }

    function setSyncState(next) {
        sync.state = next;
        if (next === 'saved') sync.savedAt = new Date().toISOString();
        document.getElementById('fitnessSync')?.replaceWith(renderSync());
    }

    function render(focus = {}) {
        ui.renderPending = false;
        updateTabCount();
        if (!state.fitnessActive) return;
        if (!ui.loaded) {
            dom.fitnessPanel.replaceChildren(h('p', { class: 'fitness-loading', text: '운동 기록을 불러오는 중…' }));
            return;
        }
        const date = currentDate();
        dom.fitnessPanel.replaceChildren(
            renderDayBar(date),
            renderSync(),
            renderWeek(date),
            renderPaneSwitch(date),
            h('div', { id: 'fitnessPanes', class: 'fitness-panes' },
                h('div', { id: 'fitnessPane-workout', class: 'fitness-pane' }, renderWorkout(date)),
                h('div', { id: 'fitnessPane-protein', class: 'fitness-pane' }, renderProtein(date)))
        );
        setupPanes();
        ui.flashId = null;
        if (focus.id) {
            window.requestAnimationFrame(() => {
                // On a slow phone the frame can come late; never pull focus from a field chosen since.
                const active = document.activeElement;
                if (active && active !== document.body && document.contains(active)) return;
                const target = document.getElementById(focus.id);
                target?.focus({ preventScroll: true });
                if (focus.select) target?.select?.();
            });
        }
    }

    function updateTabCount() {
        if (dom.fitnessTabCount) dom.fitnessTabCount.textContent = String(state.fitness.setsOnDate(todayKey()).length);
    }

    function setDate(key, focusId) {
        ui.date = key === todayKey() ? null : key;
        ui.renaming = false;
        ui.editingSetId = null;
        ui.draft = null;
        render({ id: focusId });
        announce(`${formatDate(key)} 기록을 표시합니다.`);
    }

    function renderDayBar(date) {
        const today = todayKey();
        return h('div', { class: 'fitness-daybar' },
            iconButton('prev', '이전 날', () => setDate(shiftKey(date, -1), 'fitnessPrevDay'), { id: 'fitnessPrevDay' }),
            h('div', { class: 'fitness-date', 'aria-live': 'polite' },
                h('strong', { text: formatDate(date) }),
                h('span', { text: relativeLabel(date) })),
            iconButton('next', '다음 날', () => setDate(shiftKey(date, 1), 'fitnessNextDay'), { id: 'fitnessNextDay', disabled: date >= today }),
            date !== today
                ? h('button', { type: 'button', class: 'fitness-today-button', text: '오늘로', onclick: () => setDate(today, 'fitnessPrevDay') })
                : null);
    }

    // Monday-first week around the shown day: a dot for workouts, a bar for protein.
    function renderWeek(date) {
        const start = shiftKey(date, -((fromKey(date).getDay() + 6) % 7));
        const today = todayKey();
        const goal = state.fitness.proteinGoal;
        return h('ol', { class: 'fitness-week', 'aria-label': '주간 기록' },
            Array.from({ length: 7 }, (_, index) => shiftKey(start, index)).map(day => {
                const sets = state.fitness.setsOnDate(day).length;
                const protein = state.fitness.proteinTotal(day);
                const selected = day === date;
                return h('li', {}, h('button', {
                    type: 'button',
                    id: `fitness-day-${day}`,
                    class: `fitness-day${selected ? ' is-selected' : ''}${sets ? ' has-workout' : ''}${day === today ? ' is-today' : ''}`,
                    disabled: day > today,
                    'aria-pressed': String(selected),
                    'aria-label': `${formatDate(day)}, 운동 ${sets}세트, 단백질 ${fmt(protein)}g`,
                    onclick: () => setDate(day, `fitness-day-${day}`)
                },
                h('span', { class: 'fitness-day-name', text: WEEKDAYS[fromKey(day).getDay()] }),
                h('span', { class: 'fitness-day-number', text: String(fromKey(day).getDate()) }),
                h('span', { class: 'fitness-day-dot' }),
                h('span', { class: 'fitness-day-protein' },
                    h('span', { style: `width: ${Math.min(100, (protein / goal) * 100)}%` }))));
            }));
    }

    // --- Workout ---
    function summaryText(date) {
        const sets = state.fitness.setsOnDate(date);
        const volume = FitnessLog.volume(sets);
        return sets.length ? `${sets.length}세트${volume ? ` · 볼륨 ${fmt(volume)}kg` : ''}` : '아직 기록 없음';
    }

    function renderWorkout(date) {
        const log = state.fitness;
        const exercises = log.orderedExercises();
        if (!log.findExercise(ui.exerciseId)) ui.exerciseId = exercises[0]?.id || null;
        const adding = ui.addingExercise || !exercises.length;
        const current = !adding && ui.exerciseId ? log.findExercise(ui.exerciseId) : null;

        return h('section', { class: 'fitness-card workout-card', 'aria-labelledby': 'workoutTitle' },
            h('div', { class: 'fitness-card-head' },
                h('h3', { id: 'workoutTitle', text: '운동' }),
                h('p', { class: 'fitness-summary', text: summaryText(date) })),
            h('div', { class: 'workout-entry' },
                exercises.length ? renderExerciseChips(exercises, date, adding) : null,
                adding ? renderExerciseForm(exercises.length > 0) : null,
                current ? renderEntry(current, date) : null),
            renderDayLog(date),
            current ? renderHistory(current, date) : null);
    }

    function renderExerciseChips(exercises, date, adding) {
        return h('div', { class: 'exercise-chips', role: 'group', 'aria-label': '종목 선택' },
            exercises.map(exercise => {
                const count = state.fitness.setsFor(exercise.id, date).length;
                return h('button', {
                    type: 'button',
                    id: `exercise-chip-${exercise.id}`,
                    class: 'exercise-chip',
                    'aria-pressed': String(!adding && exercise.id === ui.exerciseId),
                    onclick: () => {
                        ui.exerciseId = exercise.id;
                        ui.addingExercise = false;
                        ui.renaming = false;
                        ui.showHistory = false;
                        ui.editingSetId = null;
                        render({ id: `exercise-chip-${exercise.id}` });
                    }
                },
                h('span', { class: 'exercise-chip-name', text: exercise.name }),
                count ? h('span', { class: 'exercise-chip-count' }, String(count), h('span', { class: 'visually-hidden', text: '세트' })) : null);
            }),
            h('button', {
                type: 'button',
                id: 'addExerciseToggle',
                class: 'exercise-chip exercise-chip-add',
                'aria-expanded': String(adding),
                text: '+ 종목',
                onclick: () => {
                    ui.addingExercise = !ui.addingExercise;
                    render({ id: ui.addingExercise ? 'exerciseName' : 'addExerciseToggle' });
                }
            }));
    }

    function addExercise(name, kind) {
        const result = state.fitness.addExercise(name, kind);
        if (!result) {
            announce('종목 이름을 입력해 주세요.');
            document.getElementById('exerciseName')?.focus();
            return;
        }
        ui.exerciseId = result.exercise.id;
        ui.addingExercise = false;
        ui.editingSetId = null;
        if (result.created) persist();
        render({ id: 'recordSetButton' });
        announce(result.created ? `${result.exercise.name} 종목을 추가했습니다.` : `${result.exercise.name} 종목이 이미 있어 선택했습니다.`);
    }

    function renderExerciseForm(cancellable) {
        const existing = new Set(state.fitness.exercises.map(item => item.name));
        const suggestions = SUGGESTED_EXERCISES.filter(item => !existing.has(item.name));
        const input = h('input', { id: 'exerciseName', type: 'text', maxLength: NAME_MAX_LENGTH, placeholder: '예: 벤치프레스', autocomplete: 'off' });
        const form = h('form', {
            class: 'exercise-form',
            onsubmit: event => {
                event.preventDefault();
                addExercise(input.value, form.querySelector('input[name="exerciseKind"]:checked')?.value || 'weight');
            }
        },
        h('label', { for: 'exerciseName', class: 'fitness-label', text: '새 종목' }),
        h('div', { class: 'exercise-form-row' },
            input,
            h('button', { type: 'submit', class: 'fitness-primary', text: '추가' })),
        h('fieldset', { class: 'kind-options' },
            h('legend', { class: 'visually-hidden', text: '기록 방식' }),
            Object.entries(KINDS).map(([kind, info], index) => h('label', { class: 'kind-option' },
                h('input', { type: 'radio', name: 'exerciseKind', value: kind, checked: index === 0 }),
                h('strong', { text: info.label }),
                h('span', { text: info.hint })))),
        suggestions.length ? h('div', { class: 'suggestions' },
            h('span', { class: 'fitness-label', text: '추천 종목 · 누르면 바로 추가' }),
            h('div', { class: 'suggestion-chips' }, suggestions.map(item => h('button', {
                type: 'button',
                class: 'suggestion-chip',
                onclick: () => addExercise(item.name, item.kind)
            }, item.name, h('span', { text: KINDS[item.kind].label }))))) : null,
        cancellable ? h('button', {
            type: 'button',
            class: 'fitness-text-button',
            text: '취소',
            onclick: () => { ui.addingExercise = false; render({ id: 'addExerciseToggle' }); }
        }) : null);
        return form;
    }

    // --- Entry form: pick an exercise, set the numbers, record. ---
    const STEPS = { weight: 2.5, reps: 1, minutes: 5, km: 0.5 };
    const unitWord = exercise => exercise.kind === 'cardio' ? '회차' : '세트';

    function displayValue(kind, value) {
        if (value === undefined || value === null) return '';
        return kind === 'cardio' && value === 0 ? '' : String(value);
    }

    function showSetError(message) {
        const element = document.getElementById('setError');
        if (!element) return;
        element.textContent = message;
        element.hidden = !message;
    }

    // A save from another device can remove the set being edited; the form then returns to recording.
    function editingSet() {
        const set = ui.editingSetId ? state.fitness.sets.find(item => item.id === ui.editingSetId) : null;
        if (!set) ui.editingSetId = null;
        return set || null;
    }

    // The numbers stay in the form after recording, so repeating a set is a single tap.
    function draftFor(exercise, date) {
        const key = `${exercise.id}|${date}|${ui.editingSetId || ''}`;
        if (ui.draft?.key !== key) {
            const source = editingSet() || state.fitness.nextSetValues(exercise.id, date);
            ui.draft = {
                key,
                values: Object.fromEntries(FIELDS[exercise.kind].map(field => [field.key, displayValue(exercise.kind, source[field.key])]))
            };
        }
        return ui.draft.values;
    }

    function renderMeta(exercise, date) {
        const previous = state.fitness.previousSession(exercise.id, date);
        const best = state.fitness.best(exercise.id);
        return h('dl', { class: 'exercise-meta' },
            h('div', {}, h('dt', { text: previous ? `지난번 ${shortDate(previous.date)}` : '지난번' }),
                h('dd', { text: previous ? previous.sets.map(formatSet).join(', ') : '첫 기록이에요' })),
            best ? h('div', { class: 'is-best' }, h('dt', { text: '최고' }), h('dd', { text: formatSet(best) })) : null);
    }

    function renderStepper(exercise, field, values) {
        const limits = LIMITS[field.key];
        let selectOnMouseUp = false;
        const input = h('input', {
            id: `entry-${field.key}`,
            class: 'set-input',
            type: 'number',
            inputMode: field.key === 'weight' || field.key === 'km' ? 'decimal' : 'numeric',
            min: limits.min,
            max: limits.max,
            step: 'any',
            value: values[field.key],
            placeholder: exercise.kind === 'cardio' ? '0' : null,
            // Selecting the number on focus lets a new value replace it; the click's mouseup would undo that.
            onfocus: () => { input.select(); selectOnMouseUp = true; },
            onmouseup: event => {
                if (selectOnMouseUp) event.preventDefault();
                selectOnMouseUp = false;
            },
            onkeydown: () => { selectOnMouseUp = false; },
            oninput: () => {
                values[field.key] = input.value;
                input.removeAttribute('aria-invalid');
                showSetError('');
            }
        });
        const step = direction => {
            const next = Math.round(((Number(input.value) || 0) + direction * STEPS[field.key]) * 100) / 100;
            input.value = String(Math.min(limits.max, Math.max(limits.min, next)));
            values[field.key] = input.value;
            input.removeAttribute('aria-invalid');
            showSetError('');
        };
        const amount = `${fmt(STEPS[field.key])}${field.unit}`;
        return h('div', { class: 'set-field' },
            h('label', { for: input.id, class: 'set-field-label', text: field.label }),
            h('div', { class: 'stepper' },
                iconButton('minus', `${field.label} ${amount} 줄이기`, () => step(-1), { class: 'stepper-button' }),
                h('span', { class: 'stepper-value' }, input, h('span', { class: 'stepper-unit', 'aria-hidden': 'true', text: field.unit })),
                iconButton('plus', `${field.label} ${amount} 늘리기`, () => step(1), { class: 'stepper-button' })));
    }

    // Marks the numbers that are out of range; when each is fine alone but the set is not
    // (a cardio entry with neither time nor distance), every field is marked.
    function markInvalid(exercise, form) {
        const inputs = [...form.querySelectorAll('.set-input')];
        const bad = inputs.filter(input => {
            const { min, max } = LIMITS[input.id.replace('entry-', '')];
            if (input.value === '') return exercise.kind !== 'cardio';
            const number = Number(input.value);
            return !Number.isFinite(number) || number < min || number > max;
        });
        (bad.length ? bad : inputs).forEach(input => input.setAttribute('aria-invalid', 'true'));
        showSetError(SET_ERRORS[exercise.kind]);
        announce(SET_ERRORS[exercise.kind]);
        (bad[0] || inputs[0])?.focus();
    }

    function saveEntry(exercise, date, form) {
        const values = { ...draftFor(exercise, date) };
        const editing = editingSet();
        if (editing) {
            const index = state.fitness.setsFor(exercise.id, editing.date).findIndex(item => item.id === editing.id);
            const updated = state.fitness.updateSet(editing.id, values);
            if (!updated) return markInvalid(exercise, form);
            ui.editingSetId = null;
            ui.flashId = editing.id;
            persist();
            render({ id: 'recordSetButton' });
            announce(`${index + 1}${unitWord(exercise)}를 ${formatSet(updated)}로 고쳤습니다.`);
            return;
        }
        const result = state.fitness.addSet(exercise.id, date, values);
        if (!result) return markInvalid(exercise, form);
        ui.flashId = result.set.id;
        persist();
        const count = state.fitness.setsFor(exercise.id, date).length;
        render({ id: 'recordSetButton' });
        announce(`${exercise.name} ${count}${unitWord(exercise)} ${formatSet(result.set)} 기록했습니다.${result.record ? ' 최고 기록이에요!' : ''}`);
    }

    function stopEditing(focusId = 'recordSetButton') {
        ui.editingSetId = null;
        render({ id: focusId });
    }

    function renderEntry(exercise, date) {
        const editing = editingSet();
        const sets = state.fitness.setsFor(exercise.id, date);
        const position = editing ? sets.findIndex(item => item.id === editing.id) : sets.length;
        const label = `${position + 1}${unitWord(exercise)}`;
        const values = draftFor(exercise, date);
        const form = h('form', {
            id: 'setForm',
            class: 'set-form',
            novalidate: true,
            onsubmit: event => { event.preventDefault(); saveEntry(exercise, date, form); }
        },
        h('div', { class: `set-fields fields-${FIELDS[exercise.kind].length}` },
            FIELDS[exercise.kind].map(field => renderStepper(exercise, field, values))),
        h('p', { id: 'setError', class: 'fitness-error', role: 'alert', hidden: true }),
        h('div', { class: 'set-form-actions' },
            h('button', { type: 'submit', id: 'recordSetButton', class: 'record-button' },
                editing ? `${label} 수정 저장` : [icon('plus'), `${label} 기록`]),
            editing ? h('button', { type: 'button', class: 'fitness-text-button', text: '취소', onclick: () => stopEditing(`log-set-${editing.id}`) }) : null,
            editing ? h('button', {
                type: 'button',
                class: 'fitness-text-button is-danger',
                text: '삭제',
                onclick: () => {
                    state.fitness.removeSet(editing.id);
                    persist();
                    stopEditing();
                    announce(`${label}를 삭제했습니다.`);
                }
            }) : null));

        return h('div', { class: `exercise-card${editing ? ' is-editing' : ''}` },
            h('div', { class: 'exercise-card-head' },
                h('div', { class: 'exercise-card-title' },
                    h('h4', { text: exercise.name }),
                    h('span', { class: 'kind-badge', text: KINDS[exercise.kind].label }),
                    editing ? h('span', { class: 'editing-badge', text: `${label} 수정 중` }) : null),
                editing ? null : h('div', { class: 'exercise-card-actions' },
                    iconButton('edit', `${exercise.name} 이름 수정`, () => { ui.renaming = !ui.renaming; render({ id: ui.renaming ? 'renameExercise' : 'renameExerciseButton', select: true }); },
                        { id: 'renameExerciseButton', 'aria-expanded': String(ui.renaming) }),
                    iconButton('delete', `${exercise.name} 종목 삭제`, () => removeExercise(exercise), { class: 'is-danger' }))),
            ui.renaming && !editing ? renderRenameForm(exercise) : null,
            form,
            editing ? null : renderMeta(exercise, date));
    }

    // --- The day's log: read-only, grouped by exercise in the order they were first done. ---
    function startEditing(exercise, set) {
        if (ui.editingSetId === set.id) return stopEditing(`log-set-${set.id}`);
        ui.exerciseId = exercise.id;
        ui.addingExercise = false;
        ui.renaming = false;
        ui.editingSetId = set.id;
        render({ id: `entry-${FIELDS[exercise.kind][0].key}`, select: true });
        const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        document.getElementById('setForm')?.closest('.exercise-card')?.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
        announce(`${formatSet(set)} 기록을 입력란에 불러왔습니다. 고친 뒤 수정 저장을 누르세요.`);
    }

    function renderLogGroup(exercise, date, sets) {
        const records = state.fitness.recordSetIds(exercise.id);
        const previous = state.fitness.previousSession(exercise.id, date);
        const volume = FitnessLog.volume(sets);
        return h('li', { class: `log-group${exercise.id === ui.exerciseId ? ' is-current' : ''}` },
            h('div', { class: 'log-group-head' },
                h('h5', { text: exercise.name }),
                h('span', { class: 'log-group-meta', text: `${sets.length}${unitWord(exercise)}${volume ? ` · ${fmt(volume)}kg` : ''}` })),
            h('ol', { class: 'log-sets' }, sets.map((set, index) => {
                const isRecord = records.has(set.id);
                const editing = set.id === ui.editingSetId;
                const prior = previous?.sets[index];
                return h('li', {}, h('button', {
                    type: 'button',
                    id: `log-set-${set.id}`,
                    class: `log-set${isRecord ? ' is-record' : ''}${editing ? ' is-editing' : ''}${ui.flashId === set.id ? ' is-new' : ''}`,
                    'aria-pressed': String(editing),
                    'aria-label': `${exercise.name} ${index + 1}${unitWord(exercise)} ${formatSet(set)}${isRecord ? ', 최고 기록' : ''}, 눌러서 수정`,
                    onclick: () => startEditing(exercise, set)
                },
                h('span', { class: 'set-index', text: String(index + 1) }),
                h('span', { class: 'log-set-value', text: formatSet(set) }),
                isRecord ? h('span', { class: 'record-badge', title: '그때까지의 최고 기록', text: 'PR' }) : null,
                prior ? h('span', { class: 'log-set-previous', text: `지난번 ${formatSet(prior)}` }) : null));
            })));
    }

    function renderDayLog(date) {
        const groups = new Map();
        state.fitness.setsOnDate(date).forEach(set => {
            if (!groups.has(set.exerciseId)) groups.set(set.exerciseId, []);
            groups.get(set.exerciseId).push(set);
        });
        const entries = [...groups].map(([id, sets]) => [state.fitness.findExercise(id), sets]).filter(([exercise]) => exercise);
        return h('section', { class: 'workout-log', 'aria-labelledby': 'workoutLogTitle' },
            h('h4', { id: 'workoutLogTitle', text: date === todayKey() ? '오늘의 기록' : `${shortDate(date)} 기록` }),
            entries.length
                ? h('ol', { class: 'log-groups' }, entries.map(([exercise, sets]) => renderLogGroup(exercise, date, sets)))
                : h('p', { class: 'log-empty', text: '아직 기록이 없어요. 위에서 무게와 횟수를 정하고 기록을 눌러 보세요.' }));
    }

    function renderHistory(exercise, date) {
        const pastSessions = state.fitness.sessions(exercise.id).filter(session => session.date !== date);
        if (!pastSessions.length) return null;
        return h('div', { class: 'exercise-history' },
            h('button', {
                type: 'button',
                id: 'exerciseHistoryToggle',
                class: 'fitness-text-button',
                'aria-expanded': String(ui.showHistory),
                text: ui.showHistory ? '지난 기록 접기' : `${exercise.name} 지난 기록 (${pastSessions.length}일)`,
                onclick: () => { ui.showHistory = !ui.showHistory; render({ id: 'exerciseHistoryToggle' }); }
            }),
            ui.showHistory ? h('ol', { class: 'history-sessions' }, pastSessions.slice(0, 10).map(session => {
                const volume = FitnessLog.volume(session.sets);
                return h('li', {},
                    h('button', { type: 'button', class: 'history-date', text: `${shortDate(session.date)} (${WEEKDAYS[fromKey(session.date).getDay()]})`,
                        'aria-label': `${formatDate(session.date)}로 이동`, onclick: () => setDate(session.date, 'recordSetButton') }),
                    h('span', { class: 'history-sets', text: session.sets.map(formatSet).join(', ') }),
                    volume ? h('span', { class: 'history-volume', text: `${fmt(volume)}kg` }) : null);
            })) : null);
    }

    function removeExercise(exercise) {
        const count = state.fitness.setsFor(exercise.id).length;
        if (count && !window.confirm(`'${exercise.name}' 종목을 삭제할까요? 기록된 ${count}세트도 함께 삭제됩니다.`)) return;
        state.fitness.removeExercise(exercise.id);
        ui.exerciseId = null;
        ui.editingSetId = null;
        persist();
        render({ id: 'addExerciseToggle' });
        announce(`${exercise.name} 종목을 삭제했습니다.`);
    }

    function renderRenameForm(exercise) {
        const input = h('input', { id: 'renameExercise', type: 'text', maxLength: NAME_MAX_LENGTH, value: exercise.name, autocomplete: 'off',
            onkeydown: event => { if (event.key === 'Escape') { event.preventDefault(); ui.renaming = false; render({ id: 'renameExerciseButton' }); } } });
        return h('form', {
            class: 'inline-form',
            onsubmit: event => {
                event.preventDefault();
                if (!state.fitness.renameExercise(exercise.id, input.value)) {
                    announce(input.value.trim() ? '같은 이름의 종목이 이미 있습니다.' : '종목 이름을 입력해 주세요.');
                    input.focus();
                    return;
                }
                ui.renaming = false;
                persist();
                render({ id: 'renameExerciseButton' });
                announce('종목 이름을 바꿨습니다.');
            }
        },
        h('label', { for: 'renameExercise', class: 'visually-hidden', text: '종목 이름' }),
        input,
        h('button', { type: 'submit', class: 'fitness-primary', text: '저장' }),
        h('button', { type: 'button', class: 'fitness-text-button', text: '취소', onclick: () => { ui.renaming = false; render({ id: 'renameExerciseButton' }); } }));
    }

    // --- Protein ---
    function addProtein(date, grams, label, focusId, { saveAsFood = false } = {}) {
        const entry = state.fitness.addProtein(date, grams, label);
        if (!entry) return null;
        if (saveAsFood && entry.label) state.fitness.saveFood(entry.label, entry.grams);
        ui.flashId = entry.id;
        persist();
        render({ id: focusId });
        announce(`${label || '단백질'} ${fmt(entry.grams)}g 추가 · 합계 ${fmt(state.fitness.proteinTotal(date))}g`);
        return entry;
    }

    function renderGoalForm() {
        const input = h('input', { id: 'proteinGoalInput', type: 'number', inputMode: 'numeric', min: LIMITS.goal.min, max: LIMITS.goal.max, step: 1,
            value: state.fitness.proteinGoal,
            onkeydown: event => { if (event.key === 'Escape') { event.preventDefault(); ui.editingGoal = false; render({ id: 'proteinGoalButton' }); } } });
        return h('form', {
            class: 'inline-form',
            novalidate: true,
            onsubmit: event => {
                event.preventDefault();
                if (state.fitness.setProteinGoal(input.value) === null) {
                    announce(`목표는 ${LIMITS.goal.min}~${LIMITS.goal.max}g 사이로 입력해 주세요.`);
                    input.focus();
                    return;
                }
                ui.editingGoal = false;
                persist();
                render({ id: 'proteinGoalButton' });
                announce(`하루 단백질 목표를 ${state.fitness.proteinGoal}g으로 바꿨습니다.`);
            }
        },
        h('label', { for: 'proteinGoalInput', class: 'fitness-label', text: '하루 목표 (g)' }),
        input,
        h('button', { type: 'submit', class: 'fitness-primary', text: '저장' }),
        h('button', { type: 'button', class: 'fitness-text-button', text: '취소', onclick: () => { ui.editingGoal = false; render({ id: 'proteinGoalButton' }); } }));
    }

    function renderProtein(date) {
        const log = state.fitness;
        const total = log.proteinTotal(date);
        const goal = log.proteinGoal;
        const percent = Math.min(100, Math.round((total / goal) * 100));
        const entries = log.proteinOn(date);
        const remaining = Math.round((goal - total) * 10) / 10;

        const nameInput = h('input', { id: 'proteinName', type: 'text', maxLength: NAME_MAX_LENGTH, placeholder: '음식 (선택)', autocomplete: 'off' });
        const gramsInput = h('input', { id: 'proteinGrams', type: 'number', inputMode: 'decimal', min: LIMITS.grams.min, max: LIMITS.grams.max, step: 'any', placeholder: 'g' });
        const saveFood = h('input', { id: 'proteinSaveFood', type: 'checkbox', checked: true });

        return h('section', { class: 'fitness-card protein-card', 'aria-labelledby': 'proteinTitle' },
            h('div', { class: 'fitness-card-head' },
                h('h3', { id: 'proteinTitle', text: '단백질' }),
                h('button', {
                    type: 'button',
                    id: 'proteinGoalButton',
                    class: 'goal-button',
                    'aria-expanded': String(ui.editingGoal),
                    'aria-label': `하루 목표 ${goal}g 수정`,
                    onclick: () => { ui.editingGoal = !ui.editingGoal; render({ id: ui.editingGoal ? 'proteinGoalInput' : 'proteinGoalButton', select: true }); }
                }, `목표 ${goal}g`, icon('edit'))),
            ui.editingGoal ? renderGoalForm() : null,
            h('div', { class: `protein-meter${total >= goal ? ' is-done' : ''}` },
                h('p', { class: 'protein-numbers' },
                    h('strong', { id: 'proteinTotal', text: fmt(total) }),
                    h('span', { text: `/ ${goal}g` })),
                h('div', { class: 'protein-track', role: 'progressbar', 'aria-label': '단백질 목표 달성률',
                    'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(percent) },
                h('span', { style: `width: ${percent}%` })),
                h('p', { class: 'protein-status', text: total >= goal ? '목표 달성!' : `${fmt(remaining)}g 남았어요` })),
            h('div', { class: 'food-head' },
                h('span', { class: 'fitness-label', text: ui.editingFoods ? '지울 음식을 누르세요' : '한 번 누르면 바로 추가' }),
                h('button', { type: 'button', id: 'editFoodsButton', class: 'fitness-text-button', 'aria-pressed': String(ui.editingFoods),
                    text: ui.editingFoods ? '완료' : '편집',
                    onclick: () => { ui.editingFoods = !ui.editingFoods; render({ id: 'editFoodsButton' }); } })),
            log.foods.length ? h('div', { class: `food-chips${ui.editingFoods ? ' is-editing' : ''}` }, log.foods.map(food => h('button', {
                type: 'button',
                id: `food-chip-${food.id}`,
                class: 'food-chip',
                'aria-label': ui.editingFoods ? `${food.name} 빠른 추가에서 지우기` : `${food.name} ${fmt(food.grams)}g 추가`,
                onclick: () => {
                    if (!ui.editingFoods) {
                        addProtein(date, food.grams, food.name, `food-chip-${food.id}`);
                        return;
                    }
                    state.fitness.removeFood(food.id);
                    persist();
                    render({ id: 'editFoodsButton' });
                    announce(`${food.name}을 빠른 추가에서 지웠습니다.`);
                }
            },
            h('span', { class: 'food-name', text: food.name }),
            h('span', { class: 'food-grams', text: ui.editingFoods ? '×' : `+${fmt(food.grams)}g` })))) : null,
            h('form', {
                class: 'protein-form',
                novalidate: true,
                onsubmit: event => {
                    event.preventDefault();
                    if (!addProtein(date, gramsInput.value, nameInput.value, 'proteinGrams', { saveAsFood: saveFood.checked })) {
                        announce(`단백질 양을 ${LIMITS.grams.min}~${LIMITS.grams.max}g 사이로 입력해 주세요.`);
                        gramsInput.focus();
                    }
                }
            },
            h('label', { for: 'proteinName', class: 'visually-hidden', text: '음식 이름' }),
            nameInput,
            h('label', { for: 'proteinGrams', class: 'visually-hidden', text: '단백질 양 (g)' }),
            gramsInput,
            h('button', { type: 'submit', class: 'fitness-primary', text: '추가' }),
            h('label', { class: 'save-food' }, saveFood, '이름을 쓰면 빠른 추가에 저장')),
            entries.length ? h('ol', { class: 'protein-entries', 'aria-label': `${formatDate(date)} 단백질 기록` }, entries.map(entry =>
                h('li', { class: `protein-entry${ui.flashId === entry.id ? ' is-new' : ''}` },
                    h('span', { class: 'entry-time', text: formatTime(entry.at) }),
                    h('span', { class: 'entry-label', text: entry.label || '직접 입력' }),
                    h('span', { class: 'entry-grams', text: `${fmt(entry.grams)}g` }),
                    iconButton('delete', `${entry.label || '직접 입력'} ${fmt(entry.grams)}g 삭제`, () => {
                        state.fitness.removeProtein(entry.id);
                        persist();
                        render({ id: 'proteinGrams' });
                        announce('단백질 기록을 삭제했습니다.');
                    }, { class: 'is-danger' })))) : h('p', { class: 'fitness-empty', text: '아직 기록이 없어요.' }));
    }

    // Called once the stored log has loaded.
    function ready() {
        ui.loaded = true;
        const pending = state.cloudUser ? readPending() : null;
        if (pending) {
            // Changes from a visit that ended before its save finished go on top of the server copy.
            state.fitness = FitnessLog.fromData(mergeData(pending.base, pending.local, state.fitnessBase));
            render();
            persist();
            return;
        }
        render();
    }

    app.fitness = Object.freeze({ render, ready });
})();
