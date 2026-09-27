const STORAGE_KEY = 'learningRecords';

const learningForm = document.getElementById('learningForm');
const titleInput = document.getElementById('learningTitle');
const categoryInput = document.getElementById('learningCategory');
const dateInput = document.getElementById('learningDate');
const contentInput = document.getElementById('learningContent');
const learningList = document.getElementById('learningList');
const emptyMessage = document.getElementById('emptyMessage');
const recordCount = document.getElementById('recordCount');
const writeTitle = document.getElementById('writeTitle');
const saveButton = document.getElementById('saveRecord');
const cancelEditButton = document.getElementById('cancelEdit');
const formStatus = document.getElementById('formStatus');

let learningRecords = [];
let cloudUser = null;
let editingRecordId = null;
let newRecordDraft = null;

function readForm() {
    return {
        title: titleInput.value,
        category: categoryInput.value,
        date: dateInput.value,
        content: contentInput.value
    };
}

function fillForm(record) {
    titleInput.value = record.title;
    categoryInput.value = record.category || '';
    dateInput.value = record.date;
    contentInput.value = record.content;
}

function finishEditing() {
    editingRecordId = null;
    learningForm.reset();
    dateInput.value = getToday();
    if (newRecordDraft) fillForm(newRecordDraft);
    newRecordDraft = null;
    writeTitle.textContent = '새 기록 작성';
    saveButton.textContent = '기록 저장하기';
    cancelEditButton.hidden = true;
}

function editRecord(id) {
    const record = learningRecords.find(item => item.id === id);
    if (!record) return;
    if (editingRecordId === null) newRecordDraft = readForm();
    editingRecordId = id;
    fillForm(record);
    writeTitle.textContent = '기록 수정';
    saveButton.textContent = '수정 내용 저장';
    cancelEditButton.hidden = false;
    formStatus.textContent = '기존 기록을 수정하고 있습니다.';
    titleInput.focus({ preventScroll: true });
    writeTitle.scrollIntoView({ block: 'start' });
}

function loadRecords() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    } catch (error) {
        console.error('저장된 학습 기록을 불러오지 못했습니다.', error);
        return [];
    }
}

function saveRecords() {
    if (cloudUser) {
        window.AppBackend.saveUserData('learning', {
            version: 1,
            records: learningRecords
        });
        return;
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(learningRecords));
}

function getToday() {
    const today = new Date();
    const timezoneOffset = today.getTimezoneOffset() * 60 * 1000;
    return new Date(today.getTime() - timezoneOffset).toISOString().slice(0, 10);
}

function formatDate(date) {
    return new Intl.DateTimeFormat('ko-KR', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    }).format(new Date(`${date}T00:00:00`));
}

function addRecord(event) {
    event.preventDefault();

    const record = {
        id: editingRecordId ?? (globalThis.crypto?.randomUUID?.() ?? Date.now()),
        title: titleInput.value.trim(),
        category: categoryInput.value.trim(),
        date: dateInput.value,
        content: contentInput.value.trim()
    };

    if (!record.title || !record.date || !record.content) return;

    const isEditing = editingRecordId !== null;
    if (isEditing) {
        const index = learningRecords.findIndex(item => item.id === editingRecordId);
        if (index < 0) return;
        learningRecords[index] = record;
    } else {
        learningRecords.unshift(record);
    }
    saveRecords();
    finishEditing();
    formStatus.textContent = isEditing ? '기록을 수정했습니다.' : '새 기록을 저장했습니다.';
    titleInput.focus();
    renderRecords();
}

function deleteRecord(id) {
    if (editingRecordId === id) {
        finishEditing();
        formStatus.textContent = '수정 중이던 기록을 삭제했습니다.';
    }
    learningRecords = learningRecords.filter(record => record.id !== id);
    saveRecords();
    renderRecords();
}

function createRecordCard(record) {
    const card = document.createElement('article');
    card.className = 'record-card';

    const meta = document.createElement('div');
    meta.className = 'record-meta';

    const date = document.createElement('time');
    date.dateTime = record.date;
    date.textContent = formatDate(record.date);
    meta.appendChild(date);

    if (record.category) {
        const category = document.createElement('span');
        category.className = 'record-category';
        category.textContent = `# ${record.category}`;
        meta.appendChild(category);
    }

    const title = document.createElement('h3');
    title.className = 'record-title';
    title.textContent = record.title;

    const content = document.createElement('p');
    content.className = 'record-content';
    content.textContent = record.content;

    const deleteButton = document.createElement('button');
    deleteButton.className = 'delete-record';
    deleteButton.type = 'button';
    deleteButton.textContent = '삭제';
    deleteButton.setAttribute('aria-label', `${record.title} 기록 삭제`);
    deleteButton.addEventListener('click', () => deleteRecord(record.id));

    const editButton = document.createElement('button');
    editButton.className = 'edit-record';
    editButton.type = 'button';
    editButton.textContent = '수정';
    editButton.setAttribute('aria-label', `${record.title} 기록 수정`);
    editButton.addEventListener('click', () => editRecord(record.id));

    const actions = document.createElement('div');
    actions.className = 'record-actions';
    actions.append(editButton, deleteButton);
    card.append(meta, title, content, actions);
    return card;
}

function renderRecords() {
    learningList.replaceChildren();
    learningRecords.forEach(record => {
        learningList.appendChild(createRecordCard(record));
    });

    const hasRecords = learningRecords.length > 0;
    emptyMessage.hidden = hasRecords;
    recordCount.textContent = `${learningRecords.length}개`;
}

learningForm.addEventListener('submit', addRecord);
cancelEditButton.addEventListener('click', () => {
    finishEditing();
    formStatus.textContent = '수정을 취소했습니다.';
    titleInput.focus();
});

function normalizeRecords(records) {
    if (!Array.isArray(records)) return [];
    return records.filter(record => (
        record
        && typeof record.title === 'string'
        && typeof record.date === 'string'
        && typeof record.content === 'string'
    )).map(record => ({
        id: record.id ?? Date.now(),
        title: record.title,
        category: typeof record.category === 'string' ? record.category : '',
        date: record.date,
        content: record.content
    }));
}

function setLearningControlsDisabled(disabled) {
    [...learningForm.elements].forEach(element => {
        element.disabled = disabled;
    });
}

async function initializeLearningRecords() {
    setLearningControlsDisabled(true);
    const localRecords = normalizeRecords(loadRecords());
    const result = await window.AppBackend.loadUserData('learning', {
        version: 1,
        records: localRecords
    });

    learningRecords = normalizeRecords(result.data?.records);
    cloudUser = result.user;
    if (result.mode === 'cloud') {
        localStorage.removeItem(STORAGE_KEY);
    }

    dateInput.value = getToday();
    setLearningControlsDisabled(false);
    renderRecords();
}

initializeLearningRecords();
