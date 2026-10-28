const library = window.TilLibrary.create();
const review = window.TilReview;
const recordData = window.TilRecordData;
const LOCATION = recordData.LOCATION;

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
const VIEW_LABELS = recordData.LABELS;
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
let recordsReady = false;
let editingRecordId = null;
let editingContentBaseline = null;
let editingRecordSnapshot = null;
let newRecordDraft = null;
let saving = false;
let activeRecordView = LOCATION.DESK;
let activeCategoryFilter = 'all';
const categoryFilters = document.getElementById('categoryFilters');
const recordSearch = document.getElementById('recordSearch');
const archiveCategoryButton = document.getElementById('archiveCategoryButton');
const categoryArchiveTitle = document.getElementById('categoryArchiveTitle');
const categoryArchiveHelp = document.getElementById('categoryArchiveHelp');
const categories = window.TilCategories;
const categorySuggestions = categories.attach(categoryInput, document.getElementById('categorySuggestions'), () => learningRecords.filter(record => record.location !== LOCATION.ARCHIVE));
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

function categoryArchiveSelection() {
    // Category-wide moves are scoped to the current tab, independently of search.
    const records = activeCategoryFilter === 'all' ? []
        : learningRecords.filter(record => record.location === activeRecordView && matchesCategory(record));
    const label = activeCategoryFilter === 'uncategorized' ? '미분류'
        : records[0]?.category || '';
    return { records, label };
}

function updateCategoryArchiveControls(disabled = false) {
    const { records, label } = categoryArchiveSelection();
    const selected = activeCategoryFilter !== 'all';
    const editingTarget = records.some(record => record.id === editingRecordId);
    categoryArchiveTitle.textContent = selected ? `${label} · 전체 ${records.length}개` : '카테고리 한 번에 보관';
    categoryArchiveHelp.textContent = !selected
        ? '카테고리를 선택하면 해당 기록을 한 번에 아카이브로 보낼 수 있습니다.'
        : editingTarget ? '이 카테고리의 기록을 수정 중입니다. 먼저 저장하거나 수정을 취소해 주세요.'
            : `${VIEW_LABELS[activeRecordView]}의 이 카테고리 전체가 대상입니다. 검색으로 숨겨진 기록도 포함합니다.`;
    archiveCategoryButton.textContent = selected ? `${records.length}개 아카이브로 보내기` : '카테고리 전체 아카이브로 보내기';
    archiveCategoryButton.setAttribute('aria-label', selected
        ? `${VIEW_LABELS[activeRecordView]} ${label} 카테고리 ${records.length}개 아카이브로 보내기`
        : '카테고리 전체 아카이브로 보내기');
    archiveCategoryButton.disabled = disabled || saving || !recordsReady || !records.length || editingTarget;
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

function recordSnapshot(record) {
    return JSON.stringify(record, (key, value) => value && !Array.isArray(value) && typeof value === 'object'
        ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value);
}

function finishEditing() {
    editingRecordId = null;
    editingContentBaseline = null;
    editingRecordSnapshot = null;
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
    updateCategoryArchiveControls();
}

function editRecord(id) {
    if (saving) return;
    const record = learningRecords.find(item => item.id === id);
    if (!record) return;
    if (editingRecordId === null) newRecordDraft = readForm();
    editingRecordId = id;
    // Other saves can refresh the record list while this draft is still open.
    // Keep the draft's original revision separate from that refreshed list.
    editingRecordSnapshot = recordSnapshot(record);
    fillForm(record);
    editingContentBaseline = JSON.stringify(contentEditor.getValue());
    writeTitle.textContent = '기록 수정';
    saveButton.textContent = '수정 내용 저장';
    cancelEditButton.hidden = false;
    updateCategoryArchiveControls();
    formStatus.textContent = '기존 기록을 수정하고 있습니다.';
    titleInput.focus({ preventScroll: true });
    writeTitle.scrollIntoView({ block: 'start' });
}

async function saveRecords(records) {
    if (!recordsReady) throw new Error('기록을 먼저 정상적으로 불러와야 합니다.');
    const saved = await library.saveChanges(records, learningRecords);
    return normalizeRecords(saved.records);
}

function persistenceError(error, fallback) {
    return error.name === 'TilConflictError' ? error.message : fallback;
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
    const previous = learningRecords.find(item => item.id === editingRecordId);
    if (editingRecordId !== null && recordSnapshot(previous) !== editingRecordSnapshot) {
        formStatus.textContent = '이 기록이 다른 화면에서 변경되었습니다. 작성 중인 내용을 복사해 둔 뒤 새로고침하고 다시 시도해 주세요.';
        return;
    }
    if (contentEditor.isEmpty()) {
        formStatus.textContent = '배운 내용을 입력해 주세요.';
        contentEditor.focus();
        return;
    }

    const record = {
        ...previous,
        id: editingRecordId ?? (globalThis.crypto?.randomUUID?.() ?? Date.now()),
        title: titleInput.value.trim(),
        category: categories.catalog(learningRecords).find(item => item.key === categories.key(categoryInput.value))?.name
            || categories.clean(categoryInput.value),
        date: dateInput.value,
        location: previous?.location || LOCATION.DESK,
        ...contentEditor.getValue()
    };

    if (!record.title || !record.date || !record.content) return;

    // Compare against the editor's initial parsed value, so legacy schema defaults
    // don't turn a title-only edit into a content change or reset its review.
    const unchanged = previous && editingContentBaseline === JSON.stringify(contentEditor.getValue());
    if (unchanged && previous.contentFormat === 'tiptap-v1') {
        record.richContent = previous.richContent;
        record.content = previous.content;
    }
    record.review = review.answers(record).length
        ? (unchanged && previous.review ? previous.review : review.schedule()) : null;
    if (previous?.location === LOCATION.ARCHIVE) {
        record.location = LOCATION.ARCHIVE;
        record.review = previous.review;
        record.updatedAt = new Date().toISOString();
    } else if (previous && !unchanged && record.review) record.location = LOCATION.DESK;
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
        learningRecords = await saveRecords(nextRecords);
        activeRecordView = record.location === LOCATION.ARCHIVE ? LOCATION.BOOKCASE : record.location;
        activeCategoryFilter = 'all';
        recordSearch.value = '';
        finishEditing();
        formStatus.textContent = record.location === LOCATION.ARCHIVE ? '아카이브 글을 수정했습니다.' : isEditing ? '기록을 수정했습니다.' : '새 기록을 저장했습니다.';
        renderRecords();
    } catch (error) {
        console.error('학습 기록 저장 실패', error);
        formStatus.textContent = persistenceError(error, '저장하지 못했습니다. 작성 내용은 유지되어 있으니 다시 저장해 주세요.');
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
        learningRecords = await saveRecords(nextRecords);
        if (editingRecordId === id) finishEditing();
        formStatus.textContent = '기록을 삭제했습니다.';
        renderRecords();
    } catch (error) {
        console.error('학습 기록 삭제 실패', error);
        formStatus.textContent = persistenceError(error, '삭제하지 못했습니다. 다시 시도해 주세요.');
    } finally {
        saving = false;
        setLearningControlsDisabled(false);
    }
}

function setRecordView(view) {
    if (saving || ![LOCATION.DESK, LOCATION.BOOKCASE].includes(view)) return;
    activeRecordView = view;
    activeCategoryFilter = 'all';
    recordMoveStatus.textContent = '';
    renderRecords();
}

async function moveRecord(id, target = null) {
    if (saving) return;
    const record = learningRecords.find(item => item.id === id);
    if (!record) return;
    const destination = target || (record.location === LOCATION.BOOKCASE ? LOCATION.DESK : LOCATION.BOOKCASE);
    if (!Object.values(LOCATION).includes(destination) || record.location === destination) return;
    const index = learningRecords.filter(item => item.location === activeRecordView && matchesCategory(item) && matchesSearch(item)).findIndex(item => item.id === id);
    // Preserve rich content; returning to the desk makes the review immediately due.
    const nextRecords = [{ ...record, location: destination,
        ...(destination === LOCATION.ARCHIVE ? { archivedAt: new Date().toISOString() } : {}),
        review: destination === LOCATION.DESK && review.answers(record).length ? review.schedule(Date.now(), null, true) : record.review }, ...learningRecords.filter(item => item.id !== id)];
    saving = true;
    setLearningControlsDisabled(true);
    recordMoveStatus.textContent = '기록을 이동하고 있습니다…';
    let moved = false;
    try {
        learningRecords = await saveRecords(nextRecords);
        renderRecords();
        recordMoveStatus.textContent = `‘${record.title}’ 기록을 ${VIEW_LABELS[destination]}로 옮겼습니다.`;
        moved = true;
    } catch (error) {
        console.error('기록 이동 실패', error);
        recordMoveStatus.textContent = persistenceError(error, '기록을 이동하지 못했습니다. 다시 시도해 주세요.');
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

async function archiveCategory() {
    if (saving || !recordsReady) return;
    const { records, label } = categoryArchiveSelection();
    if (!records.length || records.some(record => record.id === editingRecordId)) return;
    const source = VIEW_LABELS[activeRecordView];
    const ids = new Set(records.map(record => record.id));
    const archivedAt = new Date().toISOString();
    const nextRecords = [
        ...records.map(record => ({ ...record, location: LOCATION.ARCHIVE, archivedAt })),
        ...learningRecords.filter(record => !ids.has(record.id))
    ];
    saving = true;
    setLearningControlsDisabled(true);
    recordMoveStatus.textContent = `${source}의 ‘${label}’ 기록 ${records.length}개를 옮기는 중입니다…`;
    let moved = false;
    try {
        // One document mutation keeps the batch atomic on failure or conflict.
        learningRecords = await saveRecords(nextRecords);
        renderRecords();
        recordMoveStatus.textContent = `${source}의 ‘${label}’ 기록 ${records.length}개를 아카이브로 옮겼습니다.`;
        moved = true;
    } catch (error) {
        console.error('카테고리 아카이브 이동 실패', error);
        recordMoveStatus.textContent = persistenceError(error, '기록을 이동하지 못했습니다. 기존 위치는 유지되며 다시 시도할 수 있습니다.');
    } finally {
        saving = false;
        setLearningControlsDisabled(false);
        if (moved) categoryFilters.querySelector('[aria-pressed="true"]')?.focus({ preventScroll: true });
    }
}

archiveCategoryButton.addEventListener('click', archiveCategory);

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
    const destinationLabel = VIEW_LABELS[record.location === LOCATION.BOOKCASE ? LOCATION.DESK : LOCATION.BOOKCASE];
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
    const archiveButton = document.createElement('button');
    archiveButton.type = 'button';
    archiveButton.className = 'archive-record';
    archiveButton.textContent = '아카이브로 보내기';
    archiveButton.setAttribute('aria-label', `${record.title} 기록 아카이브로 보내기`);
    archiveButton.addEventListener('click', () => moveRecord(record.id, LOCATION.ARCHIVE));
    actions.append(archiveButton, editButton, deleteButton);
    card.append(topline, title, content, reviewPanel, actions);
    card.dataset.recordId = String(record.id);
    card.dataset.reviewDue = String(Boolean(review.due(record)));
    return card;
}

function renderRecords() {
    learningList.replaceChildren();
    document.getElementById('archiveCount').textContent = learningRecords.filter(record => record.location === LOCATION.ARCHIVE).length;
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
    emptyMessage.textContent = activeRecordView === LOCATION.DESK
        ? '데스크가 비어 있습니다. 새 기록을 작성하거나 북케이스에서 가져오세요.'
        : '아직 보관한 기록이 없습니다. 데스크의 기록을 북케이스로 보내보세요.';
    if (activeCategoryFilter !== 'all') emptyMessage.textContent = '선택한 카테고리의 기록이 없습니다. 전체를 선택하면 다른 기록을 볼 수 있습니다.';
    if (categories.key(recordSearch.value)) emptyMessage.textContent = '검색 결과가 없습니다. 검색어나 카테고리를 바꿔보세요.';
    recordCount.textContent = `${VIEW_LABELS[activeRecordView]} ${visibleRecords.length}개`;
    recordViewHelp.textContent = activeRecordView === LOCATION.DESK
        ? '오늘 당장 공부할 기록입니다. 익힌 개념은 북케이스에 두고 다시 상기해 보세요.'
        : '정리한 개념을 반복해서 살펴보는 공간입니다. 충분히 이해한 글은 아카이브로 보내세요.';
    document.getElementById('recordViewPanel').setAttribute('aria-labelledby', `${activeRecordView}Tab`);
    recordTabs.forEach(tab => {
        const view = tab.dataset.recordView;
        const selected = view === activeRecordView;
        tab.setAttribute('aria-selected', String(selected));
        tab.tabIndex = selected ? 0 : -1;
        tab.querySelector('.record-tab-count').textContent = learningRecords.filter(record => record.location === view).length;
    });
    updateCategoryArchiveControls();
}

learningForm.addEventListener('submit', addRecord);
cancelEditButton.addEventListener('click', () => {
    finishEditing();
    formStatus.textContent = '수정을 취소했습니다.';
    titleInput.focus();
});

function normalizeRecords(records) {
    return records.map(record => ({
        ...record,
        id: record.id ?? (globalThis.crypto?.randomUUID?.() ?? Date.now()),
        category: categories.clean(record.category),
        review: review.normalize(record.review)
    }));
}

function setLearningControlsDisabled(disabled) {
    disabled = disabled || !recordsReady;
    [...learningForm.elements].forEach(element => {
        element.disabled = disabled;
    });
    learningList.querySelectorAll('button, .review-blank').forEach(button => { button.disabled = disabled; });
    recordTabs.forEach(tab => { tab.disabled = disabled; });
    categoryFilters.querySelectorAll('button').forEach(button => { button.disabled = disabled; });
    recordSearch.disabled = disabled;
    updateCategoryArchiveControls(disabled);
    if (disabled) categorySuggestions.close();
    contentEditor.setEditable(!disabled);
}

async function initializeLearningRecords() {
    setLearningControlsDisabled(true);
    try {
        const data = await library.load();
        learningRecords = normalizeRecords(data.records);
        dateInput.value = getToday();
        recordsReady = true;
        setLearningControlsDisabled(false);
        renderRecords();
        const editId = new URLSearchParams(location.search).get('edit');
        if (editId) {
            const record = learningRecords.find(item => String(item.id) === editId);
            if (record) {
                editRecord(record.id);
                const returnLink = document.getElementById('archiveReturn');
                if (record.location === LOCATION.ARCHIVE) {
                    returnLink.href = `./archive/?id=${encodeURIComponent(record.id)}`;
                    returnLink.hidden = false;
                    formStatus.textContent = '아카이브 글을 수정하고 있습니다. 저장해도 아카이브에 유지됩니다.';
                }
            } else formStatus.textContent = '수정할 기록을 찾을 수 없습니다.';
        }
    } catch (error) {
        console.error('학습 기록 형식 확인 실패', error);
        recordsReady = false;
        setLearningControlsDisabled(true);
        formStatus.textContent = `기록을 불러오지 못했습니다. ${error.message}`;
        emptyMessage.hidden = false;
        emptyMessage.textContent = '저장된 원본은 유지됩니다. 페이지를 새로고침한 뒤 다시 확인해 주세요.';
    }
}

initializeLearningRecords();


function createReviewPanel(record, content) {
    const panel = document.createElement('div');
    panel.className = 'review-panel';
    if (!record.review || !review.answers(record).length) return panel;
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    panel.append(status);
    const results = review.results(record);
    if (!review.due(record)) review.highlight(content, results);
    if (record.location === LOCATION.BOOKCASE) {
        status.textContent = record.review.outcome === 'correct' ? '모든 빈칸을 맞힌 기록입니다.' : '';
        return panel;
    }
    if (!review.due(record)) {
        const date = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(record.review.dueAt));
        status.textContent = `${record.review.outcome === 'incorrect' ? '정답을 확인하세요. 다음 출제' : '빈칸 출제 예정'}: ${date}`;
        if (record.review.outcome === 'incorrect') {
            const answer = document.createElement('p');
            answer.className = 'review-answers';
            review.answers(record).forEach((text, index) => {
                if (index) answer.append(' / ');
                const item = document.createElement('span');
                const known = typeof results[index] === 'boolean';
                if (known) item.className = results[index] ? 'review-correct' : 'review-incorrect';
                item.textContent = `${index + 1}. ${known ? (results[index] ? '정답' : '오답') + ': ' : ''}${text}`;
                answer.append(item);
            });
            panel.append(answer);
        }
        return panel;
    }
    const quiz = review.mask(content);
    status.textContent = `빈칸 ${quiz.inputs.length}개에 답을 입력해 주세요. 비워 둔 항목은 오답으로 처리합니다.`;
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
        const results = quiz.inputs.map((input, index) => review.equal(input.value, quiz.answers[index]));
        const correct = results.every(Boolean);
        const updated = { ...record, location: correct ? LOCATION.BOOKCASE : LOCATION.DESK,
            review: { ...review.schedule(Date.now(), correct ? 'correct' : 'incorrect'), results } };
        const next = [updated, ...learningRecords.filter(item => item.id !== record.id)];
        saving = true;
        setLearningControlsDisabled(true);
        status.textContent = '풀이 결과 저장 중…';
        try {
            learningRecords = await saveRecords(next);
            renderRecords();
            recordMoveStatus.textContent = correct ? '정답입니다! 기록을 북케이스로 옮겼습니다.' : '틀린 답이 있습니다. 정답을 확인하세요. 30분 후 다시 출제합니다.';
            recordMoveStatus.tabIndex = -1;
            recordMoveStatus.focus({ preventScroll: true });
        } catch (error) {
            console.error('풀이 저장 실패', error);
            status.textContent = persistenceError(error, '결과를 저장하지 못했습니다. 입력한 답은 유지됩니다. 다시 시도해 주세요.');
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
