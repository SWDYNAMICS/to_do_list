const STORAGE_KEY = 'linkedPlan.v1';

class LinkedPlan {
    constructor(head = null, nodes = []) {
        this.head = head;
        this.nodes = new Map(nodes.map(node => [node.id, node]));
        this.repairLinks();
    }

    static empty() {
        return new LinkedPlan();
    }

    static fromJSON(value) {
        if (!value) return LinkedPlan.empty();

        try {
            const data = JSON.parse(value);
            if (!data || !Array.isArray(data.nodes)) return LinkedPlan.empty();

            const seenIds = new Set();
            const nodes = data.nodes
                .filter(node => {
                    const hasValidShape = node
                        && typeof node.id === 'string'
                        && /^[A-Za-z0-9_-]{1,100}$/.test(node.id)
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
                    next: typeof node.next === 'string' ? node.next : null
                }))
                .filter(node => node.text);

            return new LinkedPlan(typeof data.head === 'string' ? data.head : null, nodes);
        } catch (error) {
            console.error('저장된 연결 계획을 불러오지 못했습니다.', error);
            return LinkedPlan.empty();
        }
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

        const tail = this.getTail();
        let previous = tail;
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

    serialize() {
        return JSON.stringify({
            version: 1,
            head: this.head,
            nodes: this.toArray()
        });
    }
}

const planForm = document.getElementById('planForm');
const planInput = document.getElementById('planInput');
const planList = document.getElementById('planList');
const emptyState = document.getElementById('emptyState');
const progressText = document.getElementById('progressText');
const progressTrack = document.getElementById('progressTrack');
const progressBar = document.getElementById('progressBar');
const liveMessage = document.getElementById('liveMessage');

let plan = loadPlan();
let openInsertId = null;

function loadPlan() {
    try {
        return LinkedPlan.fromJSON(localStorage.getItem(STORAGE_KEY));
    } catch (error) {
        console.error('브라우저 저장 공간에 접근하지 못했습니다.', error);
        return LinkedPlan.empty();
    }
}

function createId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function savePlan() {
    try {
        localStorage.setItem(STORAGE_KEY, plan.serialize());
    } catch (error) {
        console.error('연결 계획을 저장하지 못했습니다.', error);
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

function createActionButton(label, className, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = label;
    button.addEventListener('click', onClick);
    return button;
}

function createInsertForm(node) {
    const form = document.createElement('form');
    form.className = 'insert-form';
    form.id = `insert-form-${node.id}`;

    const inputId = `insert-${node.id}`;
    const label = document.createElement('label');
    label.className = 'visually-hidden';
    label.htmlFor = inputId;
    label.textContent = `${node.text} 뒤에 추가할 계획`;

    const input = document.createElement('input');
    input.id = inputId;
    input.className = 'insert-input';
    input.type = 'text';
    input.maxLength = 120;
    input.placeholder = '이 엘리먼트 뒤에 넣을 계획';
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
        openInsertId = null;
        renderPlan({ focusActionId: node.id });
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

        const inserted = plan.insertAfter(node.id, cleanText);
        if (!inserted) return;

        savePlan();
        openInsertId = null;
        renderPlan({ focusNodeId: inserted.id });
        announce(`${inserted.text} 계획을 ${node.text} 뒤에 연결했습니다.`);
    });

    form.append(label, input, submitButton, cancelButton);
    window.requestAnimationFrame(() => input.focus());
    return form;
}

function createPlanNode(node, index, positions) {
    const item = document.createElement('li');
    item.className = `plan-node${node.completed ? ' is-complete' : ''}`;
    item.dataset.id = node.id;

    const card = document.createElement('article');
    card.className = 'node-card';
    card.id = `plan-node-${node.id}`;
    card.tabIndex = -1;

    const meta = document.createElement('div');
    meta.className = 'node-meta';

    const position = document.createElement('span');
    position.textContent = `ELEMENT ${formatPosition(index)}`;

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
    checkbox.className = 'complete-toggle';
    checkbox.type = 'checkbox';
    checkbox.checked = node.completed;
    checkbox.setAttribute('aria-label', `${node.text} 완료 상태`);
    checkbox.addEventListener('change', () => {
        const changed = plan.toggle(node.id);
        if (!changed) return;
        savePlan();
        renderPlan({ focusCheckboxId: node.id });
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
            openInsertId = openInsertId === node.id ? null : node.id;
            renderPlan({ focusActionId: openInsertId ? null : node.id });
        }
    );
    insertButton.dataset.actionFor = node.id;
    insertButton.setAttribute('aria-expanded', String(openInsertId === node.id));
    if (openInsertId === node.id) {
        insertButton.setAttribute('aria-controls', `insert-form-${node.id}`);
    }
    insertButton.setAttribute('aria-label', `${node.text} 뒤에 계획 추가`);

    const deleteButton = createActionButton(
        '삭제',
        'action-button delete-button',
        () => {
            const nextFocusId = node.next || plan.findPrevious(node.id)?.id || null;
            const removed = plan.remove(node.id);
            if (!removed) return;

            if (openInsertId === node.id) openInsertId = null;
            savePlan();
            renderPlan({ focusNodeId: nextFocusId, focusInput: !nextFocusId });
            announce(`${removed.text} 계획을 삭제했습니다.`);
        }
    );
    deleteButton.setAttribute('aria-label', `${node.text} 계획 삭제`);

    actions.append(insertButton, deleteButton);
    content.append(checkLabel, actions);
    card.append(meta, content);

    if (openInsertId === node.id) {
        card.appendChild(createInsertForm(node));
    }

    item.appendChild(card);
    return item;
}

function updateProgress(nodes) {
    const completed = nodes.filter(node => node.completed).length;
    const total = nodes.length;
    const percentage = total ? Math.round((completed / total) * 100) : 0;

    progressText.textContent = `${completed} / ${total} 완료`;
    progressBar.style.width = `${percentage}%`;
    progressTrack.setAttribute('aria-valuenow', String(percentage));
    progressTrack.setAttribute('aria-valuetext', `${total}개 중 ${completed}개 완료`);
}

function renderPlan(focusTarget = {}) {
    const nodes = plan.toArray();
    const positions = new Map(nodes.map((node, index) => [node.id, index]));

    planList.replaceChildren();
    nodes.forEach((node, index) => {
        planList.appendChild(createPlanNode(node, index, positions));
    });

    emptyState.hidden = nodes.length > 0;
    updateProgress(nodes);

    window.requestAnimationFrame(() => {
        if (focusTarget.focusNodeId) {
            document.getElementById(`plan-node-${focusTarget.focusNodeId}`)?.focus();
        } else if (focusTarget.focusCheckboxId) {
            document
                .querySelector(`[data-id="${focusTarget.focusCheckboxId}"] .complete-toggle`)
                ?.focus();
        } else if (focusTarget.focusActionId) {
            document.querySelector(`[data-action-for="${focusTarget.focusActionId}"]`)?.focus();
        } else if (focusTarget.focusInput) {
            planInput.focus();
        }
    });
}

planForm.addEventListener('submit', event => {
    event.preventDefault();
    const lines = parseLines(planInput.value);
    if (!lines.length) {
        announce('추가할 계획을 한 줄 이상 입력해 주세요.');
        return;
    }

    const created = plan.appendMany(lines);
    savePlan();
    planForm.reset();
    renderPlan();
    planInput.focus();
    announce(`${created.length}개의 계획을 리스트 끝에 연결했습니다.`);
});

renderPlan();
