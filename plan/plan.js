// Page entry point: category tabs, the new-line composer and initial data loading.
(function initializePlanPage() {
    const app = window.PlanApp;
    const { dom, state, announce, savePlans, parseLines, formatPosition } = app;
    const { CATEGORY_INFO, normalizeCategory, PlanCollection, RoutineCollection } = window.PlanModel;
    const storage = window.PlanStorage;

    function setActiveCategory(category, { focusTab = true } = {}) {
        const nextCategory = normalizeCategory(category);
        if (nextCategory === state.activeCategory) {
            if (focusTab) document.getElementById(`${nextCategory}Tab`)?.focus();
            return;
        }

        state.categoryDrafts[state.activeCategory] = dom.planInput.value;
        state.activeCategory = nextCategory;
        state.historyOpen = false;
        dom.planInput.value = state.categoryDrafts[state.activeCategory];
        state.openInsertKey = null;
        state.openEditKey = null;
        state.routinePanelOpen = false;
        app.routines.resetForm();
        storage.saveActiveCategory(state.activeCategory);
        app.board.render();

        if (focusTab) {
            window.requestAnimationFrame(() => {
                document.getElementById(`${state.activeCategory}Tab`)?.focus();
            });
        }
        announce(`${CATEGORY_INFO[state.activeCategory].label} 일정 탭으로 전환했습니다.`);
    }

    dom.planForm.addEventListener('submit', event => {
        event.preventDefault();
        const lines = parseLines(dom.planInput.value);
        if (!lines.length) {
            announce('새 라인에 넣을 계획을 한 줄 이상 입력해 주세요.');
            return;
        }

        const chain = state.plans.addChain(lines, state.activeCategory);
        if (!chain) return;

        state.historyOpen = false;
        const lineIndex = state.plans.getChains(state.activeCategory).indexOf(chain);
        const categoryLabel = CATEGORY_INFO[state.activeCategory].label;
        savePlans();
        state.categoryDrafts[state.activeCategory] = '';
        dom.planForm.reset();
        app.board.render();
        dom.planInput.focus();
        announce(`${categoryLabel} 라인 ${formatPosition(lineIndex)}에 ${lines.length}개의 계획을 연결했습니다.`);
    });

    dom.categoryTabs.forEach(tab => {
        tab.addEventListener('click', () => setActiveCategory(tab.dataset.category));
        tab.addEventListener('keydown', event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();

            let nextIndex;
            if (event.key === 'Home') {
                nextIndex = 0;
            } else if (event.key === 'End') {
                nextIndex = dom.categoryTabs.length - 1;
            } else {
                const direction = event.key === 'ArrowRight' ? 1 : -1;
                nextIndex = (dom.categoryTabs.indexOf(tab) + direction + dom.categoryTabs.length)
                    % dom.categoryTabs.length;
            }
            setActiveCategory(dom.categoryTabs[nextIndex].dataset.category);
        });
    });

    function setPlanControlsDisabled(disabled) {
        dom.planInput.disabled = disabled;
        dom.planForm.querySelector('button[type="submit"]').disabled = disabled;
        dom.routineToggle.disabled = disabled;
        [...dom.routineForm.elements].forEach(element => {
            element.disabled = disabled;
        });
    }

    async function initialize() {
        setPlanControlsDisabled(true);
        const localPlans = storage.loadPlans();
        const localRoutines = storage.loadRoutines();
        const [planResult, routineResult] = await Promise.all([
            window.AppBackend.loadUserData('plans', JSON.parse(localPlans.serialize())),
            window.AppBackend.loadUserData('routines', JSON.parse(localRoutines.serialize()))
        ]);

        try {
            state.plans = PlanCollection.fromJSON(JSON.stringify(planResult.data));
        } catch (error) {
            console.error('서버의 연결 계획 데이터를 읽지 못했습니다.', error);
            state.plans = localPlans;
        }
        try {
            state.routines = RoutineCollection.fromJSON(JSON.stringify(routineResult.data));
        } catch (error) {
            console.error('서버의 루틴 데이터를 읽지 못했습니다.', error);
            state.routines = localRoutines;
        }
        state.cloudUser = planResult.user || routineResult.user;

        if (planResult.mode === 'cloud') storage.clearLocalPlans();
        if (routineResult.mode === 'cloud') storage.clearLocalRoutines();

        setPlanControlsDisabled(false);
        app.board.render();
    }

    initialize();
})();
