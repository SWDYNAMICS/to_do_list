// Plan line rendering: category header, line sections, element cards and their forms.
(function initializePlanBoard() {
    const app = window.PlanApp;
    const { dom, state, announce, savePlans, formatPosition, getNodeKey, createActionButton } = app;
    const { CATEGORY_INFO, normalizeChainName } = window.PlanModel;

    function updateCategoryUI() {
        const info = CATEGORY_INFO[state.activeCategory];
        const categoryCounts = {
            personal: state.plans.getChains('personal').length,
            work: state.plans.getChains('work').length
        };

        dom.categoryTabs.forEach(tab => {
            const isActive = tab.dataset.category === state.activeCategory;
            tab.classList.toggle('is-active', isActive);
            tab.setAttribute('aria-selected', String(isActive));
            tab.tabIndex = isActive ? 0 : -1;
        });

        dom.personalTabCount.textContent = String(categoryCounts.personal);
        dom.workTabCount.textContent = String(categoryCounts.work);
        dom.composerTitle.textContent = `새 ${info.label} 계획 라인 만들기`;
        dom.inputHelp.textContent = `${info.label} 일정의 각 단계를 한 줄씩 입력하면 새 연결 리스트 한 개가 됩니다.`;
        dom.submitLabel.textContent = `${info.label} 라인 만들기`;
        dom.planInput.placeholder = info.placeholder;
        dom.planTitle.textContent = `${info.label} 연결 리스트`;
        dom.emptyTitle.textContent = `아직 ${info.label} 계획 라인이 없어요.`;
        dom.emptyDescription.textContent = `위 입력창에서 첫 번째 ${info.label} 계획을 만들어 보세요.`;
        dom.planLines.setAttribute('aria-labelledby', `${state.activeCategory}Tab`);
        dom.categoryPanel.setAttribute('aria-labelledby', `${state.activeCategory}Tab`);
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
            state.openInsertKey = null;
            render({ focusActionKey: key });
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
            state.openInsertKey = null;
            render({ focusNodeKey: getNodeKey(chain.id, inserted.id) });
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
            state.openEditKey = null;
            render({ focusEditKey: key });
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
            state.openEditKey = null;
            render({ focusEditKey: key });
            announce(`'${updated.previousText}' 계획을 '${updated.node.text}'(으)로 수정했습니다.`);
        });

        form.append(label, input, submitButton, cancelButton);
        window.requestAnimationFrame(() => {
            input.focus();
            input.select();
        });
        return form;
    }

    async function reorderNode(chain, node, targetIndex) {
        if (state.reorderPending) return;
        const previousIndex = chain.toArray().findIndex(item => item.id === node.id);
        if (!chain.move(node.id, targetIndex)) return;
        const page = document.querySelector('.plan-page');
        state.reorderPending = true;
        page.inert = true;
        announce('변경한 순서를 저장하고 있습니다.');
        let saved = false;
        try { saved = await savePlans({ cacheOnFailure: false }); }
        catch (error) { console.error('계획 순서 저장 실패', error); }
        finally {
            if (!saved) chain.move(node.id, previousIndex);
            state.reorderPending = false;
            page.inert = false;
        }
        const viewport = document.getElementById(`chain-${chain.id}`)?.querySelector('.chain-viewport');
        const scrollLeft = viewport?.scrollLeft || 0;
        render({ focusDragKey: getNodeKey(chain.id, node.id) });
        const nextViewport = document.getElementById(`chain-${chain.id}`)?.querySelector('.chain-viewport');
        if (nextViewport) nextViewport.scrollLeft = scrollLeft;
        announce(saved ? `${node.text} 계획을 ${targetIndex + 1}번째로 옮겼습니다.` : '순서를 저장하지 못해 원래 순서로 되돌렸습니다. 다시 시도해 주세요.');
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
        const dragHandle = createActionButton('⠿', 'node-drag-handle', () => {});
        dragHandle.id = `drag-${key}`;
        dragHandle.setAttribute('aria-label', `${node.text} 순서 이동`);
        dragHandle.title = '끌어서 이동 · 키보드 ← → / Home / End';
        dragHandle.setAttribute('aria-describedby', `reorder-help-${chain.id}`);
        dragHandle.disabled = chain.nodes.size < 2;
        window.PlanReorder.attach(dragHandle, item, {
            canStart: () => {
                if (state.reorderPending) return false;
                if (state.openEditKey || state.openInsertKey) { announce('수정 또는 추가를 마친 뒤 순서를 변경해 주세요.'); return false; }
                return true;
            },
            commit: index => reorderNode(chain, node, index),
            announce
        });
        meta.append(position, pointer, dragHandle);

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
            render({ focusCheckboxKey: key });
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
                state.openInsertKey = null;
                state.openEditKey = state.openEditKey === key ? null : key;
                render({ focusEditKey: state.openEditKey ? null : key });
            }
        );
        editButton.id = `edit-action-${key}`;
        editButton.setAttribute('aria-expanded', String(state.openEditKey === key));
        if (state.openEditKey === key) {
            editButton.setAttribute('aria-controls', `edit-form-${key}`);
        }
        editButton.setAttribute('aria-label', `${node.text} 계획 수정`);

        const insertButton = createActionButton(
            '뒤에 추가',
            'action-button insert-button',
            () => {
                state.openEditKey = null;
                state.openInsertKey = state.openInsertKey === key ? null : key;
                render({ focusActionKey: state.openInsertKey ? null : key });
            }
        );
        insertButton.id = `insert-action-${key}`;
        insertButton.setAttribute('aria-expanded', String(state.openInsertKey === key));
        if (state.openInsertKey === key) {
            insertButton.setAttribute('aria-controls', `insert-form-${key}`);
        }
        insertButton.setAttribute('aria-label', `${node.text} 뒤에 계획 추가`);

        const deleteButton = createActionButton(
            '삭제',
            'action-button delete-button',
            () => {
                const categoryChains = state.plans.getChains(chain.category);
                const chainIndex = categoryChains.findIndex(itemChain => itemChain.id === chain.id);
                const nextFocusNodeId = node.next || chain.findPrevious(node.id)?.id || null;
                const isLastNode = chain.toArray().length === 1;
                if (isLastNode) state.plans.removeChain(chain.id);
                const removed = chain.remove(node.id);
                if (!removed) return;

                let focusNodeKey = nextFocusNodeId
                    ? getNodeKey(chain.id, nextFocusNodeId)
                    : null;
                let focusChainId = null;

                if (!chain.toArray().length) {
                    const remainingChains = state.plans.getChains(chain.category);
                    focusNodeKey = null;
                    focusChainId = remainingChains[chainIndex]?.id
                        || remainingChains[chainIndex - 1]?.id
                        || null;
                }

                if (state.openInsertKey === key) state.openInsertKey = null;
                if (state.openEditKey === key) state.openEditKey = null;
                savePlans();
                render({
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

        if (state.openEditKey === key) {
            card.appendChild(createEditForm(chain, node));
        }

        if (state.openInsertKey === key) {
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
        title.textContent = chain.name || `라인 ${formatPosition(lineIndex)}`;
        const renameButton = createActionButton('이름 수정', 'rename-chain-button', () => {
            renameForm.hidden = !renameForm.hidden;
            renameButton.setAttribute('aria-expanded', String(!renameForm.hidden));
            if (!renameForm.hidden) { nameInput.value = title.textContent; nameInput.focus(); nameInput.select(); }
        });
        renameButton.setAttribute('aria-expanded', 'false');
        renameButton.setAttribute('aria-controls', `rename-${chain.id}`);
        renameButton.setAttribute('aria-label', `${title.textContent} 이름 수정`);
        const renameForm = document.createElement('form');
        renameForm.className = 'rename-chain-form';
        renameForm.id = `rename-${chain.id}`;
        renameForm.hidden = true;
        const nameLabel = document.createElement('label');
        nameLabel.htmlFor = `chain-name-${chain.id}`;
        nameLabel.textContent = '라인 이름';
        const nameInput = document.createElement('input');
        nameInput.id = nameLabel.htmlFor;
        nameInput.className = 'chain-name-input';
        nameInput.maxLength = 80;
        nameInput.required = true;
        const submitName = document.createElement('button');
        submitName.type = 'submit';
        submitName.textContent = '저장';
        const cancelName = createActionButton('취소', 'cancel-chain-name', () => {
            renameForm.hidden = true;
            renameButton.setAttribute('aria-expanded', 'false');
            renameButton.focus();
        });
        nameInput.addEventListener('input', () => nameInput.setCustomValidity(''));
        nameInput.addEventListener('keydown', event => {
            if (event.key === 'Escape') { event.preventDefault(); cancelName.click(); }
        });
        renameForm.addEventListener('submit', async event => {
            event.preventDefault();
            const name = normalizeChainName(nameInput.value);
            if (!name) { nameInput.setCustomValidity('라인 이름을 입력해 주세요.'); nameInput.reportValidity(); return; }
            const previousName = chain.name;
            chain.name = name;
            submitName.disabled = true;
            cancelName.disabled = true;
            nameInput.disabled = true;
            let saved = false;
            try { saved = await savePlans({ cacheOnFailure: false }); }
            catch (error) { console.error('라인 이름 저장 실패', error); }
            if (saved) {
                render({ focusChainId: chain.id });
                announce(`${name}으로 라인 이름을 변경했습니다.`);
            } else {
                chain.name = previousName;
                submitName.disabled = false;
                cancelName.disabled = false;
                nameInput.disabled = false;
                nameInput.focus();
                announce('이름을 저장하지 못했습니다. 다시 시도해 주세요.');
            }
        });
        renameForm.append(nameLabel, nameInput, submitName, cancelName);
        titleGroup.append(kicker, title, renameButton);

        const headingActions = document.createElement('div');
        headingActions.className = 'chain-heading-actions';

        const count = document.createElement('span');
        count.className = 'chain-count';
        count.textContent = `${completed} / ${nodes.length} 완료`;

        const deleteChainButton = createActionButton(
            '라인 전체 삭제',
            'delete-chain-button',
            () => {
                const categoryChains = state.plans.getChains(chain.category);
                const currentIndex = categoryChains.findIndex(itemChain => itemChain.id === chain.id);
                const removed = state.plans.removeChain(chain.id);
                if (!removed) return;

                const remainingChains = state.plans.getChains(chain.category);
                const nextFocusId = remainingChains[currentIndex]?.id
                    || remainingChains[currentIndex - 1]?.id
                    || null;

                if (state.openInsertKey?.startsWith(`${chain.id}--`)) state.openInsertKey = null;
                if (state.openEditKey?.startsWith(`${chain.id}--`)) state.openEditKey = null;
                savePlans();
                render({ focusChainId: nextFocusId, focusInput: !nextFocusId });
                announce(`${title.textContent}을 삭제하고 삭제 내역에 보관했습니다.`);
            }
        );
        deleteChainButton.setAttribute('aria-label', `${title.textContent} 전체 삭제`);

        headingActions.append(count, deleteChainButton);
        heading.append(titleGroup, headingActions);

        const viewport = document.createElement('div');
        viewport.className = 'chain-viewport';
        viewport.tabIndex = 0;
        viewport.setAttribute('role', 'region');
        viewport.setAttribute('aria-label', `${title.textContent} 가로 연결 목록`);

        const scrollHint = document.createElement('p');
        scrollHint.className = 'scroll-hint';
        scrollHint.id = `reorder-help-${chain.id}`;
        scrollHint.textContent = '⠿ 손잡이를 끌어 같은 라인 안에서 순서를 바꾸세요. 키보드는 ← → / Home / End, 취소는 Escape. 화면 가장자리에서 계속 끌면 자동으로 스크롤됩니다.';

        const list = document.createElement('ol');
        list.className = 'plan-list';
        list.setAttribute('role', 'list');
        nodes.forEach((node, nodeIndex) => {
            list.appendChild(createPlanNode(chain, node, nodeIndex, positions, lineIndex));
        });

        viewport.appendChild(list);
        section.append(heading, renameForm, scrollHint, viewport);
        return section;
    }

    function updateProgress(chains) {
        const nodes = chains.flatMap(chain => chain.toArray());
        const completed = nodes.filter(node => node.completed).length;
        const total = nodes.length;
        const percentage = total ? Math.round((completed / total) * 100) : 0;
        const categoryLabel = CATEGORY_INFO[state.activeCategory].label;

        dom.progressText.textContent = `${chains.length}개 라인 · ${completed} / ${total} 완료`;
        dom.progressBar.style.width = `${percentage}%`;
        dom.progressTrack.setAttribute('aria-valuenow', String(percentage));
        dom.progressTrack.setAttribute(
            'aria-valuetext',
            `${categoryLabel} 일정 ${chains.length}개 라인, ${total}개 중 ${completed}개 완료`
        );
    }

    function render(focusTarget = {}) {
        const categoryChains = state.plans.getChains(state.activeCategory);
        updateCategoryUI();
        app.routines.render();
        dom.planLines.replaceChildren();
        categoryChains.forEach((chain, index) => {
            dom.planLines.appendChild(createChainSection(chain, index));
        });

        dom.emptyState.hidden = categoryChains.length > 0;
        updateProgress(categoryChains);
        app.history.render();

        window.requestAnimationFrame(() => {
            if (focusTarget.focusDragKey) {
                document.getElementById(`drag-${focusTarget.focusDragKey}`)?.focus({ preventScroll: true });
            } else if (focusTarget.focusNodeKey) {
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
                dom.planInput.focus();
            }
        });
    }

    app.board = Object.freeze({ render });
})();
