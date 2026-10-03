const STORAGE_KEY = 'learningRecords';

const learningForm = document.getElementById('learningForm');
const titleInput = document.getElementById('learningTitle');
const categoryInput = document.getElementById('learningCategory');
const dateInput = document.getElementById('learningDate');
const learningList = document.getElementById('learningList');
const emptyMessage = document.getElementById('emptyMessage');
const recordCount = document.getElementById('recordCount');
const writeTitle = document.getElementById('writeTitle');
const saveButton = document.getElementById('saveRecord');
const cancelEditButton = document.getElementById('cancelEdit');
const formStatus = document.getElementById('formStatus');
const contentEditor = window.TilEditor.create({
    element: document.getElementById('learningEditor'),
    toolbar: document.getElementById('editorToolbar'),
    outline: document.getElementById('editorOutline'),
    pasteMode: document.getElementById('pasteMode')
});

let learningRecords = [];
let cloudUser = null;
let editingRecordId = null;
let newRecordDraft = null;
let saving = false;

function readForm() {
    return {
        title: titleInput.value,
        category: categoryInput.value,
        date: dateInput.value,
        ...contentEditor.getValue()
    };
}

function fillForm(record) {
    titleInput.value = record.title;
    categoryInput.value = record.category || '';
    dateInput.value = record.date;
    contentEditor.setValue(record);
}

function finishEditing() {
    editingRecordId = null;
    learningForm.reset();
    contentEditor.clear();
    dateInput.value = getToday();
    if (newRecordDraft) fillForm(newRecordDraft);
    newRecordDraft = null;
    writeTitle.textContent = '새 기록 작성';
    saveButton.textContent = '기록 저장하기';
    cancelEditButton.hidden = true;
}

function editRecord(id) {
    if (saving) return;
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

async function saveRecords(records) {
    if (cloudUser) {
        const saved = await window.AppBackend.saveUserData('learning', {
            version: 1,
            records
        });
        if (!saved) throw new Error('서버에 저장하지 못했습니다.');
        return;
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
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

async function addRecord(event) {
    event.preventDefault();
    if (saving) return;
    if (contentEditor.isEmpty()) {
        formStatus.textContent = '배운 내용을 입력해 주세요.';
        contentEditor.focus();
        return;
    }

    const record = {
        id: editingRecordId ?? (globalThis.crypto?.randomUUID?.() ?? Date.now()),
        title: titleInput.value.trim(),
        category: categoryInput.value.trim(),
        date: dateInput.value,
        ...contentEditor.getValue()
    };

    if (!record.title || !record.date || !record.content) return;

    const isEditing = editingRecordId !== null;
    const nextRecords = [...learningRecords];
    if (isEditing) {
        const index = nextRecords.findIndex(item => item.id === editingRecordId);
        if (index < 0) return;
        nextRecords.splice(index, 1);
    }
    nextRecords.unshift(record);
    saving = true;
    setLearningControlsDisabled(true);
    formStatus.textContent = '저장 중…';
    try {
        await saveRecords(nextRecords);
        learningRecords = nextRecords;
        finishEditing();
        formStatus.textContent = isEditing ? '기록을 수정했습니다.' : '새 기록을 저장했습니다.';
        renderRecords();
    } catch (error) {
        console.error('학습 기록 저장 실패', error);
        formStatus.textContent = '저장하지 못했습니다. 작성 내용은 유지되어 있으니 다시 저장해 주세요.';
    } finally {
        saving = false;
        setLearningControlsDisabled(false);
    }
}

async function deleteRecord(id) {
    if (saving) return;
    saving = true;
    setLearningControlsDisabled(true);
    try {
        const nextRecords = learningRecords.filter(record => record.id !== id);
        await saveRecords(nextRecords);
        learningRecords = nextRecords;
        if (editingRecordId === id) finishEditing();
        formStatus.textContent = '기록을 삭제했습니다.';
        renderRecords();
    } catch (error) {
        console.error('학습 기록 삭제 실패', error);
        formStatus.textContent = '삭제하지 못했습니다. 다시 시도해 주세요.';
    } finally {
        saving = false;
        setLearningControlsDisabled(false);
    }
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

    const content = document.createElement('div');
    content.className = 'record-content';
    window.TilEditor.render(record, content);

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
        content: record.content,
        ...(record.contentFormat === 'tiptap-v1' && record.richContent?.type === 'doc'
            ? { contentFormat: 'tiptap-v1', richContent: record.richContent } : {})
    }));
}

function setLearningControlsDisabled(disabled) {
    [...learningForm.elements].forEach(element => {
        element.disabled = disabled;
    });
    learningList.querySelectorAll('button').forEach(button => { button.disabled = disabled; });
    contentEditor.setEditable(!disabled);
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
