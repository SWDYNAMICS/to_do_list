// Browser storage and server persistence for plans and routines.
(function initializePlanStorage() {
    const { normalizeCategory, createId, LinkedPlan, PlanCollection, RoutineCollection } = window.PlanModel;

    const STORAGE_KEY = 'linkedPlans.v3';
    const PREVIOUS_STORAGE_KEY = 'linkedPlans.v2';
    const LEGACY_STORAGE_KEY = 'linkedPlan.v1';
    const ACTIVE_CATEGORY_KEY = 'linkedPlans.activeCategory.v1';
    const ROUTINE_STORAGE_KEY = 'linkedPlanRoutines.v1';
    const FITNESS_STORAGE_KEY = 'fitnessLog.v1';
    const TABS = ['personal', 'work', 'fitness'];

    function loadStoredCollection(storageKey, errorMessage) {
        try {
            const stored = localStorage.getItem(storageKey);
            if (stored) return PlanCollection.fromJSON(stored);
        } catch (error) {
            console.error(errorMessage, error);
        }
        return null;
    }

    function saveMigratedCollection(collection) {
        try {
            localStorage.setItem(STORAGE_KEY, collection.serialize());
        } catch (error) {
            console.error('이전 연결 계획의 저장 형식을 갱신하지 못했습니다.', error);
        }
        return collection;
    }

    function loadPlans() {
        const storedCollection = loadStoredCollection(
            STORAGE_KEY,
            '저장된 연결 리스트 라인을 불러오지 못했습니다.'
        );
        if (storedCollection) return storedCollection;

        const previousCollection = loadStoredCollection(
            PREVIOUS_STORAGE_KEY,
            '이전 연결 리스트 라인을 가져오지 못했습니다.'
        );
        if (previousCollection) return saveMigratedCollection(previousCollection);

        try {
            const legacyValue = localStorage.getItem(LEGACY_STORAGE_KEY);
            if (!legacyValue) return PlanCollection.empty();

            const legacyData = JSON.parse(legacyValue);
            const legacyChain = LinkedPlan.fromData({ ...legacyData, id: createId() });
            const collection = new PlanCollection(legacyChain ? [legacyChain] : []);

            return collection.chains.length ? saveMigratedCollection(collection) : collection;
        } catch (error) {
            console.error('이전 연결 계획을 가져오지 못했습니다.', error);
            return PlanCollection.empty();
        }
    }

    // Returns a Promise in cloud mode, otherwise whether the local write succeeded.
    function savePlans(plans, { cloud = false, ...options } = {}) {
        const serializedPlans = plans.serialize();
        if (cloud) {
            return window.AppBackend.saveUserData('plans', JSON.parse(serializedPlans), options);
        }

        try {
            localStorage.setItem(STORAGE_KEY, serializedPlans);
            return true;
        } catch (error) {
            console.error('연결 리스트 라인을 저장하지 못했습니다.', error);
            return false;
        }
    }

    function loadRoutines() {
        try {
            const stored = localStorage.getItem(ROUTINE_STORAGE_KEY);
            return stored ? RoutineCollection.fromJSON(stored) : RoutineCollection.empty();
        } catch (error) {
            console.error('저장된 루틴을 불러오지 못했습니다.', error);
            return RoutineCollection.empty();
        }
    }

    function saveRoutines(routines, { cloud = false } = {}) {
        const serializedRoutines = routines.serialize();
        if (cloud) {
            window.AppBackend.saveUserData('routines', JSON.parse(serializedRoutines));
            return true;
        }

        try {
            localStorage.setItem(ROUTINE_STORAGE_KEY, serializedRoutines);
            return true;
        } catch (error) {
            console.error('루틴을 저장하지 못했습니다.', error);
            return false;
        }
    }

    function loadFitness() {
        try {
            const stored = localStorage.getItem(FITNESS_STORAGE_KEY);
            return window.FitnessModel.FitnessLog.fromData(stored ? JSON.parse(stored) : null);
        } catch (error) {
            console.error('저장된 운동 기록을 불러오지 못했습니다.', error);
            return window.FitnessModel.FitnessLog.empty();
        }
    }

    // Returns a Promise in cloud mode, otherwise whether the local write succeeded.
    function saveFitness(log, { cloud = false } = {}) {
        const data = log.toData();
        if (cloud) return window.AppBackend.saveUserData('fitness', data);
        try {
            localStorage.setItem(FITNESS_STORAGE_KEY, JSON.stringify(data));
            return true;
        } catch (error) {
            console.error('운동 기록을 저장하지 못했습니다.', error);
            return false;
        }
    }

    function clearLocalFitness() {
        localStorage.removeItem(FITNESS_STORAGE_KEY);
    }

    // The stored tab may be the fitness tab; plan categories still fall back to personal.
    function loadActiveTab() {
        try {
            const stored = localStorage.getItem(ACTIVE_CATEGORY_KEY);
            return TABS.includes(stored) ? stored : 'personal';
        } catch (error) {
            return 'personal';
        }
    }

    function loadActiveCategory() {
        try {
            return normalizeCategory(localStorage.getItem(ACTIVE_CATEGORY_KEY));
        } catch (error) {
            console.error('선택한 일정 탭을 불러오지 못했습니다.', error);
            return 'personal';
        }
    }

    function saveActiveCategory(category) {
        try {
            localStorage.setItem(ACTIVE_CATEGORY_KEY, category);
        } catch (error) {
            console.error('선택한 일정 탭을 저장하지 못했습니다.', error);
        }
    }

    // Once the account data lives on the server, the local copies are no longer read.
    function clearLocalPlans() {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(PREVIOUS_STORAGE_KEY);
        localStorage.removeItem(LEGACY_STORAGE_KEY);
    }

    function clearLocalRoutines() {
        localStorage.removeItem(ROUTINE_STORAGE_KEY);
    }

    window.PlanStorage = Object.freeze({
        loadPlans,
        savePlans,
        loadRoutines,
        saveRoutines,
        loadActiveCategory,
        saveActiveCategory,
        clearLocalPlans,
        clearLocalRoutines,
        loadFitness,
        saveFitness,
        clearLocalFitness,
        loadActiveTab
    });
})();
