(() => {
    const PAGE_SIZE = 12;
    const LOCATION = window.TilRecordData.LOCATION;
    const categories = window.TilCategories;
    const store = window.TilLibrary.create();
    const $ = id => document.getElementById(id);
    const index = $('archiveIndex');
    const detail = $('archiveDetail');
    const status = $('archiveStatus');
    const search = $('archiveSearch');
    const categoryList = $('archiveCategories');
    const articles = $('archiveArticles');
    const pagination = $('archivePagination');
    const articleStatus = $('articleStatus');
    const moveButtons = [$('articleToBookcase'), $('articleToDesk')];
    const dateFormat = new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
    let ready = false;
    let saving = false;
    let requestNumber = 0;

    function state() {
        const query = new URLSearchParams(location.search);
        return {
            id: query.get('id'),
            q: query.get('q') || '',
            category: query.get('category') || 'all',
            page: Math.max(1, parseInt(query.get('page'), 10) || 1)
        };
    }

    function urlFor(next) {
        const url = new URL(location.href);
        url.search = '';
        url.hash = '';
        if (next.q) url.searchParams.set('q', next.q);
        if (next.category && next.category !== 'all') url.searchParams.set('category', next.category);
        if (next.page > 1) url.searchParams.set('page', String(next.page));
        if (next.id != null) url.searchParams.set('id', String(next.id));
        return url;
    }

    function navigate(next, { replace = false, focus = true } = {}) {
        if (saving) return;
        history[replace ? 'replaceState' : 'pushState'](null, '', urlFor(next));
        render({ focus });
    }

    function categoryOf(record) {
        const key = categories.key(record.category);
        return key ? `category:${key}` : 'uncategorized';
    }

    function dateOf(record) {
        return [record.archivedAt, record.date].find(value => typeof value === 'string' && Number.isFinite(Date.parse(value))) || null;
    }

    function makeDate(record) {
        const value = dateOf(record);
        const element = document.createElement(value ? 'time' : 'span');
        if (value) element.dateTime = value;
        element.textContent = value ? dateFormat.format(new Date(value)) : '날짜 미기록';
        return element;
    }

    function archiveRecords() {
        return store.document.records.filter(record => record.location === LOCATION.ARCHIVE)
            .sort((a, b) => (Date.parse(dateOf(b)) || 0) - (Date.parse(dateOf(a)) || 0));
    }

    function categoryOptions(records) {
        return [
            { key: 'all', name: '전체', count: records.length },
            ...categories.catalog(records).map(item => ({ ...item, key: `category:${item.key}` })),
            { key: 'uncategorized', name: '미분류', count: records.filter(record => !categories.key(record.category)).length }
        ];
    }

    function renderCategories(records, current) {
        const options = categoryOptions(records);
        categoryList.replaceChildren();
        options.forEach(option => {
            if (!option.count && option.key === 'uncategorized' && current.category !== option.key) return;
            const button = document.createElement('button');
            button.type = 'button';
            button.dataset.categoryFilter = option.key;
            button.setAttribute('aria-pressed', String(option.key === current.category));
            const label = document.createElement('span');
            label.textContent = option.name;
            const count = document.createElement('span');
            count.textContent = option.count;
            button.append(label, count);
            button.addEventListener('click', () => navigate({ ...current, category: option.key, page: 1, id: null }));
            categoryList.appendChild(button);
        });
        $('archiveListTitle').textContent = current.category === 'all' ? '모든 글'
            : options.find(option => option.key === current.category)?.name || '선택한 카테고리';
    }

    function card(record, current) {
        const element = document.createElement('article');
        element.className = 'archive-card';
        const link = document.createElement('a');
        link.className = 'archive-card-link';
        link.href = urlFor({ ...current, id: record.id });
        const category = document.createElement('span');
        category.className = 'card-category';
        category.textContent = categories.clean(record.category) || '미분류';
        const title = document.createElement('h3');
        title.textContent = record.title || '제목 없는 기록';
        const excerpt = document.createElement('p');
        excerpt.className = 'card-excerpt';
        excerpt.textContent = (record.content || '').replace(/\s+/g, ' ').trim().slice(0, 220) || '내용이 없는 기록입니다.';
        const bottom = document.createElement('div');
        bottom.className = 'card-bottom';
        const arrow = document.createElement('span');
        arrow.setAttribute('aria-hidden', 'true');
        arrow.textContent = '↗';
        bottom.append(makeDate(record), arrow);
        link.append(category, title, excerpt, bottom);
        link.addEventListener('click', event => {
            if (event.button || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
            event.preventDefault();
            navigate({ ...current, id: record.id });
        });
        element.appendChild(link);
        return element;
    }

    function renderPagination(current, pages) {
        pagination.replaceChildren();
        pagination.hidden = pages < 2;
        if (pages < 2) return;
        function button(label, page, disabled = false, active = false) {
            const element = document.createElement('button');
            element.type = 'button';
            element.textContent = label;
            element.disabled = disabled;
            if (active) element.setAttribute('aria-current', 'page');
            element.setAttribute('aria-label', /^\d+$/.test(label) ? `${label}페이지` : label);
            element.addEventListener('click', () => navigate({ ...current, page, id: null }));
            pagination.appendChild(element);
        }
        button('← 이전', current.page - 1, current.page === 1);
        const visible = [...new Set([1, pages, current.page - 1, current.page, current.page + 1])]
            .filter(page => page >= 1 && page <= pages).sort((a, b) => a - b);
        let previous = 0;
        visible.forEach(page => {
            if (previous && page - previous > 1) {
                const gap = document.createElement('span');
                gap.className = 'pagination-gap';
                gap.textContent = '…';
                pagination.appendChild(gap);
            }
            button(String(page), page, false, current.page === page);
            previous = page;
        });
        button('다음 →', current.page + 1, current.page === pages);
    }

    function renderIndex(current, records) {
        index.hidden = false;
        detail.hidden = true;
        document.title = '아카이브 · 나의 지식 서재';
        $('archiveTotal').textContent = records.length.toLocaleString('ko-KR');
        search.value = current.q;
        const query = categories.key(current.q);
        const searched = records.filter(record => !query || categories.key(`${record.title || ''} ${record.content || ''} ${record.category || ''}`).includes(query));
        renderCategories(searched, current);
        const filtered = searched.filter(record => current.category === 'all' || categoryOf(record) === current.category);
        const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
        current.page = Math.min(current.page, pages);
        history.replaceState(null, '', urlFor(current));
        const start = (current.page - 1) * PAGE_SIZE;
        articles.replaceChildren(...filtered.slice(start, start + PAGE_SIZE).map(record => card(record, current)));
        $('archiveResultCount').textContent = filtered.length ? `${filtered.length.toLocaleString('ko-KR')}편 · ${current.page} / ${pages} 페이지` : '0편';
        $('archiveEmpty').hidden = filtered.length > 0;
        const emptyArchive = records.length === 0;
        $('archiveEmptyTitle').textContent = emptyArchive ? '아직 아카이브에 글이 없습니다.' : '조건에 맞는 글이 없습니다.';
        $('archiveEmptyText').textContent = emptyArchive ? '데스크나 북케이스에서 충분히 익힌 기록을 아카이브로 보내세요.' : '다른 검색어를 입력하거나 전체 카테고리를 선택해 보세요.';
        renderPagination(current, pages);
    }

    function renderDetail(record, current) {
        index.hidden = true;
        detail.hidden = false;
        const title = record.title || '제목 없는 기록';
        document.title = `${title} · 아카이브`;
        $('articleTitle').textContent = title;
        $('archiveBack').href = urlFor({ ...current, id: null });
        const category = document.createElement('span');
        category.className = 'article-category';
        category.textContent = categories.clean(record.category) || '미분류';
        $('articleMeta').replaceChildren(category, makeDate(record));
        const content = $('articleContent');
        content.replaceChildren();
        content.className = 'article-content rich-text';
        window.TilEditor.render(record, content);
        content.classList.toggle('plain-text', record.contentFormat !== 'tiptap-v1');
        const edit = new URL('../', location.href);
        edit.searchParams.set('edit', String(record.id));
        edit.searchParams.set('return', 'archive');
        $('articleEdit').href = edit;
        articleStatus.textContent = '';
        delete articleStatus.dataset.error;
    }

    function render({ focus = false } = {}) {
        if (!ready) return;
        const current = state();
        const records = archiveRecords();
        const record = current.id != null ? records.find(item => String(item.id) === current.id) : null;
        if (record) renderDetail(record, current);
        else {
            if (current.id != null) {
                status.textContent = '이 글은 아카이브에서 찾을 수 없습니다. 다른 공간으로 이동했거나 삭제되었을 수 있습니다.';
                current.id = null;
            }
            renderIndex(current, records);
        }
        if (focus) {
            const heading = record ? $('articleTitle') : $('archiveListTitle');
            heading.focus({ preventScroll: true });
            heading.scrollIntoView({ block: 'start' });
        }
    }

    async function moveRecord(location) {
        if (!ready || saving) return;
        const record = archiveRecords().find(item => String(item.id) === state().id);
        if (!record) return;
        saving = true;
        moveButtons.forEach(button => { button.disabled = true; });
        $('articleEdit').setAttribute('aria-disabled', 'true');
        const label = window.TilRecordData.LABELS[location];
        articleStatus.textContent = `${label}로 옮기는 중입니다…`;
        delete articleStatus.dataset.error;
        const next = { ...record, location, updatedAt: new Date().toISOString() };
        try {
            if (location === LOCATION.DESK && window.TilReview.answers(record).length) {
                next.review = window.TilReview.schedule(Date.now(), null, true);
            }
            await store.update(record.id, next);
            saving = false;
            status.textContent = `“${record.title || '제목 없는 기록'}”을 ${label}로 보냈습니다.`;
            delete status.dataset.error;
            navigate({ ...state(), id: null }, { replace: true });
        } catch (error) {
            articleStatus.textContent = `옮기지 못했습니다. ${error.message || '잠시 후 다시 시도해 주세요.'}`;
            articleStatus.dataset.error = 'true';
        } finally {
            saving = false;
            moveButtons.forEach(button => { button.disabled = false; });
            $('articleEdit').removeAttribute('aria-disabled');
        }
    }

    async function load() {
        const request = ++requestNumber;
        ready = false;
        index.hidden = true;
        detail.hidden = true;
        status.textContent = '기록을 불러오는 중입니다.';
        delete status.dataset.error;
        try {
            await store.load();
            if (request !== requestNumber) return;
            ready = true;
            status.textContent = '';
            render();
        } catch (error) {
            if (request !== requestNumber) return;
            status.textContent = `기록을 불러오지 못했습니다. ${error.message || '페이지를 새로고침해 주세요.'}`;
            status.dataset.error = 'true';
        }
    }

    $('archiveSearchForm').addEventListener('submit', event => {
        event.preventDefault();
        navigate({ ...state(), q: search.value.trim(), page: 1, id: null });
    });
    search.addEventListener('input', () => {
        navigate({ ...state(), q: search.value, page: 1, id: null }, { replace: true, focus: false });
    });
    $('archiveBack').addEventListener('click', event => {
        if (event.button || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
        event.preventDefault();
        navigate({ ...state(), id: null });
    });
    $('articleEdit').addEventListener('click', event => { if (saving) event.preventDefault(); });
    moveButtons[0].addEventListener('click', () => moveRecord(LOCATION.BOOKCASE));
    moveButtons[1].addEventListener('click', () => moveRecord(LOCATION.DESK));
    window.addEventListener('popstate', () => { if (!saving) render({ focus: true }); });
    window.addEventListener('app-auth-change', event => {
        if (['SIGNED_IN', 'SIGNED_OUT', 'USER_UPDATED'].includes(event.detail?.event)) load();
    });
    load();
})();
