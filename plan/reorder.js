// Pointer Events support mouse, touch and pen without changing the card layout.
window.PlanReorder = {
    attach(handle, item, { canStart, commit, announce }) {
        let pointerActive = false;
        handle.addEventListener('keydown', event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            if (pointerActive || !canStart()) return;
            const items = [...item.parentElement.children];
            const index = items.indexOf(item);
            const target = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
                : Math.max(0, Math.min(items.length - 1, index + (event.key === 'ArrowLeft' ? -1 : 1)));
            commit(target);
        });
        handle.addEventListener('pointerdown', event => {
            if (!event.isPrimary || event.button !== 0 || !canStart()) return;
            const list = item.parentElement;
            const viewport = list.closest('.chain-viewport');
            const vertical = getComputedStyle(list).gridTemplateColumns.trim().split(/\s+/).length === 1;
            const others = [...list.children].filter(element => element !== item);
            if (!others.length) return;
            event.preventDefault();
            handle.focus({ preventScroll: true });
            handle.setPointerCapture(event.pointerId);
            pointerActive = true;
            const start = { x: event.clientX, y: event.clientY };
            let point = start;
            let active = false;
            let target = null;
            let frame;
            let ghost;
            const clearMarkers = () => others.forEach(element => element.classList.remove('drop-before', 'drop-after'));
            const locate = () => {
                clearMarkers();
                const bounds = viewport.getBoundingClientRect();
                target = null;
                if (point.x < bounds.left || point.x > bounds.right || point.y < bounds.top || point.y > bounds.bottom) return;
                // Find the closest card in the existing multi-row grid.
                const nearest = others.map((element, index) => {
                    const box = element.getBoundingClientRect();
                    const dx = Math.max(box.left - point.x, 0, point.x - box.right);
                    const dy = Math.max(box.top - point.y, 0, point.y - box.bottom);
                    return { element, index, box, distance: dx * dx + dy * dy };
                }).sort((a, b) => a.distance - b.distance)[0];
                const after = vertical ? point.y >= nearest.box.top + nearest.box.height / 2
                    : point.x >= nearest.box.left + nearest.box.width / 2;
                target = nearest.index + (after ? 1 : 0);
                nearest.element.classList.add(after ? 'drop-after' : 'drop-before');
            };
            const tick = () => {
                if (!item.isConnected) { cancel(); return; }
                if (active) {
                    const bounds = viewport.getBoundingClientRect();
                    if (point.y >= bounds.top && point.y <= bounds.bottom && point.x >= bounds.left && point.x <= bounds.right) {
                        const edge = 48;
                        const speed = point.x < bounds.left + edge ? -10 : point.x > bounds.right - edge ? 10 : 0;
                        viewport.scrollLeft += speed;
                        if (point.y < 48) window.scrollBy({ top: -10, behavior: 'instant' });
                        else if (point.y > innerHeight - 48) window.scrollBy({ top: 10, behavior: 'instant' });
                    }
                    ghost.style.left = `${point.x + 12}px`;
                    ghost.style.top = `${point.y + 12}px`;
                    locate();
                }
                frame = requestAnimationFrame(tick);
            };
            const move = event => {
                if (event.pointerId !== eventId) return;
                point = { x: event.clientX, y: event.clientY };
                if (!active && Math.hypot(point.x - start.x, point.y - start.y) >= 6) {
                    active = true;
                    item.classList.add('is-dragging');
                    ghost = document.createElement('div');
                    ghost.className = 'node-drag-ghost';
                    ghost.textContent = item.querySelector('.node-title').textContent;
                    ghost.setAttribute('aria-hidden', 'true');
                    document.body.append(ghost);
                    announce('원하는 위치로 옮긴 뒤 놓으세요. Escape로 취소할 수 있습니다.');
                }
                if (active) locate();
            };
            const cleanup = () => {
                pointerActive = false;
                cancelAnimationFrame(frame);
                clearMarkers();
                item.classList.remove('is-dragging');
                ghost?.remove();
                handle.removeEventListener('pointermove', move);
                handle.removeEventListener('pointerup', drop);
                handle.removeEventListener('pointercancel', cancel);
                handle.removeEventListener('lostpointercapture', cancel);
                window.removeEventListener('keydown', keydown);
                window.removeEventListener('blur', cancel);
                if (handle.hasPointerCapture(eventId)) handle.releasePointerCapture(eventId);
            };
            const cancel = () => { cleanup(); if (active) announce('순서 변경을 취소했습니다.'); };
            const drop = event => {
                if (event.pointerId !== eventId) return;
                point = { x: event.clientX, y: event.clientY };
                if (active) locate();
                cleanup();
                if (active && target !== null) commit(target);
                else if (active) announce('같은 라인 안에 놓아 주세요. 순서 변경을 취소했습니다.');
            };
            const keydown = event => {
                if (event.key === 'Escape') { event.preventDefault(); cancel(); }
                // Avoid keyboard reordering while pointer capture is active.
                else if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) event.preventDefault();
            };
            const eventId = event.pointerId;
            handle.addEventListener('pointermove', move);
            handle.addEventListener('pointerup', drop);
            handle.addEventListener('pointercancel', cancel);
            handle.addEventListener('lostpointercapture', cancel);
            window.addEventListener('keydown', keydown);
            window.addEventListener('blur', cancel);
            frame = requestAnimationFrame(tick);
        });
    }
};
