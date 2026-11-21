// Workout and protein log. Each set is an editable row, and repeating a set or a usual food is one tap.
(function initializeFitness() {
    const app = window.PlanApp;
    const { dom, state, announce } = app;
    const { KINDS, LIMITS, NAME_MAX_LENGTH, SUGGESTED_EXERCISES, FitnessLog } = window.FitnessModel;

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
        editingGoal: false,
        editingFoods: false,
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

    // Saves are chained so quick taps never let an older document overwrite a newer one.
    let saving = null;
    let saveAgain = false;
    let editTimer = null;
    function persist() {
        window.clearTimeout(editTimer);
        editTimer = null;
        if (saving) {
            saveAgain = true;
            return saving;
        }
        saving = (async () => {
            do {
                saveAgain = false;
                await app.saveFitness();
            } while (saveAgain);
            saving = null;
        })();
        return saving;
    }

    // Typing saves after a short pause; leaving the field or the page saves at once.
    function persistSoon() {
        window.clearTimeout(editTimer);
        editTimer = window.setTimeout(persist, 500);
    }

    window.addEventListener('pagehide', () => { if (editTimer) persist(); });

    function render(focus = {}) {
        updateTabCount();
        if (!state.fitnessActive) return;
        if (!ui.loaded) {
            dom.fitnessPanel.replaceChildren(h('p', { class: 'fitness-loading', text: '운동 기록을 불러오는 중…' }));
            return;
        }
        const date = currentDate();
        dom.fitnessPanel.replaceChildren(
            renderDayBar(date),
            renderWeek(date),
            h('div', { class: 'fitness-grid' }, renderWorkout(date), renderProtein(date))
        );
        ui.flashId = null;
        if (focus.id) {
            window.requestAnimationFrame(() => {
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

        return h('section', { class: 'fitness-card workout-card', 'aria-labelledby': 'workoutTitle' },
            h('div', { class: 'fitness-card-head' },
                h('div', {},
                    h('span', { class: 'section-kicker', text: 'WORKOUT' }),
                    h('h3', { id: 'workoutTitle', text: '운동' })),
                h('p', { class: 'fitness-summary', text: summaryText(date) })),
            exercises.length ? renderExerciseChips(exercises, date, adding) : null,
            adding ? renderExerciseForm(exercises.length > 0) : null,
            !adding && ui.exerciseId ? renderExerciseCard(log.findExercise(ui.exerciseId), date) : null);
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
        if (result.created) persist();
        render({ id: 'addSetButton' });
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

    // --- Set rows: every set is a row whose numbers can be edited in place. ---
    function displayValue(kind, value) {
        if (value === undefined || value === null) return '';
        return kind === 'cardio' && value === 0 ? '' : String(value);
    }

    // "60×10" may wrap only after the ×, never inside a number.
    const compactSet = set => set.weight !== undefined
        ? [`${fmt(set.weight)}×`, h('wbr'), String(set.reps)]
        : [formatSet(set)];
    const unitWord = exercise => exercise.kind === 'cardio' ? '회차' : '세트';

    function showSetError(message) {
        const element = document.getElementById('setError');
        if (!element) return;
        element.textContent = message;
        element.hidden = !message;
    }

    function setNumber(index, isRecord) {
        return [
            h('span', { class: 'set-index', text: String(index + 1) }),
            isRecord ? h('span', { class: 'record-badge', title: '그때까지의 최고 기록', text: 'PR' }) : null
        ].filter(Boolean);
    }

    // What the next row will start with, shown on the add button so a tap is never a surprise.
    function addSetContent(exercise, date) {
        const count = state.fitness.setsFor(exercise.id, date).length;
        const next = state.fitness.nextSetValues(exercise.id, date);
        const word = exercise.kind === 'cardio' ? '기록' : '세트';
        const source = count ? `직전 ${word} 그대로` : state.fitness.lastSet(exercise.id) ? `지난번 첫 ${word}` : '기본값';
        return [
            h('span', { class: 'add-set-label' }, icon('plus'), exercise.kind === 'cardio' ? '기록 추가' : `${count + 1}세트 추가`),
            h('span', { class: 'add-set-hint', text: `${source} · ${formatSet(next)}` })
        ];
    }

    function renderMeta(exercise, date) {
        const previous = state.fitness.previousSession(exercise.id, date);
        const best = state.fitness.best(exercise.id);
        return h('dl', { class: 'exercise-meta' },
            h('div', {}, h('dt', { text: previous ? `지난번 ${shortDate(previous.date)}` : '지난번' }),
                h('dd', { text: previous ? previous.sets.map(formatSet).join(', ') : '첫 기록이에요' })),
            best ? h('div', { class: 'is-best' }, h('dt', { text: '최고' }), h('dd', { text: formatSet(best) })) : null);
    }

    // Typing must not rebuild the row being edited, so only the numbers that depend on it are redrawn.
    function refreshStats(exercise, date) {
        const panel = dom.fitnessPanel;
        const records = state.fitness.recordSetIds(exercise.id);
        panel.querySelector('.fitness-summary').textContent = summaryText(date);
        panel.querySelector('.exercise-meta')?.replaceWith(renderMeta(exercise, date));
        panel.querySelectorAll('.set-row').forEach((row, index) => {
            const isRecord = records.has(row.dataset.setId);
            row.classList.toggle('is-record', isRecord);
            row.querySelector('.set-number').replaceChildren(...setNumber(index, isRecord));
        });
        panel.querySelector('#addSetButton')?.replaceChildren(...addSetContent(exercise, date));
    }

    function focusNextInput(input) {
        const inputs = [...dom.fitnessPanel.querySelectorAll('.set-input')];
        const next = inputs[inputs.indexOf(input) + 1] || document.getElementById('addSetButton');
        next?.focus();
        if (next?.select) next.select();
    }

    // Valid typing updates the log immediately; leaving the field with an invalid value restores the last saved one.
    function setInput(exercise, date, set, index, field) {
        let committed = set[field.key];
        let wasRecord = false;
        let selectOnMouseUp = false;
        const revert = message => {
            state.fitness.updateSet(set.id, { [field.key]: committed });
            input.value = displayValue(exercise.kind, set[field.key]);
            input.removeAttribute('aria-invalid');
            refreshStats(exercise, date);
            showSetError(message);
        };
        const input = h('input', {
            id: `set-${set.id}-${field.key}`,
            class: 'set-input',
            type: 'number',
            inputMode: field.key === 'weight' || field.key === 'km' ? 'decimal' : 'numeric',
            min: LIMITS[field.key].min,
            max: LIMITS[field.key].max,
            step: 'any',
            value: displayValue(exercise.kind, set[field.key]),
            placeholder: exercise.kind === 'cardio' ? '0' : null,
            'aria-label': `${index + 1}${unitWord(exercise)} ${field.label} (${field.unit})`,
            onfocus: () => {
                committed = set[field.key];
                wasRecord = state.fitness.recordSetIds(exercise.id).has(set.id);
                // Selecting the number lets a new value be typed without clearing the old one first.
                input.select();
                selectOnMouseUp = true;
            },
            onmouseup: event => {
                if (selectOnMouseUp) event.preventDefault();
                selectOnMouseUp = false;
            },
            oninput: () => {
                selectOnMouseUp = false;
                const updated = state.fitness.updateSet(set.id, { [field.key]: input.value });
                if (!updated) {
                    input.setAttribute('aria-invalid', 'true');
                    return;
                }
                input.removeAttribute('aria-invalid');
                showSetError('');
                refreshStats(exercise, date);
                persistSoon();
            },
            onchange: () => {
                if (input.getAttribute('aria-invalid') === 'true') {
                    revert(`${SET_ERRORS[exercise.kind]} 이전 값으로 되돌렸어요.`);
                    announce(`${SET_ERRORS[exercise.kind]} 이전 값으로 되돌렸어요.`);
                    return;
                }
                committed = set[field.key];
                persist();
                const isRecord = state.fitness.recordSetIds(exercise.id).has(set.id);
                if (isRecord && !wasRecord) announce(`${index + 1}${unitWord(exercise)} ${formatSet(set)} 최고 기록이에요!`);
                wasRecord = isRecord;
            },
            onkeydown: event => {
                selectOnMouseUp = false;
                if (event.key === 'Escape') {
                    event.preventDefault();
                    revert('');
                    persist();
                } else if (event.key === 'Enter') {
                    event.preventDefault();
                    focusNextInput(input);
                }
            }
        });
        return input;
    }

    function renderSetTable(exercise, date, sets) {
        const fields = FIELDS[exercise.kind];
        const records = state.fitness.recordSetIds(exercise.id);
        const previous = state.fitness.previousSession(exercise.id, date);
        return h('div', { class: `set-table fields-${fields.length}`, role: 'table', 'aria-label': `${formatDate(date)} ${exercise.name} 세트` },
            h('div', { class: 'set-table-head', role: 'row' },
                h('span', { role: 'columnheader', text: unitWord(exercise) }),
                h('span', { role: 'columnheader', text: '지난번' }),
                fields.map(field => h('span', { role: 'columnheader', text: field.unit })),
                h('span', { role: 'columnheader' }, h('span', { class: 'visually-hidden', text: '삭제' }))),
            sets.map((set, index) => {
                const isRecord = records.has(set.id);
                const prior = previous?.sets[index];
                return h('div', {
                    class: `set-row${isRecord ? ' is-record' : ''}${ui.flashId === set.id ? ' is-new' : ''}`,
                    role: 'row',
                    'data-set-id': set.id
                },
                h('span', { class: 'set-number', role: 'cell' }, setNumber(index, isRecord)),
                h('span', { class: 'set-previous', role: 'cell' }, prior ? compactSet(prior) : '—'),
                fields.map(field => h('span', { class: 'set-cell', role: 'cell' }, setInput(exercise, date, set, index, field))),
                h('span', { class: 'set-action', role: 'cell' },
                    iconButton('delete', `${index + 1}${unitWord(exercise)} 삭제`, () => removeSet(exercise, set, index), { class: 'is-danger' })));
            }));
    }

    function addSetRow(exercise, date) {
        const result = state.fitness.addSet(exercise.id, date, state.fitness.nextSetValues(exercise.id, date));
        if (!result) return;
        ui.flashId = result.set.id;
        persist();
        const count = state.fitness.setsFor(exercise.id, date).length;
        render({ id: 'addSetButton' });
        announce(`${exercise.name} ${count}${unitWord(exercise)} ${formatSet(result.set)} 행을 추가했습니다. 값은 행에서 바로 고칠 수 있어요.`);
    }

    function removeSet(exercise, set, index) {
        state.fitness.removeSet(set.id);
        persist();
        render({ id: 'addSetButton' });
        announce(`${index + 1}${unitWord(exercise)}를 삭제했습니다.`);
    }

    function removeExercise(exercise) {
        const count = state.fitness.setsFor(exercise.id).length;
        if (count && !window.confirm(`'${exercise.name}' 종목을 삭제할까요? 기록된 ${count}세트도 함께 삭제됩니다.`)) return;
        state.fitness.removeExercise(exercise.id);
        ui.exerciseId = null;
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

    function renderExerciseCard(exercise, date) {
        const sets = state.fitness.setsFor(exercise.id, date);
        const pastSessions = state.fitness.sessions(exercise.id).filter(session => session.date !== date);

        return h('div', { class: 'exercise-card' },
            h('div', { class: 'exercise-card-head' },
                h('div', { class: 'exercise-card-title' },
                    h('h4', { text: exercise.name }),
                    h('span', { class: 'kind-badge', text: KINDS[exercise.kind].label })),
                h('div', { class: 'exercise-card-actions' },
                    iconButton('edit', `${exercise.name} 이름 수정`, () => { ui.renaming = !ui.renaming; render({ id: ui.renaming ? 'renameExercise' : 'renameExerciseButton', select: true }); },
                        { id: 'renameExerciseButton', 'aria-expanded': String(ui.renaming) }),
                    iconButton('delete', `${exercise.name} 종목 삭제`, () => removeExercise(exercise), { class: 'is-danger' }))),
            ui.renaming ? renderRenameForm(exercise) : null,
            renderMeta(exercise, date),
            sets.length ? renderSetTable(exercise, date, sets) : null,
            h('p', { id: 'setError', class: 'fitness-error', role: 'alert', hidden: true }),
            h('button', { type: 'button', id: 'addSetButton', class: 'add-set-button', onclick: () => addSetRow(exercise, date) },
                addSetContent(exercise, date)),
            pastSessions.length ? h('div', { class: 'exercise-history' },
                h('button', {
                    type: 'button',
                    id: 'exerciseHistoryToggle',
                    class: 'fitness-text-button',
                    'aria-expanded': String(ui.showHistory),
                    text: ui.showHistory ? '지난 기록 접기' : `지난 기록 보기 (${pastSessions.length}일)`,
                    onclick: () => { ui.showHistory = !ui.showHistory; render({ id: 'exerciseHistoryToggle' }); }
                }),
                ui.showHistory ? h('ol', { class: 'history-sessions' }, pastSessions.slice(0, 10).map(session => {
                    const volume = FitnessLog.volume(session.sets);
                    return h('li', {},
                        h('button', { type: 'button', class: 'history-date', text: `${shortDate(session.date)} (${WEEKDAYS[fromKey(session.date).getDay()]})`,
                            'aria-label': `${formatDate(session.date)}로 이동`, onclick: () => setDate(session.date, 'addSetButton') }),
                        h('span', { class: 'history-sets', text: session.sets.map(formatSet).join(', ') }),
                        volume ? h('span', { class: 'history-volume', text: `${fmt(volume)}kg` }) : null);
                })) : null) : null);
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
                h('div', {},
                    h('span', { class: 'section-kicker', text: 'PROTEIN' }),
                    h('h3', { id: 'proteinTitle', text: '단백질' })),
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
        render();
    }

    app.fitness = Object.freeze({ render, ready });
})();
