// Routine loading panel and the routine manager form/list.
(function initializePlanRoutines() {
    const app = window.PlanApp;
    const { dom, state, announce, savePlans, saveRoutines, parseLines, createActionButton } = app;
    const { CATEGORY_INFO } = window.PlanModel;

    function loadRoutineAsPlan(routineId) {
        const routine = state.routines.find(routineId);
        if (!routine) return;

        // The new line is named after the routine it came from.
        const chain = state.plans.addChain(routine.items, state.activeCategory, routine.name);
        if (!chain) return;

        state.historyOpen = false;
        savePlans();
        state.routinePanelOpen = false;
        app.board.render({ focusChainId: chain.id });
        announce(`${routine.name} 루틴을 새 ${CATEGORY_INFO[state.activeCategory].label} 계획 라인으로 불러왔습니다.`);
    }

    function editRoutine(routineId) {
        const routine = state.routines.find(routineId);
        if (!routine) return;

        state.editingRoutineId = routine.id;
        dom.routineName.value = routine.name;
        dom.routineItems.value = routine.items.join('\n');
        render();
        dom.routineForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
        window.requestAnimationFrame(() => {
            dom.routineName.focus();
            dom.routineName.select();
        });
        announce(`${routine.name} 루틴 수정 화면을 열었습니다.`);
    }

    function deleteRoutine(routineId) {
        const removed = state.routines.remove(routineId);
        if (!removed) return;

        if (state.editingRoutineId === routineId) resetForm();
        saveRoutines();
        render();
        announce(`${removed.name} 루틴을 삭제했습니다.`);
    }

    function resetForm({ focus = false } = {}) {
        state.editingRoutineId = null;
        dom.routineForm.reset();
        dom.routineName.setCustomValidity('');
        dom.routineItems.setCustomValidity('');
        render();
        if (focus) dom.routineName.focus();
    }

    function createRoutineSteps(routine, compact = false) {
        const list = document.createElement('ol');
        list.className = `routine-steps${compact ? ' is-compact' : ''}`;

        routine.items.forEach((item, index) => {
            const step = document.createElement('li');
            step.textContent = item;
            step.setAttribute('aria-label', `${index + 1}번째: ${item}`);
            list.appendChild(step);
        });
        return list;
    }

    function createRoutineLoadCard(routine) {
        const card = document.createElement('article');
        card.className = 'routine-load-card';

        const copy = document.createElement('div');
        copy.className = 'routine-card-copy';

        const title = document.createElement('h3');
        title.textContent = routine.name;

        const count = document.createElement('span');
        count.textContent = `${routine.items.length}개 엘리먼트`;
        copy.append(title, count, createRoutineSteps(routine, true));

        const loadButton = createActionButton('불러오기', 'routine-load-button', () => {
            loadRoutineAsPlan(routine.id);
        });
        loadButton.setAttribute('aria-label', `${routine.name} 루틴 불러오기`);

        card.append(copy, loadButton);
        return card;
    }

    function createRoutineManagerCard(routine) {
        const card = document.createElement('article');
        card.className = 'routine-manager-card';

        const heading = document.createElement('div');
        heading.className = 'routine-card-heading';

        const titleGroup = document.createElement('div');
        const kicker = document.createElement('span');
        kicker.className = 'routine-card-kicker';
        kicker.textContent = `${routine.items.length}개 엘리먼트`;
        const title = document.createElement('h4');
        title.textContent = routine.name;
        titleGroup.append(kicker, title);

        const actions = document.createElement('div');
        actions.className = 'routine-card-actions';
        const loadButton = createActionButton('불러오기', 'routine-card-button routine-use-button', () => {
            loadRoutineAsPlan(routine.id);
        });
        const editButton = createActionButton('수정', 'routine-card-button', () => {
            editRoutine(routine.id);
        });
        const deleteButton = createActionButton('삭제', 'routine-card-button routine-delete-button', () => {
            deleteRoutine(routine.id);
        });
        loadButton.setAttribute('aria-label', `${routine.name} 루틴 불러오기`);
        editButton.setAttribute('aria-label', `${routine.name} 루틴 수정`);
        deleteButton.setAttribute('aria-label', `${routine.name} 루틴 삭제`);
        actions.append(loadButton, editButton, deleteButton);
        heading.append(titleGroup, actions);

        card.append(heading, createRoutineSteps(routine));
        return card;
    }

    function render() {
        const info = CATEGORY_INFO[state.activeCategory];
        const categoryRoutines = state.routines.getByCategory(state.activeCategory);
        const editingRoutine = state.editingRoutineId ? state.routines.find(state.editingRoutineId) : null;

        dom.routineLoadCount.textContent = String(categoryRoutines.length);
        dom.routineToggle.setAttribute('aria-expanded', String(state.routinePanelOpen));
        dom.routineToggleIcon.textContent = state.routinePanelOpen ? '−' : '＋';
        dom.routineLoadPanel.hidden = !state.routinePanelOpen;
        dom.routineLoadHelp.textContent = `${info.label} 루틴을 선택하면 새 계획 라인으로 복사됩니다.`;
        dom.routineLoadEmpty.textContent = `저장된 ${info.label} 루틴이 없습니다.`;
        dom.routineLoadEmpty.hidden = categoryRoutines.length > 0;
        dom.routineLoadList.replaceChildren(...categoryRoutines.map(createRoutineLoadCard));

        dom.routineManagerTitle.textContent = `${info.label} 루틴 저장소`;
        dom.routineManagerDescription.textContent = `반복해서 사용하는 ${info.label} 계획을 루틴으로 저장하고 필요할 때 불러오세요.`;
        dom.routineManagerCount.textContent = `${categoryRoutines.length}개`;
        dom.routineManagerEmpty.textContent = `아직 저장된 ${info.label} 루틴이 없습니다.`;
        dom.routineManagerEmpty.hidden = categoryRoutines.length > 0;
        dom.routineManagerList.replaceChildren(...categoryRoutines.map(createRoutineManagerCard));

        dom.routineFormTitle.textContent = editingRoutine
            ? `${editingRoutine.name} 루틴 수정`
            : `새 ${info.label} 루틴 만들기`;
        dom.routineSubmitLabel.textContent = editingRoutine
            ? '수정 내용 저장'
            : `${info.label} 루틴 저장`;
        dom.routineName.placeholder = state.activeCategory === 'personal' ? '예: 아침 준비' : '예: 업무 시작';
        dom.routineItems.placeholder = info.placeholder;
        dom.routineCancel.hidden = !editingRoutine;
    }

    dom.routineToggle.addEventListener('click', () => {
        state.routinePanelOpen = !state.routinePanelOpen;
        render();
        if (state.routinePanelOpen) {
            window.requestAnimationFrame(() => {
                dom.routineLoadPanel.querySelector('button')?.focus();
            });
        }
    });

    dom.routineName.addEventListener('input', () => dom.routineName.setCustomValidity(''));
    dom.routineItems.addEventListener('input', () => dom.routineItems.setCustomValidity(''));

    dom.routineForm.addEventListener('submit', event => {
        event.preventDefault();
        const name = dom.routineName.value.trim();
        const items = parseLines(dom.routineItems.value);

        if (!name) {
            dom.routineName.setCustomValidity('루틴 이름을 입력해 주세요.');
            dom.routineName.reportValidity();
            return;
        }
        if (!items.length) {
            dom.routineItems.setCustomValidity('루틴 엘리먼트를 한 줄 이상 입력해 주세요.');
            dom.routineItems.reportValidity();
            return;
        }

        if (state.editingRoutineId) {
            const updated = state.routines.update(state.editingRoutineId, name, items);
            if (!updated) return;
            saveRoutines();
            resetForm();
            announce(`${updated.name} 루틴의 수정 내용을 저장했습니다.`);
            return;
        }

        const routine = state.routines.add(name, items, state.activeCategory);
        if (!routine) return;
        saveRoutines();
        resetForm({ focus: true });
        announce(`${routine.name} 루틴을 ${CATEGORY_INFO[state.activeCategory].label} 루틴 저장소에 추가했습니다.`);
    });

    dom.routineCancel.addEventListener('click', () => {
        resetForm({ focus: true });
        announce('루틴 수정을 취소했습니다.');
    });

    app.routines = Object.freeze({ render, resetForm });
})();
