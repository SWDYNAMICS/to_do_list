const STORAGE_KEY = 'linkedPlans.v2';
const LEGACY_STORAGE_KEY = 'linkedPlan.v1';

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
    constructor(id = createId(), head = null, nodes = []) {
        this.id = isValidId(id) ? id : createId();
        this.head = head;
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
        return new LinkedPlan(data.id, head, nodes);
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

    addChain(texts) {
        let id;
        do {
            id = createId();
        } while (this.chains.some(chain => chain.id === id));

        const chain = new LinkedPlan(id);
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

    getAllNodes() {
        return this.chains.flatMap(chain => chain.toArray());
    }

    serialize() {
        return JSON.stringify({
            version: 2,
            chains: this.chains.map(chain => chain.toData())
        });
    }
}

const planForm = document.getElementById('planForm');
const planInput = document.getElementById('planInput');
const planLines = document.getElementById('planLines');
const emptyState = document.getElementById('emptyState');
const progressText = document.getElementById('progressText');
const progressTrack = document.getElementById('progressTrack');
const progressBar = document.getElementById('progressBar');
const liveMessage = document.getElementById('liveMessage');

let plans = loadPlans();
let openInsertKey = null;

function loadPlans() {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) return PlanCollection.fromJSON(stored);
    } catch (error) {
        console.error('저장된 연결 리스트 라인을 불러오지 못했습니다.', error);
    }

    try {
        const legacyValue = localStorage.getItem(LEGACY_STORAGE_KEY);
        if (!legacyValue) return PlanCollection.empty();

        const legacyData = JSON.parse(legacyValue);
        const legacyChain = LinkedPlan.fromData({ ...legacyData, id: createId() });
        const collection = new PlanCollection(legacyChain ? [legacyChain] : []);

        if (collection.chains.length) {
            try {
                localStorage.setItem(STORAGE_KEY, collection.serialize());
            } catch (error) {
                console.error('이전 연결 계획의 저장 형식을 갱신하지 못했습니다.', error);
            }
        }
        return collection;
    } catch (error) {
        console.error('이전 연결 계획을 가져오지 못했습니다.', error);
        return PlanCollection.empty();
    }
}

function savePlans() {
    try {
        localStorage.setItem(STORAGE_KEY, plans.serialize());
    } catch (error) {
        console.error('연결 리스트 라인을 저장하지 못했습니다.', error);
        announce('브라우저 저장 공간에 계획을 저장하지 못했습니다.');
    }
}

function announce(message) {
    liveMessage.textContent = '';
    window.setTimeout(() => {
        liveMessage.textContent = message;
    }, 20);
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

    const insertButton = createActionButton(
        '뒤에 추가',
        'action-button insert-button',
        () => {
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
            const chainIndex = plans.chains.findIndex(itemChain => itemChain.id === chain.id);
            const nextFocusNodeId = node.next || chain.findPrevious(node.id)?.id || null;
            const removed = chain.remove(node.id);
            if (!removed) return;

            let focusNodeKey = nextFocusNodeId
                ? getNodeKey(chain.id, nextFocusNodeId)
                : null;
            let focusChainId = null;

            if (!chain.toArray().length) {
                plans.removeChain(chain.id);
                focusNodeKey = null;
                focusChainId = plans.chains[chainIndex]?.id
                    || plans.chains[chainIndex - 1]?.id
                    || null;
            }

            if (openInsertKey === key) openInsertKey = null;
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

    actions.append(insertButton, deleteButton);
    content.append(checkLabel, actions);
    card.append(meta, content);

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
            const currentIndex = plans.chains.findIndex(itemChain => itemChain.id === chain.id);
            const nextFocusId = plans.chains[currentIndex + 1]?.id
                || plans.chains[currentIndex - 1]?.id
                || null;
            const removed = plans.removeChain(chain.id);
            if (!removed) return;

            if (openInsertKey?.startsWith(`${chain.id}--`)) openInsertKey = null;
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

function updateProgress() {
    const nodes = plans.getAllNodes();
    const completed = nodes.filter(node => node.completed).length;
    const total = nodes.length;
    const percentage = total ? Math.round((completed / total) * 100) : 0;

    progressText.textContent = `${plans.chains.length}개 라인 · ${completed} / ${total} 완료`;
    progressBar.style.width = `${percentage}%`;
    progressTrack.setAttribute('aria-valuenow', String(percentage));
    progressTrack.setAttribute(
        'aria-valuetext',
        `${plans.chains.length}개 라인, ${total}개 중 ${completed}개 완료`
    );
}

function renderPlans(focusTarget = {}) {
    planLines.replaceChildren();
    plans.chains.forEach((chain, index) => {
        planLines.appendChild(createChainSection(chain, index));
    });

    emptyState.hidden = plans.chains.length > 0;
    updateProgress();

    window.requestAnimationFrame(() => {
        if (focusTarget.focusNodeKey) {
            document.getElementById(`plan-node-${focusTarget.focusNodeKey}`)?.focus();
        } else if (focusTarget.focusCheckboxKey) {
            document.getElementById(`toggle-${focusTarget.focusCheckboxKey}`)?.focus();
        } else if (focusTarget.focusActionKey) {
            document.getElementById(`insert-action-${focusTarget.focusActionKey}`)?.focus();
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

    const chain = plans.addChain(lines);
    if (!chain) return;

    const lineNumber = plans.chains.length;
    savePlans();
    planForm.reset();
    renderPlans();
    planInput.focus();
    announce(`라인 ${formatPosition(lineNumber - 1)}에 ${lines.length}개의 계획을 연결했습니다.`);
});

renderPlans();
