// Deleted-line history panel and the swipe gesture that switches to it.
(function initializePlanHistory() {
    const app = window.PlanApp;
    const { dom, state, announce, savePlans, createActionButton } = app;
    const { CATEGORY_INFO } = window.PlanModel;

    const dateFormat = new Intl.DateTimeFormat('ko-KR', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false
    });

    function render() {
        const entries = state.plans.getDeletedChains(state.activeCategory);
        dom.activePlans.hidden = state.historyOpen;
        dom.historyPanel.hidden = !state.historyOpen;
        dom.historyToggle.textContent = state.historyOpen ? '현재 계획으로 돌아가기' : `삭제 내역 (${entries.length})`;
        dom.historyToggle.setAttribute('aria-expanded', String(state.historyOpen));
        dom.historyHint.textContent = state.historyOpen
            ? '← 왼쪽으로 밀면 현재 계획'
            : '오른쪽으로 밀면 삭제 내역 →';
        dom.historyTitle.textContent = `${CATEGORY_INFO[state.activeCategory].label} 삭제 내역`;
        dom.historyEmpty.hidden = entries.length > 0;
        dom.historyList.replaceChildren();
        entries.forEach((entry, index) => {
            const row = document.createElement('li');
            row.className = 'history-entry';
            const heading = document.createElement('div');
            heading.className = 'history-entry-heading';
            const date = document.createElement(entry.createdAt ? 'time' : 'span');
            if (entry.createdAt) date.dateTime = entry.createdAt;
            date.textContent = entry.createdAt
                ? `${dateFormat.format(new Date(entry.createdAt))} 생성`
                : '생성 시각 미기록';
            const content = document.createElement('p');
            content.textContent = entry.items.join(' → ');
            const deleteButton = createActionButton('영구삭제', 'delete-chain-button history-delete-button',
                () => deleteEntry(entry, index));
            deleteButton.disabled = state.historyDeletePending;
            deleteButton.setAttribute('aria-label', `${date.textContent} 기록 ${index + 1} 영구삭제`);
            heading.append(date, deleteButton);
            const historyName = document.createElement('strong');
            historyName.className = 'history-chain-name';
            historyName.textContent = entry.name || '이름 없는 라인';
            row.append(heading, historyName, content);
            dom.historyList.appendChild(row);
        });
    }

    async function deleteEntry(entry, index) {
        if (state.historyDeletePending) return;
        if (!window.confirm(`이 기록을 영구삭제할까요? 삭제 후에는 복구할 수 없습니다.\n\n${entry.items.join(' → ')}`)) return;
        const originalIndex = state.plans.deletedChains.indexOf(entry);
        if (!state.plans.removeDeletedChain(entry)) return;
        state.historyDeletePending = true;
        render();
        let saved = false;
        try {
            saved = await savePlans({ cacheOnFailure: false });
        } catch (error) {
            console.error('삭제 내역을 영구삭제하지 못했습니다.', error);
        }
        if (!saved) state.plans.deletedChains.splice(originalIndex, 0, entry);
        state.historyDeletePending = false;
        render();
        const buttons = dom.historyList.querySelectorAll('.history-delete-button');
        (buttons[Math.min(index, buttons.length - 1)] || dom.historyToggle).focus();
        announce(saved
            ? '선택한 기록을 영구삭제했습니다.'
            : '영구삭제 내용을 저장하지 못했습니다. 연결 또는 저장 공간을 확인하고 다시 시도해 주세요.');
    }

    function setOpen(open) {
        if (state.historyOpen === open) return;
        state.historyOpen = open;
        render();
        announce(`${CATEGORY_INFO[state.activeCategory].label} ${open ? '삭제 내역' : '현재 계획'}을 표시합니다.`);
    }

    dom.historyToggle.addEventListener('click', () => setOpen(!state.historyOpen));

    // Keep horizontal scrolling inside a plan line independent from history navigation.
    let swipe = null;
    let suppressSwipeClickUntil = 0;
    dom.planBoard.addEventListener('touchstart', event => {
        swipe = null;
        if (event.touches.length !== 1) return;
        const target = event.target;
        if (target.closest('.chain-viewport, input, textarea, a, button:not(.plan-tab)')) return;
        const touch = event.touches[0];
        swipe = { x: touch.clientX, y: touch.clientY, at: Date.now() };
    }, { passive: true });

    dom.planBoard.addEventListener('touchmove', event => {
        if (!swipe) return;
        if (event.touches.length !== 1) {
            swipe = null;
            return;
        }
        const dx = event.touches[0].clientX - swipe.x;
        const dy = event.touches[0].clientY - swipe.y;
        if (Math.abs(dy) > 20 && Math.abs(dy) > Math.abs(dx)) {
            swipe = null;
            return;
        }
        if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) * 1.5
            && (state.historyOpen ? dx < 0 : dx > 0)) event.preventDefault();
    }, { passive: false });

    dom.planBoard.addEventListener('touchend', event => {
        if (!swipe) return;
        const start = swipe;
        swipe = null;
        const touch = event.changedTouches[0];
        const dx = touch.clientX - start.x;
        const dy = touch.clientY - start.y;
        if (Date.now() - start.at > 1000 || Math.abs(dx) < 64
            || Math.abs(dx) < Math.abs(dy) * 1.5) return;
        if (state.historyOpen ? dx >= 0 : dx <= 0) return;
        suppressSwipeClickUntil = Date.now() + 400;
        setOpen(dx > 0);
    }, { passive: true });

    dom.planBoard.addEventListener('touchcancel', () => { swipe = null; });
    dom.planBoard.addEventListener('click', event => {
        if (Date.now() < suppressSwipeClickUntil) {
            event.preventDefault();
            event.stopPropagation();
        }
    }, true);

    app.history = Object.freeze({ render, setOpen });
})();
