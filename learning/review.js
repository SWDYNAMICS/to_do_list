// Review deadlines are persisted timestamps, never countdown timers.
(() => {
    const INTERVAL = 30 * 60 * 1000;
    function slots(container) {
        const result = [];
        let current = null;
        const walker = document.createTreeWalker(container, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
            const node = walker.currentNode;
            if (node.nodeType === Node.ELEMENT_NODE) {
                if (node.matches('p,h1,h2,h3,h4,h5,h6,li,td,th,br,pre')) current = null;
                continue;
            }
            if (!node.parentElement.closest('u') || node.parentElement.closest('.editor-outline')) {
                current = null;
                continue;
            }
            if (!current) {
                current = { text: '', start: node, end: node };
                result.push(current);
            }
            current.text += node.textContent;
            current.end = node;
        }
        return result.filter(slot => slot.text.trim());
    }
    function answers(record) {
        const container = document.createElement('div');
        window.TilEditor.render(record, container);
        return slots(container).map(slot => slot.text);
    }
    function schedule(now = Date.now(), outcome = null, immediate = false) {
        return { version: 2, dueAt: new Date(now + (immediate ? 0 : INTERVAL)).toISOString(), outcome };
    }
    function normalize(value) {
        if (![1, 2].includes(value?.version) || !Number.isFinite(Date.parse(value.dueAt))) return null;
        // Older local reviews used a 24-hour interval. Preserve their starting time.
        const dueAt = Date.parse(value.dueAt) - (value.version === 1 ? 24 * 60 * 60 * 1000 - INTERVAL : 0);
        return { version: 2, dueAt: new Date(dueAt).toISOString(),
            outcome: ['correct', 'incorrect'].includes(value.outcome) ? value.outcome : null };
    }
    function due(record) {
        return record.location !== 'archive' && record.review && Date.parse(record.review.dueAt) <= Date.now();
    }
    function mask(container, disabled = false) {
        // The generated outline duplicates headings and would reveal underlined answers.
        container.querySelectorAll('.editor-outline').forEach(element => element.remove());
        const groups = slots(container);
        const inputs = groups.map((slot, index) => {
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'review-blank';
            input.setAttribute('aria-label', `빈칸 ${index + 1}`);
            input.autocomplete = 'off';
            input.spellcheck = false;
            input.disabled = disabled;
            input.style.width = `${Math.max(6, Math.min(36, Array.from(slot.text).length * 1.5))}ch`;
            return input;
        });
        for (let index = groups.length - 1; index >= 0; index--) {
            const slot = groups[index];
            const range = document.createRange();
            range.setStart(slot.start, 0);
            range.setEnd(slot.end, slot.end.textContent.length);
            range.deleteContents();
            range.insertNode(inputs[index]);
            // An input must not inherit navigation from an underlined link.
            const link = inputs[index].closest('a');
            if (link) link.replaceWith(...link.childNodes);
        }
        return { inputs, answers: groups.map(slot => slot.text) };
    }
    const equal = (input, answer) => input.normalize('NFC').trim() === answer.normalize('NFC').trim();
    window.TilReview = { answers, schedule, normalize, due, mask, equal };
})();
