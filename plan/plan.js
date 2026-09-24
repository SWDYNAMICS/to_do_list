const STORAGE_KEY = 'linkedPlans.v3';
const PREVIOUS_STORAGE_KEY = 'linkedPlans.v2';
const LEGACY_STORAGE_KEY = 'linkedPlan.v1';
const ACTIVE_CATEGORY_KEY = 'linkedPlans.activeCategory.v1';
const ROUTINE_STORAGE_KEY = 'linkedPlanRoutines.v1';

const CATEGORY_INFO = Object.freeze({
    personal: {
        label: '개인',
        placeholder: '씻기\n밥 먹기\n산책 가기'
    },
    work: {
        label: '회사',
        placeholder: '메일 확인\n회의 준비\n업무 보고'
    }
});

function normalizeCategory(value) {
    return Object.prototype.hasOwnProperty.call(CATEGORY_INFO, value) ? value : 'personal';
}

function createId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isValidId(value) {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
}

class LinkedPlan {
    constructor(id = createId(), head = null, nodes = [], category = 'personal') {
        this.id = isValidId(id) ? id : createId();
        this.head = head;
        this.category = normalizeCategory(category);
        this.nodes = new Map(nodes.map(node => [node.id, node]));
        this.repairLinks();
    }

    static fromData(data) {
        if (!data || !Array.isArray(data.nodes)) return null;

        const seenIds = new Set();
        const nodes = data.nodes
            .filter(node => {
                const hasValidShape = node
                    && isValidId(node.id)
                    && typeof node.text === 'string'
                    && Boolean(node.text.trim())
                    && !seenIds.has(node.id);

                if (hasValidShape) seenIds.add(node.id);
                return hasValidShape;
            })
            .map(node => ({
                id: node.id,
                text: node.text.trim(),
                completed: Boolean(node.completed),
                next: isValidId(node.next) ? node.next : null
            }));

        const head = isValidId(data.head) ? data.head : null;
        return new LinkedPlan(data.id, head, nodes, data.category);
    }

    createNode(text) {
        let id;
        do {
            id = createId();
        } while (this.nodes.has(id));

        return {
            id,
            text: text.trim(),
            completed: false,
            next: null
        };
    }

    appendMany(texts) {
        const validTexts = texts.map(text => text.trim()).filter(Boolean);
        if (!validTexts.length) return [];

        let previous = this.getTail();
        const created = [];

        validTexts.forEach(text => {
            const node = this.createNode(text);
            this.nodes.set(node.id, node);

            if (previous) {
                previous.next = node.id;
            } else {
                this.head = node.id;
            }

            previous = node;
            created.push(node);
        });

        return created;
    }

    insertAfter(nodeId, text) {
        const previous = this.nodes.get(nodeId);
        const cleanText = text.trim();
        if (!previous || !cleanText) return null;

        const node = this.createNode(cleanText);
        node.next = previous.next;
        previous.next = node.id;
        this.nodes.set(node.id, node);
        return node;
    }

    remove(nodeId) {
        const target = this.nodes.get(nodeId);
        if (!target) return null;

        if (this.head === nodeId) {
            this.head = target.next;
        } else {
            const previous = this.findPrevious(nodeId);
            if (!previous) return null;
            previous.next = target.next;
        }

        this.nodes.delete(nodeId);
        return target;
    }

    toggle(nodeId) {
        const node = this.nodes.get(nodeId);
        if (!node) return null;
        node.completed = !node.completed;
        return node;
    }

    updateText(nodeId, text) {
        const node = this.nodes.get(nodeId);
        const cleanText = text.trim();
        if (!node || !cleanText) return null;

        const previousText = node.text;
        node.text = cleanText;
        return { node, previousText };
    }

    findPrevious(nodeId) {
        let current = this.head ? this.nodes.get(this.head) : null;
        const visited = new Set();

        while (current && !visited.has(current.id)) {
            if (current.next === nodeId) return current;
            visited.add(current.id);
            current = current.next ? this.nodes.get(current.next) : null;
        }

        return null;
    }

    getTail() {
        let current = this.head ? this.nodes.get(this.head) : null;
        if (!current) return null;

        const visited = new Set();
        while (current.next && this.nodes.has(current.next) && !visited.has(current.next)) {
            visited.add(current.id);
            current = this.nodes.get(current.next);
        }
        return current;
    }

    toArray() {
        const result = [];
        const visited = new Set();
        let current = this.head ? this.nodes.get(this.head) : null;

        while (current && !visited.has(current.id)) {
            result.push(current);
            visited.add(current.id);
            current = current.next ? this.nodes.get(current.next) : null;
        }

        return result;
    }

    repairLinks() {
        if (!this.nodes.size) {
            this.head = null;
            return;
        }

        if (!this.head || !this.nodes.has(this.head)) {
            this.head = this.nodes.keys().next().value;
        }

        const reachable = new Set();
        let current = this.nodes.get(this.head);

        while (current && !reachable.has(current.id)) {
            reachable.add(current.id);

            if (current.next && (!this.nodes.has(current.next) || reachable.has(current.next))) {
                current.next = null;
            }

            current = current.next ? this.nodes.get(current.next) : null;
        }

        for (const id of this.nodes.keys()) {
            if (!reachable.has(id)) this.nodes.delete(id);
        }
    }

    toData() {
        return {
            id: this.id,
            head: this.head,
            category: this.category,
            nodes: this.toArray()
        };
    }
}

class PlanCollection {
    constructor(chains = []) {
        this.chains = chains.filter(chain => chain.toArray().length > 0);
        this.ensureUniqueIds();
    }

    static empty() {
        return new PlanCollection();
    }

    static fromJSON(value) {
        const data = JSON.parse(value);
        if (!data || !Array.isArray(data.chains)) return PlanCollection.empty();

        const chains = data.chains
            .map(chain => LinkedPlan.fromData(chain))
            .filter(Boolean);
        return new PlanCollection(chains);
    }

    ensureUniqueIds() {
        const usedIds = new Set();
        this.chains.forEach(chain => {
            while (usedIds.has(chain.id)) chain.id = createId();
            usedIds.add(chain.id);
        });
    }

    addChain(texts, category = 'personal') {
        let id;
        do {
            id = createId();
        } while (this.chains.some(chain => chain.id === id));

        const chain = new LinkedPlan(id, null, [], category);
        chain.appendMany(texts);
        if (!chain.toArray().length) return null;

        this.chains.push(chain);
        return chain;
    }

    findChain(chainId) {
        return this.chains.find(chain => chain.id === chainId) || null;
    }

    removeChain(chainId) {
        const index = this.chains.findIndex(chain => chain.id === chainId);
        if (index < 0) return null;
        return this.chains.splice(index, 1)[0];
    }

    getChains(category) {
        const normalizedCategory = normalizeCategory(category);
        return this.chains.filter(chain => chain.category === normalizedCategory);
    }

    getAllNodes(category = null) {
        const chains = category ? this.getChains(category) : this.chains;
        return chains.flatMap(chain => chain.toArray());
    }

    serialize() {
        return JSON.stringify({
            version: 3,
            chains: this.chains.map(chain => chain.toData())
        });
    }
}

class RoutineCollection {
    constructor(routines = []) {
        const usedIds = new Set();
        this.routines = routines
            .map(routine => RoutineCollection.normalize(routine, usedIds))
            .filter(Boolean);
    }

    static empty() {
        return new RoutineCollection();
    }

    static fromJSON(value) {
        const data = JSON.parse(value);
        if (!data || !Array.isArray(data.routines)) return RoutineCollection.empty();
        return new RoutineCollection(data.routines);
    }

    static normalize(routine, usedIds = new Set()) {
        if (!routine || typeof routine.name !== 'string' || !Array.isArray(routine.items)) {
            return null;
        }

        const name = routine.name.trim();
        const items = routine.items
            .filter(item => typeof item === 'string')
            .map(item => item.trim())
            .filter(Boolean);
        if (!name || !items.length) return null;

        let id = isValidId(routine.id) ? routine.id : createId();
        while (usedIds.has(id)) id = createId();
        usedIds.add(id);

        return {
            id,
            name,
            items,
            category: normalizeCategory(routine.category),
            updatedAt: typeof routine.updatedAt === 'string'
                ? routine.updatedAt
                : new Date().toISOString()
        };
    }

    add(name, items, category) {
        const routine = RoutineCollection.normalize({
            id: createId(),
            name,
            items,
            category,
            updatedAt: new Date().toISOString()
        }, new Set(this.routines.map(item => item.id)));
        if (!routine) return null;

        this.routines.unshift(routine);
        return routine;
    }

    update(routineId, name, items) {
        const routine = this.find(routineId);
        const cleanName = name.trim();
        const cleanItems = items.map(item => item.trim()).filter(Boolean);
        if (!routine || !cleanName || !cleanItems.length) return null;

        routine.name = cleanName;
        routine.items = cleanItems;
        routine.updatedAt = new Date().toISOString();
        return routine;
    }

    remove(routineId) {
        const index = this.routines.findIndex(routine => routine.id === routineId);
        if (index < 0) return null;
        return this.routines.splice(index, 1)[0];
    }

    find(routineId) {
        return this.routines.find(routine => routine.id === routineId) || null;
    }

    getByCategory(category) {
        const normalizedCategory = normalizeCategory(category);
        return this.routines.filter(routine => routine.category === normalizedCategory);
    }

    serialize() {
        return JSON.stringify({
            version: 1,
            routines: this.routines
        });
    }
}

const planForm = document.getElementById('planForm');
const planInput = document.getElementById('planInput');
const composerTitle = document.getElementById('composerTitle');
const inputHelp = document.getElementById('inputHelp');
const submitLabel = document.getElementById('submitLabel');
const planTitle = document.getElementById('planTitle');
const planLines = document.getElementById('planLines');
const emptyState = document.getElementById('emptyState');
const emptyTitle = document.getElementById('emptyTitle');
const emptyDescription = document.getElementById('emptyDescription');
const progressText = document.getElementById('progressText');
const progressTrack = document.getElementById('progressTrack');
const progressBar = document.getElementById('progressBar');
const liveMessage = document.getElementById('liveMessage');
const categoryTabs = [...document.querySelectorAll('.plan-tab')];
const personalTabCount = document.getElementById('personalTabCount');
const workTabCount = document.getElementById('workTabCount');
const routineToggle = document.getElementById('routineToggle');
const routineToggleIcon = document.getElementById('routineToggleIcon');
const routineLoadPanel = document.getElementById('routineLoadPanel');
const routineLoadCount = document.getElementById('routineLoadCount');
const routineLoadHelp = document.getElementById('routineLoadHelp');
const routineLoadEmpty = document.getElementById('routineLoadEmpty');
const routineLoadList = document.getElementById('routineLoadList');
const routineManagerTitle = document.getElementById('routineManagerTitle');
const routineManagerDescription = document.getElementById('routineManagerDescription');
const routineForm = document.getElementById('routineForm');
const routineFormTitle = document.getElementById('routineFormTitle');
const routineName = document.getElementById('routineName');
const routineItems = document.getElementById('routineItems');
const routineSubmitLabel = document.getElementById('routineSubmitLabel');
const routineCancel = document.getElementById('routineCancel');
const routineManagerCount = document.getElementById('routineManagerCount');
const routineManagerEmpty = document.getElementById('routineManagerEmpty');
const routineManagerList = document.getElementById('routineManagerList');

let plans = PlanCollection.empty();
let routines = RoutineCollection.empty();
let activeCategory = loadActiveCategory();
let openInsertKey = null;
let openEditKey = null;
let cloudUser = null;
let editingRoutineId = null;
let routinePanelOpen = false;
const categoryDrafts = { personal: '', work: '' };

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

function loadActiveCategory() {
    try {
        return normalizeCategory(localStorage.getItem(ACTIVE_CATEGORY_KEY));
    } catch (error) {
        console.error('선택한 일정 탭을 불러오지 못했습니다.', error);
        return 'personal';
    }
}

function saveActiveCategory() {
    try {
        localStorage.setItem(ACTIVE_CATEGORY_KEY, activeCategory);
    } catch (error) {
        console.error('선택한 일정 탭을 저장하지 못했습니다.', error);
    }
}

function savePlans() {
    const serializedPlans = plans.serialize();
    if (cloudUser) {
        window.AppBackend.saveUserData('plans', JSON.parse(serializedPlans));
        return;
    }

    try {
        localStorage.setItem(STORAGE_KEY, serializedPlans);
    } catch (error) {
        console.error('연결 리스트 라인을 저장하지 못했습니다.', error);
        announce('브라우저 저장 공간에 계획을 저장하지 못했습니다.');
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

function saveRoutines() {
    const serializedRoutines = routines.serialize();
    if (cloudUser) {
        window.AppBackend.saveUserData('routines', JSON.parse(serializedRoutines));
        return;
    }

    try {
        localStorage.setItem(ROUTINE_STORAGE_KEY, serializedRoutines);
    } catch (error) {
        console.error('루틴을 저장하지 못했습니다.', error);
        announce('브라우저 저장 공간에 루틴을 저장하지 못했습니다.');
    }
}

function announce(message) {
    liveMessage.textContent = '';
    window.setTimeout(() => {
        liveMessage.textContent = message;
    }, 20);
}

function updateCategoryUI() {
    const info = CATEGORY_INFO[activeCategory];
    const categoryCounts = {
        personal: plans.getChains('personal').length,
        work: plans.getChains('work').length
    };

    categoryTabs.forEach(tab => {
        const isActive = tab.dataset.category === activeCategory;
        tab.classList.toggle('is-active', isActive);
        tab.setAttribute('aria-selected', String(isActive));
        tab.tabIndex = isActive ? 0 : -1;
    });

    personalTabCount.textContent = String(categoryCounts.personal);
    workTabCount.textContent = String(categoryCounts.work);
    composerTitle.textContent = `새 ${info.label} 계획 라인 만들기`;
    inputHelp.textContent = `${info.label} 일정의 각 단계를 한 줄씩 입력하면 새 연결 리스트 한 개가 됩니다.`;
    submitLabel.textContent = `${info.label} 라인 만들기`;
    planInput.placeholder = info.placeholder;
    planTitle.textContent = `${info.label} 연결 리스트`;
    emptyTitle.textContent = `아직 ${info.label} 계획 라인이 없어요.`;
    emptyDescription.textContent = `위 입력창에서 첫 번째 ${info.label} 계획을 만들어 보세요.`;
    planLines.setAttribute('aria-labelledby', `${activeCategory}Tab`);
}

function setActiveCategory(category, { focusTab = true } = {}) {
    const nextCategory = normalizeCategory(category);
    if (nextCategory === activeCategory) {
        if (focusTab) document.getElementById(`${nextCategory}Tab`)?.focus();
        return;
    }

    categoryDrafts[activeCategory] = planInput.value;
    activeCategory = nextCategory;
    planInput.value = categoryDrafts[activeCategory];
    openInsertKey = null;
    openEditKey = null;
    routinePanelOpen = false;
    resetRoutineForm();
    saveActiveCategory();
    renderPlans();

    if (focusTab) {
        window.requestAnimationFrame(() => {
            document.getElementById(`${activeCategory}Tab`)?.focus();
        });
    }
    announce(`${CATEGORY_INFO[activeCategory].label} 일정 탭으로 전환했습니다.`);
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

function loadRoutineAsPlan(routineId) {
    const routine = routines.find(routineId);
    if (!routine) return;

    const chain = plans.addChain(routine.items, activeCategory);
    if (!chain) return;

    savePlans();
    routinePanelOpen = false;
    renderPlans({ focusChainId: chain.id });
    announce(`${routine.name} 루틴을 새 ${CATEGORY_INFO[activeCategory].label} 계획 라인으로 불러왔습니다.`);
}

function editRoutine(routineId) {
    const routine = routines.find(routineId);
    if (!routine) return;

    editingRoutineId = routine.id;
    routineName.value = routine.name;
    routineItems.value = routine.items.join('\n');
    renderRoutineUI();
    routineForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.requestAnimationFrame(() => {
        routineName.focus();
        routineName.select();
    });
    announce(`${routine.name} 루틴 수정 화면을 열었습니다.`);
}

function deleteRoutine(routineId) {
    const removed = routines.remove(routineId);
    if (!removed) return;

    if (editingRoutineId === routineId) resetRoutineForm();
    saveRoutines();
    renderRoutineUI();
    announce(`${removed.name} 루틴을 삭제했습니다.`);
}

function resetRoutineForm({ focus = false } = {}) {
    editingRoutineId = null;
    routineForm.reset();
    routineName.setCustomValidity('');
    routineItems.setCustomValidity('');
    renderRoutineUI();
    if (focus) routineName.focus();
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
    kicker.textContent = `${routine.items.length} ELEMENTS`;
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

function renderRoutineUI() {
    const info = CATEGORY_INFO[activeCategory];
    const categoryRoutines = routines.getByCategory(activeCategory);
    const editingRoutine = editingRoutineId ? routines.find(editingRoutineId) : null;

    routineLoadCount.textContent = String(categoryRoutines.length);
    routineToggle.setAttribute('aria-expanded', String(routinePanelOpen));
    routineToggleIcon.textContent = routinePanelOpen ? '−' : '＋';
    routineLoadPanel.hidden = !routinePanelOpen;
    routineLoadHelp.textContent = `${info.label} 루틴을 선택하면 새 계획 라인으로 복사됩니다.`;
    routineLoadEmpty.textContent = `저장된 ${info.label} 루틴이 없습니다.`;
    routineLoadEmpty.hidden = categoryRoutines.length > 0;
    routineLoadList.replaceChildren(...categoryRoutines.map(createRoutineLoadCard));

    routineManagerTitle.textContent = `${info.label} 루틴 저장소`;
    routineManagerDescription.textContent = `반복해서 사용하는 ${info.label} 계획을 루틴으로 저장하고 필요할 때 불러오세요.`;
    routineManagerCount.textContent = `${categoryRoutines.length}개`;
    routineManagerEmpty.textContent = `아직 저장된 ${info.label} 루틴이 없습니다.`;
    routineManagerEmpty.hidden = categoryRoutines.length > 0;
    routineManagerList.replaceChildren(...categoryRoutines.map(createRoutineManagerCard));

    routineFormTitle.textContent = editingRoutine
        ? `${editingRoutine.name} 루틴 수정`
        : `새 ${info.label} 루틴 만들기`;
    routineSubmitLabel.textContent = editingRoutine
        ? '수정 내용 저장'
        : `${info.label} 루틴 저장`;
    routineName.placeholder = activeCategory === 'personal' ? '예: 아침 준비' : '예: 업무 시작';
    routineItems.placeholder = info.placeholder;
    routineCancel.hidden = !editingRoutine;
}

function createActionButton(label, className, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = label;
    button.addEventListener('click', onClick);
    return button;
}

function createInsertForm(chain, node, lineIndex) {
    const key = getNodeKey(chain.id, node.id);
    const form = document.createElement('form');
    form.className = 'insert-form';
    form.id = `insert-form-${key}`;

    const inputId = `insert-${key}`;
    const label = document.createElement('label');
    label.className = 'visually-hidden';
    label.htmlFor = inputId;
    label.textContent = `${node.text} 뒤에 추가할 계획`;

    const input = document.createElement('input');
    input.id = inputId;
    input.className = 'insert-input';
    input.type = 'text';
    input.maxLength = 120;
    input.placeholder = '뒤에 넣을 계획';
    input.required = true;
    input.addEventListener('input', () => input.setCustomValidity(''));

    const submitButton = document.createElement('button');
    submitButton.type = 'submit';
    submitButton.className = 'insert-submit';
    submitButton.textContent = '연결하기';

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'insert-cancel';
    cancelButton.textContent = '취소';
    cancelButton.addEventListener('click', () => {
        openInsertKey = null;
        renderPlans({ focusActionKey: key });
    });

    form.addEventListener('submit', event => {
        event.preventDefault();
        const cleanText = input.value.trim();
        if (!cleanText) {
            input.setCustomValidity('계획 내용을 입력해 주세요.');
            input.reportValidity();
            announce('추가할 계획 내용을 입력해 주세요.');
            return;
        }

        const inserted = chain.insertAfter(node.id, cleanText);
        if (!inserted) return;

        savePlans();
        openInsertKey = null;
        renderPlans({ focusNodeKey: getNodeKey(chain.id, inserted.id) });
        announce(`라인 ${formatPosition(lineIndex)}에서 ${inserted.text} 계획을 ${node.text} 뒤에 연결했습니다.`);
    });

    form.append(label, input, submitButton, cancelButton);
    window.requestAnimationFrame(() => input.focus());
    return form;
}

function createEditForm(chain, node) {
    const key = getNodeKey(chain.id, node.id);
    const form = document.createElement('form');
    form.className = 'edit-form';
    form.id = `edit-form-${key}`;

    const inputId = `edit-${key}`;
    const label = document.createElement('label');
    label.className = 'visually-hidden';
    label.htmlFor = inputId;
    label.textContent = `${node.text} 계획 내용 수정`;

    const input = document.createElement('input');
    input.id = inputId;
    input.className = 'edit-input';
    input.type = 'text';
    input.maxLength = 120;
    input.required = true;
    input.value = node.text;
    input.addEventListener('input', () => input.setCustomValidity(''));

    const submitButton = document.createElement('button');
    submitButton.type = 'submit';
    submitButton.className = 'edit-submit';
    submitButton.textContent = '저장';

    const closeEditor = () => {
        openEditKey = null;
        renderPlans({ focusEditKey: key });
    };

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'edit-cancel';
    cancelButton.textContent = '취소';
    cancelButton.addEventListener('click', closeEditor);

    input.addEventListener('keydown', event => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        closeEditor();
    });

    form.addEventListener('submit', event => {
        event.preventDefault();
        const cleanText = input.value.trim();
        if (!cleanText) {
            input.setCustomValidity('계획 내용을 입력해 주세요.');
            input.reportValidity();
            announce('수정할 계획 내용을 입력해 주세요.');
            return;
        }

        const updated = chain.updateText(node.id, cleanText);
        if (!updated) return;

        savePlans();
        openEditKey = null;
        renderPlans({ focusEditKey: key });
        announce(`'${updated.previousText}' 계획을 '${updated.node.text}'(으)로 수정했습니다.`);
    });

    form.append(label, input, submitButton, cancelButton);
    window.requestAnimationFrame(() => {
        input.focus();
        input.select();
    });
    return form;
}

function createPlanNode(chain, node, nodeIndex, positions, lineIndex) {
    const key = getNodeKey(chain.id, node.id);
    const item = document.createElement('li');
    item.className = `plan-node${node.completed ? ' is-complete' : ''}`;

    const card = document.createElement('article');
    card.className = 'node-card';
    card.id = `plan-node-${key}`;
    card.tabIndex = -1;

    const meta = document.createElement('div');
    meta.className = 'node-meta';

    const position = document.createElement('span');
    position.textContent = `ELEMENT ${formatPosition(nodeIndex)}`;

    const pointer = document.createElement('span');
    pointer.className = 'node-pointer';
    pointer.textContent = node.next
        ? `NEXT → ${formatPosition(positions.get(node.next))}`
        : 'NEXT → END';
    meta.append(position, pointer);

    const content = document.createElement('div');
    content.className = 'node-content';

    const checkLabel = document.createElement('label');
    checkLabel.className = 'node-check-label';

    const checkbox = document.createElement('input');
    checkbox.id = `toggle-${key}`;
    checkbox.className = 'complete-toggle';
    checkbox.type = 'checkbox';
    checkbox.checked = node.completed;
    checkbox.setAttribute('aria-label', `${node.text} 완료 상태`);
    checkbox.addEventListener('change', () => {
        const changed = chain.toggle(node.id);
        if (!changed) return;
        savePlans();
        renderPlans({ focusCheckboxKey: key });
        announce(`${node.text} 계획을 ${changed.completed ? '완료' : '진행 전'} 상태로 변경했습니다.`);
    });

    const copy = document.createElement('span');
    copy.className = 'node-copy';

    const title = document.createElement('strong');
    title.className = 'node-title';
    title.textContent = node.text;

    const status = document.createElement('span');
    status.className = 'node-status';
    status.textContent = node.completed ? '완료됨' : '진행 전';

    copy.append(title, status);
    checkLabel.append(checkbox, copy);

    const actions = document.createElement('div');
    actions.className = 'node-actions';

    const editButton = createActionButton(
        '수정',
        'action-button edit-button',
        () => {
            openInsertKey = null;
            openEditKey = openEditKey === key ? null : key;
            renderPlans({ focusEditKey: openEditKey ? null : key });
        }
    );
    editButton.id = `edit-action-${key}`;
    editButton.setAttribute('aria-expanded', String(openEditKey === key));
    if (openEditKey === key) {
        editButton.setAttribute('aria-controls', `edit-form-${key}`);
    }
    editButton.setAttribute('aria-label', `${node.text} 계획 수정`);

    const insertButton = createActionButton(
        '뒤에 추가',
        'action-button insert-button',
        () => {
            openEditKey = null;
            openInsertKey = openInsertKey === key ? null : key;
            renderPlans({ focusActionKey: openInsertKey ? null : key });
        }
    );
    insertButton.id = `insert-action-${key}`;
    insertButton.setAttribute('aria-expanded', String(openInsertKey === key));
    if (openInsertKey === key) {
        insertButton.setAttribute('aria-controls', `insert-form-${key}`);
    }
    insertButton.setAttribute('aria-label', `${node.text} 뒤에 계획 추가`);

    const deleteButton = createActionButton(
        '삭제',
        'action-button delete-button',
        () => {
            const categoryChains = plans.getChains(chain.category);
            const chainIndex = categoryChains.findIndex(itemChain => itemChain.id === chain.id);
            const nextFocusNodeId = node.next || chain.findPrevious(node.id)?.id || null;
            const removed = chain.remove(node.id);
            if (!removed) return;

            let focusNodeKey = nextFocusNodeId
                ? getNodeKey(chain.id, nextFocusNodeId)
                : null;
            let focusChainId = null;

            if (!chain.toArray().length) {
                plans.removeChain(chain.id);
                const remainingChains = plans.getChains(chain.category);
                focusNodeKey = null;
                focusChainId = remainingChains[chainIndex]?.id
                    || remainingChains[chainIndex - 1]?.id
                    || null;
            }

            if (openInsertKey === key) openInsertKey = null;
            if (openEditKey === key) openEditKey = null;
            savePlans();
            renderPlans({
                focusNodeKey,
                focusChainId,
                focusInput: !focusNodeKey && !focusChainId
            });
            announce(`${removed.text} 계획을 삭제했습니다.`);
        }
    );
    deleteButton.setAttribute('aria-label', `${node.text} 계획 삭제`);

    actions.append(editButton, insertButton, deleteButton);
    content.append(checkLabel, actions);
    card.append(meta, content);

    if (openEditKey === key) {
        card.appendChild(createEditForm(chain, node));
    }

    if (openInsertKey === key) {
        card.appendChild(createInsertForm(chain, node, lineIndex));
    }

    item.appendChild(card);
    return item;
}

function createChainSection(chain, lineIndex) {
    const nodes = chain.toArray();
    const positions = new Map(nodes.map((node, index) => [node.id, index]));
    const completed = nodes.filter(node => node.completed).length;

    const section = document.createElement('section');
    section.className = 'chain-group';
    section.id = `chain-${chain.id}`;
    section.tabIndex = -1;
    section.setAttribute('aria-labelledby', `chain-title-${chain.id}`);

    const heading = document.createElement('div');
    heading.className = 'chain-heading';

    const titleGroup = document.createElement('div');
    titleGroup.className = 'chain-title-group';

    const kicker = document.createElement('span');
    kicker.className = 'chain-kicker';
    kicker.textContent = `LINKED LIST ${formatPosition(lineIndex)}`;

    const title = document.createElement('h3');
    title.id = `chain-title-${chain.id}`;
    title.className = 'chain-title';
    title.textContent = `라인 ${formatPosition(lineIndex)}`;
    titleGroup.append(kicker, title);

    const headingActions = document.createElement('div');
    headingActions.className = 'chain-heading-actions';

    const count = document.createElement('span');
    count.className = 'chain-count';
    count.textContent = `${completed} / ${nodes.length} 완료`;

    const deleteChainButton = createActionButton(
        '라인 전체 삭제',
        'delete-chain-button',
        () => {
            const categoryChains = plans.getChains(chain.category);
            const currentIndex = categoryChains.findIndex(itemChain => itemChain.id === chain.id);
            const removed = plans.removeChain(chain.id);
            if (!removed) return;

            const remainingChains = plans.getChains(chain.category);
            const nextFocusId = remainingChains[currentIndex]?.id
                || remainingChains[currentIndex - 1]?.id
                || null;

            if (openInsertKey?.startsWith(`${chain.id}--`)) openInsertKey = null;
            if (openEditKey?.startsWith(`${chain.id}--`)) openEditKey = null;
            savePlans();
            renderPlans({ focusChainId: nextFocusId, focusInput: !nextFocusId });
            announce(`라인 ${formatPosition(lineIndex)} 전체를 삭제했습니다.`);
        }
    );
    deleteChainButton.setAttribute('aria-label', `라인 ${formatPosition(lineIndex)} 전체 삭제`);

    headingActions.append(count, deleteChainButton);
    heading.append(titleGroup, headingActions);

    const viewport = document.createElement('div');
    viewport.className = 'chain-viewport';
    viewport.tabIndex = 0;
    viewport.setAttribute('role', 'region');
    viewport.setAttribute('aria-label', `라인 ${formatPosition(lineIndex)} 가로 연결 목록`);

    const scrollHint = document.createElement('p');
    scrollHint.className = 'scroll-hint';
    scrollHint.textContent = '좌우로 밀어 연결된 엘리먼트를 확인하세요. ↔';

    const list = document.createElement('ol');
    list.className = 'plan-list';
    list.setAttribute('role', 'list');
    nodes.forEach((node, nodeIndex) => {
        list.appendChild(createPlanNode(chain, node, nodeIndex, positions, lineIndex));
    });

    viewport.appendChild(list);
    section.append(heading, scrollHint, viewport);
    return section;
}

function updateProgress(chains) {
    const nodes = chains.flatMap(chain => chain.toArray());
    const completed = nodes.filter(node => node.completed).length;
    const total = nodes.length;
    const percentage = total ? Math.round((completed / total) * 100) : 0;
    const categoryLabel = CATEGORY_INFO[activeCategory].label;

    progressText.textContent = `${chains.length}개 라인 · ${completed} / ${total} 완료`;
    progressBar.style.width = `${percentage}%`;
    progressTrack.setAttribute('aria-valuenow', String(percentage));
    progressTrack.setAttribute(
        'aria-valuetext',
        `${categoryLabel} 일정 ${chains.length}개 라인, ${total}개 중 ${completed}개 완료`
    );
}

function renderPlans(focusTarget = {}) {
    const categoryChains = plans.getChains(activeCategory);
    updateCategoryUI();
    renderRoutineUI();
    planLines.replaceChildren();
    categoryChains.forEach((chain, index) => {
        planLines.appendChild(createChainSection(chain, index));
    });

    emptyState.hidden = categoryChains.length > 0;
    updateProgress(categoryChains);

    window.requestAnimationFrame(() => {
        if (focusTarget.focusNodeKey) {
            document.getElementById(`plan-node-${focusTarget.focusNodeKey}`)?.focus();
        } else if (focusTarget.focusCheckboxKey) {
            document.getElementById(`toggle-${focusTarget.focusCheckboxKey}`)?.focus();
        } else if (focusTarget.focusActionKey) {
            document.getElementById(`insert-action-${focusTarget.focusActionKey}`)?.focus();
        } else if (focusTarget.focusEditKey) {
            document.getElementById(`edit-action-${focusTarget.focusEditKey}`)?.focus();
        } else if (focusTarget.focusChainId) {
            document.getElementById(`chain-${focusTarget.focusChainId}`)?.focus();
        } else if (focusTarget.focusInput) {
            planInput.focus();
        }
    });
}

planForm.addEventListener('submit', event => {
    event.preventDefault();
    const lines = parseLines(planInput.value);
    if (!lines.length) {
        announce('새 라인에 넣을 계획을 한 줄 이상 입력해 주세요.');
        return;
    }

    const chain = plans.addChain(lines, activeCategory);
    if (!chain) return;

    const lineNumber = plans.getChains(activeCategory).length;
    const categoryLabel = CATEGORY_INFO[activeCategory].label;
    savePlans();
    categoryDrafts[activeCategory] = '';
    planForm.reset();
    renderPlans();
    planInput.focus();
    announce(`${categoryLabel} 라인 ${formatPosition(lineNumber - 1)}에 ${lines.length}개의 계획을 연결했습니다.`);
});

routineToggle.addEventListener('click', () => {
    routinePanelOpen = !routinePanelOpen;
    renderRoutineUI();
    if (routinePanelOpen) {
        window.requestAnimationFrame(() => {
            routineLoadPanel.querySelector('button')?.focus();
        });
    }
});

routineName.addEventListener('input', () => routineName.setCustomValidity(''));
routineItems.addEventListener('input', () => routineItems.setCustomValidity(''));

routineForm.addEventListener('submit', event => {
    event.preventDefault();
    const name = routineName.value.trim();
    const items = parseLines(routineItems.value);

    if (!name) {
        routineName.setCustomValidity('루틴 이름을 입력해 주세요.');
        routineName.reportValidity();
        return;
    }
    if (!items.length) {
        routineItems.setCustomValidity('루틴 엘리먼트를 한 줄 이상 입력해 주세요.');
        routineItems.reportValidity();
        return;
    }

    if (editingRoutineId) {
        const updated = routines.update(editingRoutineId, name, items);
        if (!updated) return;
        saveRoutines();
        resetRoutineForm();
        announce(`${updated.name} 루틴의 수정 내용을 저장했습니다.`);
        return;
    }

    const routine = routines.add(name, items, activeCategory);
    if (!routine) return;
    saveRoutines();
    resetRoutineForm({ focus: true });
    announce(`${routine.name} 루틴을 ${CATEGORY_INFO[activeCategory].label} 루틴 저장소에 추가했습니다.`);
});

routineCancel.addEventListener('click', () => {
    resetRoutineForm({ focus: true });
    announce('루틴 수정을 취소했습니다.');
});

categoryTabs.forEach(tab => {
    tab.addEventListener('click', () => setActiveCategory(tab.dataset.category));
    tab.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();

        let nextIndex;
        if (event.key === 'Home') {
            nextIndex = 0;
        } else if (event.key === 'End') {
            nextIndex = categoryTabs.length - 1;
        } else {
            const direction = event.key === 'ArrowRight' ? 1 : -1;
            nextIndex = (categoryTabs.indexOf(tab) + direction + categoryTabs.length)
                % categoryTabs.length;
        }
        setActiveCategory(categoryTabs[nextIndex].dataset.category);
    });
});

function setPlanControlsDisabled(disabled) {
    planInput.disabled = disabled;
    planForm.querySelector('button[type="submit"]').disabled = disabled;
    routineToggle.disabled = disabled;
    [...routineForm.elements].forEach(element => {
        element.disabled = disabled;
    });
}

async function initializePlans() {
    setPlanControlsDisabled(true);
    const localPlans = loadPlans();
    const localRoutines = loadRoutines();
    const [planResult, routineResult] = await Promise.all([
        window.AppBackend.loadUserData('plans', JSON.parse(localPlans.serialize())),
        window.AppBackend.loadUserData('routines', JSON.parse(localRoutines.serialize()))
    ]);

    try {
        plans = PlanCollection.fromJSON(JSON.stringify(planResult.data));
    } catch (error) {
        console.error('서버의 연결 계획 데이터를 읽지 못했습니다.', error);
        plans = localPlans;
    }
    try {
        routines = RoutineCollection.fromJSON(JSON.stringify(routineResult.data));
    } catch (error) {
        console.error('서버의 루틴 데이터를 읽지 못했습니다.', error);
        routines = localRoutines;
    }
    cloudUser = planResult.user || routineResult.user;

    if (planResult.mode === 'cloud') {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(PREVIOUS_STORAGE_KEY);
        localStorage.removeItem(LEGACY_STORAGE_KEY);
    }
    if (routineResult.mode === 'cloud') {
        localStorage.removeItem(ROUTINE_STORAGE_KEY);
    }

    setPlanControlsDisabled(false);
    renderPlans();
}

initializePlans();
