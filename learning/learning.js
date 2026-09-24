const STORAGE_KEY = 'learningRecords';

const learningForm = document.getElementById('learningForm');
const titleInput = document.getElementById('learningTitle');
const categoryInput = document.getElementById('learningCategory');
const dateInput = document.getElementById('learningDate');
const contentInput = document.getElementById('learningContent');
const learningList = document.getElementById('learningList');
const emptyMessage = document.getElementById('emptyMessage');
const recordCount = document.getElementById('recordCount');

let learningRecords = [];
let cloudUser = null;

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
        id: Date.now(),
        title: titleInput.value.trim(),
        category: categoryInput.value.trim(),
        date: dateInput.value,
        content: contentInput.value.trim()
    };

    if (!record.title || !record.date || !record.content) return;

    learningRecords.unshift(record);
    saveRecords();
    learningForm.reset();
    dateInput.value = getToday();
    titleInput.focus();
    renderRecords();
}

function deleteRecord(id) {
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

    card.append(meta, title, content, deleteButton);
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
