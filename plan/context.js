// Shared page state, DOM references and helpers used by every plan UI module.
(function initializePlanContext() {
    const { PlanCollection, RoutineCollection } = window.PlanModel;

    const ELEMENT_IDS = [
        'planForm', 'planInput', 'composerTitle', 'inputHelp', 'submitLabel', 'planTitle',
        'planLines', 'categoryPanel', 'activePlans', 'emptyState', 'emptyTitle', 'emptyDescription',
        'progressText', 'progressTrack', 'progressBar', 'liveMessage',
        'personalTabCount', 'workTabCount',
        'historyPanel', 'historyList', 'historyEmpty', 'historyTitle', 'historyToggle', 'historyHint',
        'routineToggle', 'routineToggleIcon', 'routineLoadPanel', 'routineLoadCount',
        'routineLoadHelp', 'routineLoadEmpty', 'routineLoadList',
        'routineManagerTitle', 'routineManagerDescription', 'routineManagerCount',
        'routineManagerEmpty', 'routineManagerList',
        'routineForm', 'routineFormTitle', 'routineName', 'routineItems',
        'routineSubmitLabel', 'routineCancel'
    ];

    const dom = Object.freeze({
        ...Object.fromEntries(ELEMENT_IDS.map(id => [id, document.getElementById(id)])),
        planBoard: document.querySelector('.plan-board'),
        categoryTabs: [...document.querySelectorAll('.plan-tab')]
    });

    const state = {
        plans: PlanCollection.empty(),
        routines: RoutineCollection.empty(),
        activeCategory: window.PlanStorage.loadActiveCategory(),
        categoryDrafts: { personal: '', work: '' },
        cloudUser: null,
        openInsertKey: null,
        openEditKey: null,
        reorderPending: false,
        editingRoutineId: null,
        routinePanelOpen: false,
        historyOpen: false,
        historyDeletePending: false
    };

    function announce(message) {
        dom.liveMessage.textContent = '';
        window.setTimeout(() => {
            dom.liveMessage.textContent = message;
        }, 20);
    }

    function savePlans(options) {
        const result = window.PlanStorage.savePlans(state.plans, { ...options, cloud: Boolean(state.cloudUser) });
        if (result === false) announce('브라우저 저장 공간에 계획을 저장하지 못했습니다.');
        return result;
    }

    function saveRoutines() {
        const saved = window.PlanStorage.saveRoutines(state.routines, { cloud: Boolean(state.cloudUser) });
        if (!saved) announce('브라우저 저장 공간에 루틴을 저장하지 못했습니다.');
    }

    function parseLines(value) {
        return value
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(Boolean);
    }

    function formatPosition(index) {
        return String(index + 1).padStart(2, '0');
    }

    function getNodeKey(chainId, nodeId) {
        return `${chainId}--${nodeId}`;
    }

    function createActionButton(label, className, onClick) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = className;
        button.textContent = label;
        button.addEventListener('click', onClick);
        return button;
    }

    // UI modules register themselves here (board, routines, history) and call
    // each other through this object at event time, after every script has loaded.
    window.PlanApp = {
        dom,
        state,
        announce,
        savePlans,
        saveRoutines,
        parseLines,
        formatPosition,
        getNodeKey,
        createActionButton
    };
})();
