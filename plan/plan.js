// Page entry point: category tabs, the new-line composer and initial data loading.
(function initializePlanPage() {
    const app = window.PlanApp;
    const { dom, state, announce, savePlans, parseLines } = app;
    const { CATEGORY_INFO, normalizeCategory, normalizeChainName, PlanCollection, RoutineCollection } = window.PlanModel;
    const storage = window.PlanStorage;

    // Tabs are the two plan categories plus the workout log.
    function setActiveCategory(tab, { focusTab = true } = {}) {
        const showFitness = tab === 'fitness';
        const nextCategory = showFitness ? state.activeCategory : normalizeCategory(tab);
        const tabId = showFitness ? 'fitnessTab' : `${nextCategory}Tab`;
        if (showFitness === state.fitnessActive && nextCategory === state.activeCategory) {
            if (focusTab) document.getElementById(tabId)?.focus();
            return;
        }

        if (nextCategory !== state.activeCategory) {
            state.categoryDrafts[state.activeCategory] = dom.planInput.value;
            state.categoryNameDrafts[state.activeCategory] = dom.planName.value;
            state.activeCategory = nextCategory;
            dom.planInput.value = state.categoryDrafts[state.activeCategory];
            dom.planName.value = state.categoryNameDrafts[state.activeCategory];
        }
        state.fitnessActive = showFitness;
        state.historyOpen = false;
        app.closeOpenForms();
        state.routinePanelOpen = false;
        app.routines.resetForm();
        storage.saveActiveCategory(showFitness ? 'fitness' : state.activeCategory);
        app.board.render();
        app.fitness.render();

        if (focusTab) {
            window.requestAnimationFrame(() => {
                document.getElementById(tabId)?.focus();
            });
        }
        announce(showFitness ? '운동 기록 탭으로 전환했습니다.' : `${CATEGORY_INFO[state.activeCategory].label} 일정 탭으로 전환했습니다.`);
    }

    // A line left unnamed is named after the time it was made, e.g. "11월 28일 14:30".
    const pad = value => String(value).padStart(2, '0');
    const timeName = date => `${date.getMonth() + 1}월 ${date.getDate()}일 ${pad(date.getHours())}:${pad(date.getMinutes())}`;

    // Enter in the name field moves on to the steps instead of submitting an empty line.
    dom.planName.addEventListener('keydown', event => {
        if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229) return;
        event.preventDefault();
        dom.planInput.focus();
    });

    dom.planForm.addEventListener('submit', event => {
        event.preventDefault();
        const lines = parseLines(dom.planInput.value);
        if (!lines.length) {
            announce('새 라인에 넣을 계획을 한 줄 이상 입력해 주세요.');
            return;
        }

        const name = normalizeChainName(dom.planName.value) || timeName(new Date());
        const chain = state.plans.addChain(lines, state.activeCategory, name);
        if (!chain) return;

        state.historyOpen = false;
        savePlans();
        state.categoryDrafts[state.activeCategory] = '';
        state.categoryNameDrafts[state.activeCategory] = '';
        dom.planForm.reset();
        app.board.render();
        dom.planInput.focus();
        announce(`${name} 라인에 ${lines.length}개의 계획을 연결했습니다.`);
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
        dom.planName.disabled = disabled;
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
        const localFitness = storage.loadFitness();
        const [planResult, routineResult, fitnessResult] = await Promise.all([
            window.AppBackend.loadUserData('plans', JSON.parse(localPlans.serialize())),
            window.AppBackend.loadUserData('routines', JSON.parse(localRoutines.serialize())),
            window.AppBackend.loadUserData('fitness', localFitness.toData())
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
        try {
            state.fitness = window.FitnessModel.FitnessLog.fromData(fitnessResult.data);
        } catch (error) {
            console.error('서버의 운동 기록을 읽지 못했습니다.', error);
            state.fitness = localFitness;
        }
        state.cloudUser = planResult.user || routineResult.user || fitnessResult.user;
        if (fitnessResult.user) state.fitnessBase = JSON.parse(JSON.stringify(fitnessResult.data));

        if (planResult.mode === 'cloud') storage.clearLocalPlans();
        if (routineResult.mode === 'cloud') storage.clearLocalRoutines();
        if (fitnessResult.mode === 'cloud') storage.clearLocalFitness();

        setPlanControlsDisabled(false);
        app.board.render();
        app.fitness.ready();
        loaded = true;
    }

    // A phone tab can stay open for days. Without this, it would show old plans and its next
    // save would overwrite what another device saved meanwhile. Skipped while anything is being edited.
    let loaded = false;
    let refreshing = false;
    function isEditingPlans() {
        return Boolean(state.openInsertKey || state.openEditKey || state.openNoteKey || state.openNoteEditKey
            || state.reorderPending || state.historyDeletePending || state.editingRoutineId
            || window.AppBackend.hasPendingSave('plans') || window.AppBackend.hasPendingSave('routines'));
    }

    async function refreshPlans() {
        if (!loaded || refreshing || !state.cloudUser || document.hidden || isEditingPlans()) return;
        refreshing = true;
        const saveCount = state.saveCount;
        try {
            const [planResult, routineResult] = await Promise.all([
                window.AppBackend.loadUserData('plans', JSON.parse(state.plans.serialize())),
                window.AppBackend.loadUserData('routines', JSON.parse(state.routines.serialize()))
            ]);
            if (state.saveCount !== saveCount || isEditingPlans()) return;
            let changed = false;
            if (planResult.mode === 'cloud') {
                const plans = PlanCollection.fromJSON(JSON.stringify(planResult.data));
                if (plans.serialize() !== state.plans.serialize()) {
                    state.plans = plans;
                    changed = true;
                }
            }
            if (routineResult.mode === 'cloud') {
                const routines = RoutineCollection.fromJSON(JSON.stringify(routineResult.data));
                if (routines.serialize() !== state.routines.serialize()) {
                    state.routines = routines;
                    changed = true;
                }
            }
            if (changed) {
                app.board.render();
                announce('다른 기기에서 바뀐 계획을 불러왔습니다.');
            }
        } catch (error) {
            console.error('최신 계획을 불러오지 못했습니다.', error);
        } finally {
            refreshing = false;
        }
    }

    // The heading shows today's date; a tab left open overnight picks up the new day when it returns.
    const todayLabel = document.getElementById('todayLabel');
    function showToday() {
        const today = new Date();
        todayLabel.textContent = `${today.getMonth() + 1}월 ${today.getDate()}일 ${'일월화수목금토'[today.getDay()]}요일`;
    }
    showToday();

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) return;
        showToday();
        refreshPlans();
    });
    window.addEventListener('pageshow', event => { if (event.persisted) refreshPlans(); });

    initialize();
})();
