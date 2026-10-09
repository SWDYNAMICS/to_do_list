const STORAGE_KEY = 'learningRecords';
const review = window.TilReview;

const learningForm = document.getElementById('learningForm');
const titleInput = document.getElementById('learningTitle');
const categoryInput = document.getElementById('learningCategory');
const dateInput = document.getElementById('learningDate');
const learningList = document.getElementById('learningList');
const emptyMessage = document.getElementById('emptyMessage');
const recordCount = document.getElementById('recordCount');
const recordTabs = [...document.querySelectorAll('[data-record-view]')];
const recordViewHelp = document.getElementById('recordViewHelp');
const recordMoveStatus = document.getElementById('recordMoveStatus');
const VIEW_LABELS = { desk: '데스크', archive: '아카이브' };
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
let activeRecordView = 'desk';
let activeCategoryFilter = 'all';
const categoryFilters = document.getElementById('categoryFilters');
const recordSearch = document.getElementById('recordSearch');
const categories = window.TilCategories;
const categorySuggestions = categories.attach(categoryInput, document.getElementById('categorySuggestions'), () => learningRecords);
recordSearch.addEventListener('input', () => renderRecords());
function matchesSearch(record) {
    const query = categories.key(recordSearch.value);
    return !query || categories.key(`${record.title} ${record.content}`).includes(query);
}
function matchesCategory(record) {
    return activeCategoryFilter === 'all'
        || (activeCategoryFilter === 'uncategorized' ? !categories.key(record.category)
            : categories.key(record.category) === activeCategoryFilter.slice(9));
}


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
    document.getElementById('reviewPreview').hidden = true;
    document.getElementById('reviewPreview').replaceChildren();
    categorySuggestions.close();
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
        }, { cacheOnFailure: false });
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
        category: categories.catalog(learningRecords).find(item => item.key === categories.key(categoryInput.value))?.name
            || categories.clean(categoryInput.value),
        date: dateInput.value,
        location: learningRecords.find(item => item.id === editingRecordId)?.location || 'desk',
        ...contentEditor.getValue()
    };

    if (!record.title || !record.date || !record.content) return;

    const previous = learningRecords.find(item => item.id === editingRecordId);
    const unchanged = previous && JSON.stringify(previous.richContent) === JSON.stringify(record.richContent)
        && previous.content === record.content;
    record.review = review.answers(record).length
        ? (unchanged && previous.review ? previous.review : review.schedule()) : null;
    if (previous && !unchanged && record.review) record.location = 'desk';
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
        activeRecordView = record.location;
        activeCategoryFilter = 'all';
        recordSearch.value = '';
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

function setRecordView(view) {
    if (saving || !Object.hasOwn(VIEW_LABELS, view)) return;
    activeRecordView = view;
    activeCategoryFilter = 'all';
    recordMoveStatus.textContent = '';
    renderRecords();
}

async function moveRecord(id) {
    if (saving) return;
    const record = learningRecords.find(item => item.id === id);
    if (!record) return;
    const destination = record.location === 'archive' ? 'desk' : 'archive';
    const index = learningRecords.filter(item => item.location === activeRecordView && matchesCategory(item) && matchesSearch(item)).findIndex(item => item.id === id);
    // Preserve rich content; returning to the desk makes the review immediately due.
    const nextRecords = [{ ...record, location: destination, review: destination === 'desk' && review.answers(record).length ? review.schedule(Date.now(), null, true) : record.review }, ...learningRecords.filter(item => item.id !== id)];
    saving = true;
    setLearningControlsDisabled(true);
    recordMoveStatus.textContent = '기록을 이동하고 있습니다…';
    let moved = false;
    try {
        await saveRecords(nextRecords);
        learningRecords = nextRecords;
        renderRecords();
        recordMoveStatus.textContent = `‘${record.title}’ 기록을 ${VIEW_LABELS[destination]}로 옮겼습니다.`;
        moved = true;
    } catch (error) {
        console.error('기록 이동 실패', error);
        recordMoveStatus.textContent = '기록을 이동하지 못했습니다. 다시 시도해 주세요.';
    } finally {
        saving = false;
        setLearningControlsDisabled(false);
        if (moved) {
            const buttons = learningList.querySelectorAll('.move-record');
            (buttons[Math.min(index, buttons.length - 1)]
                || document.querySelector(`[data-record-view="${activeRecordView}"]`)).focus({ preventScroll: true });
        }
    }
}

recordTabs.forEach((tab, index) => {
    tab.addEventListener('click', () => setRecordView(tab.dataset.recordView));
    tab.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || saving) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? recordTabs.length - 1
            : (index + (event.key === 'ArrowRight' ? 1 : -1) + recordTabs.length) % recordTabs.length;
        setRecordView(recordTabs[next].dataset.recordView);
        recordTabs[next].focus();
    });
});

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

    const moveButton = document.createElement('button');
    moveButton.className = 'move-record';
    moveButton.type = 'button';
    const destinationLabel = record.location === 'archive' ? '데스크' : '아카이브';
    moveButton.textContent = `${destinationLabel}로 보내기`;
    moveButton.setAttribute('aria-label', `${record.title} 기록 ${destinationLabel}로 보내기`);
    moveButton.addEventListener('click', () => moveRecord(record.id));
    const topline = document.createElement('div');
    topline.className = 'record-topline';
    topline.append(meta, moveButton);

    const title = document.createElement('h3');
    title.className = 'record-title';
    title.textContent = record.title;

    const content = document.createElement('div');
    content.className = 'record-content';
    window.TilEditor.render(record, content);
    const reviewPanel = createReviewPanel(record, content);

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
    card.append(topline, title, content, reviewPanel, actions);
    card.dataset.recordId = String(record.id);
    card.dataset.reviewDue = String(Boolean(review.due(record)));
    return card;
}

function renderRecords() {
    learningList.replaceChildren();
    const viewRecords = learningRecords.filter(record => record.location === activeRecordView);
    const searchedRecords = viewRecords.filter(matchesSearch);
    categoryFilters.replaceChildren();
    const addFilterButton = (value, label, count) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'category-filter-button';
        button.dataset.categoryFilter = value;
        button.setAttribute('aria-pressed', String(value === activeCategoryFilter));
        button.disabled = saving;
        const name = document.createElement('span');
        name.textContent = label;
        const badge = document.createElement('span');
        badge.className = 'category-chip-count';
        badge.textContent = count;
        button.append(name, badge);
        button.addEventListener('click', () => {
            activeCategoryFilter = value;
            renderRecords();
            [...categoryFilters.children].find(item => item.dataset.categoryFilter === value)?.focus({ preventScroll: true });
        });
        categoryFilters.append(button);
    };
    addFilterButton('all', '전체', searchedRecords.length);
    const catalog = categories.catalog(viewRecords);
    if (activeCategoryFilter.startsWith('category:') && !catalog.some(item => `category:${item.key}` === activeCategoryFilter)) {
        activeCategoryFilter = 'all';
        categoryFilters.firstChild.setAttribute('aria-pressed', 'true');
    }
    catalog.forEach(item => addFilterButton(`category:${item.key}`, item.name,
        searchedRecords.filter(record => categories.key(record.category) === item.key).length));
    addFilterButton('uncategorized', '미분류', searchedRecords.filter(item => !categories.key(item.category)).length);
    const visibleRecords = searchedRecords.filter(matchesCategory);
    visibleRecords.forEach(record => {
        learningList.appendChild(createRecordCard(record));
    });

    emptyMessage.hidden = visibleRecords.length > 0;
    emptyMessage.textContent = activeRecordView === 'desk'
        ? '데스크가 비어 있습니다. 새 기록을 작성하거나 아카이브에서 가져오세요.'
        : '아직 보관한 기록이 없습니다. 데스크의 기록을 아카이브로 보내보세요.';
    if (activeCategoryFilter !== 'all') emptyMessage.textContent = '선택한 카테고리의 기록이 없습니다. 전체를 선택하면 다른 기록을 볼 수 있습니다.';
    if (categories.key(recordSearch.value)) emptyMessage.textContent = '검색 결과가 없습니다. 검색어나 카테고리를 바꿔보세요.';
    recordCount.textContent = `${VIEW_LABELS[activeRecordView]} ${visibleRecords.length}개`;
    recordViewHelp.textContent = activeRecordView === 'desk'
        ? '지금 살펴볼 기록입니다. 보관할 기록은 아카이브로 보내세요.'
        : '보관한 기록입니다. 다시 살펴볼 때 데스크로 가져오세요.';
    document.getElementById('recordViewPanel').setAttribute('aria-labelledby', `${activeRecordView}Tab`);
    recordTabs.forEach(tab => {
        const view = tab.dataset.recordView;
        const selected = view === activeRecordView;
        tab.setAttribute('aria-selected', String(selected));
        tab.tabIndex = selected ? 0 : -1;
        tab.querySelector('.record-tab-count').textContent = learningRecords.filter(record => record.location === view).length;
    });
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
        category: categories.clean(record.category),
        date: record.date,
        content: record.content,
        review: review.normalize(record.review),
        location: record.location === 'archive' ? 'archive' : 'desk',
        ...(record.contentFormat === 'tiptap-v1' && record.richContent?.type === 'doc'
            ? { contentFormat: 'tiptap-v1', richContent: record.richContent } : {})
    }));
}

function setLearningControlsDisabled(disabled) {
    [...learningForm.elements].forEach(element => {
        element.disabled = disabled;
    });
    learningList.querySelectorAll('button, .review-blank').forEach(button => { button.disabled = disabled; });
    recordTabs.forEach(tab => { tab.disabled = disabled; });
    categoryFilters.querySelectorAll('button').forEach(button => { button.disabled = disabled; });
    recordSearch.disabled = disabled;
    if (disabled) categorySuggestions.close();
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


function createReviewPanel(record, content) {
    const panel = document.createElement('div');
    panel.className = 'review-panel';
    if (!record.review || !review.answers(record).length) return panel;
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    panel.append(status);
    if (record.location === 'archive') {
        status.textContent = record.review.outcome === 'correct' ? '모든 빈칸을 맞힌 기록입니다.' : '';
        return panel;
    }
    if (!review.due(record)) {
        const date = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(record.review.dueAt));
        status.textContent = `${record.review.outcome === 'incorrect' ? '정답을 확인하세요. 다음 출제' : '빈칸 출제 예정'}: ${date}`;
        if (record.review.outcome === 'incorrect') {
            const answer = document.createElement('p');
            answer.className = 'review-answers';
            answer.textContent = review.answers(record).map((text, index) => `${index + 1}. ${text}`).join(' / ');
            panel.append(answer);
        }
        return panel;
    }
    const quiz = review.mask(content);
    status.textContent = `빈칸 ${quiz.inputs.length}개를 모두 채워 주세요.`;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'check-review';
    button.textContent = '정답 확인';
    panel.append(button);
    button.addEventListener('click', async () => {
        if (saving || editingRecordId === record.id) {
            status.textContent = '기록 수정을 마친 뒤 채점해 주세요.';
            return;
        }
        const empty = quiz.inputs.find(input => !input.value.trim());
        if (empty) { status.textContent = '모든 빈칸에 답을 입력해 주세요.'; empty.focus(); return; }
        const correct = quiz.inputs.every((input, index) => review.equal(input.value, quiz.answers[index]));
        const updated = { ...record, location: correct ? 'archive' : 'desk',
            review: review.schedule(Date.now(), correct ? 'correct' : 'incorrect') };
        const next = [updated, ...learningRecords.filter(item => item.id !== record.id)];
        saving = true;
        setLearningControlsDisabled(true);
        status.textContent = '풀이 결과 저장 중…';
        try {
            await saveRecords(next);
            learningRecords = next;
            renderRecords();
            recordMoveStatus.textContent = correct ? '정답입니다! 기록을 아카이브로 옮겼습니다.' : '틀린 답이 있습니다. 정답을 확인하세요. 30분 후 다시 출제합니다.';
            recordMoveStatus.tabIndex = -1;
            recordMoveStatus.focus({ preventScroll: true });
        } catch (error) {
            console.error('풀이 저장 실패', error);
            status.textContent = '결과를 저장하지 못했습니다. 입력한 답은 유지됩니다. 다시 시도해 주세요.';
        } finally {
            saving = false;
            setLearningControlsDisabled(false);
        }
    });
    return panel;
}

const preview = document.getElementById('reviewPreview');
document.getElementById('previewReview').addEventListener('click', () => {
    preview.replaceChildren();
    window.TilEditor.render(readForm(), preview);
    const quiz = review.mask(preview, true);
    if (!quiz.inputs.length) preview.textContent = '밑줄 친 내용이 없습니다. 글자를 선택한 뒤 “밑줄 · 출제”를 눌러 주세요.';
    preview.hidden = false;
});

function refreshDueReviews() {
    if (saving || document.hidden) return;
    // Replace only newly due cards, preserving answers already being entered elsewhere.
    learningList.querySelectorAll('[data-review-due="false"]').forEach(card => {
        const record = learningRecords.find(item => String(item.id) === card.dataset.recordId);
        if (record && review.due(record)) card.replaceWith(createRecordCard(record));
    });
}
setInterval(refreshDueReviews, 30000);
window.addEventListener('focus', refreshDueReviews);
document.addEventListener('visibilitychange', refreshDueReviews);
