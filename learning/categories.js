(function () {
    const clean = value => (typeof value === 'string' ? value : '').trim().replace(/\s+/g, ' ');
    const key = value => clean(value).toLocaleLowerCase('ko-KR');
    function catalog(records) {
        const groups = new Map();
        records.forEach(record => {
            const name = clean(record.category);
            if (!name) return;
            const id = key(name);
            if (!groups.has(id)) groups.set(id, { key: id, name, count: 0 });
            groups.get(id).count++;
        });
        return [...groups.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ko'));
    }
    function attach(input, list, getRecords) {
        let options = [];
        let active = -1;
        let composing = false;
        function close() {
            list.hidden = true;
            input.setAttribute('aria-expanded', 'false');
            input.removeAttribute('aria-activedescendant');
            active = -1;
        }
        function select(index) {
            if (!options[index]) return;
            input.value = options[index].name;
            close();
            input.focus({ preventScroll: true });
        }
        function render() {
            if (composing || input.disabled) return close();
            const query = key(input.value);
            const names = catalog(getRecords());
            const rank = item => item.key === query ? 0 : item.key.startsWith(query) ? 1 : 2;
            const matches = names.filter(item => item.key.includes(query))
                .sort((a, b) => rank(a) - rank(b) || b.count - a.count || a.name.localeCompare(b.name, 'ko'));
            const isNew = query && !names.some(item => item.key === query);
            options = matches.slice(0, isNew ? 3 : 4);
            if (isNew) options.push({ name: clean(input.value), isNew: true });
            list.replaceChildren();
            active = -1;
            input.removeAttribute('aria-activedescendant');
            options.forEach((option, index) => {
                const button = document.createElement('button');
                button.type = 'button';
                button.tabIndex = -1;
                button.id = `category-option-${index}`;
                button.setAttribute('role', 'option');
                button.setAttribute('aria-selected', 'false');
                button.textContent = option.isNew ? `+ “${option.name}”로 새로 사용` : `${option.name} · ${option.count}개 기록`;
                button.addEventListener('pointerdown', event => event.preventDefault());
                button.addEventListener('click', () => select(index));
                list.appendChild(button);
            });
            list.hidden = !options.length;
            input.setAttribute('aria-expanded', String(options.length > 0));
        }
        input.addEventListener('focus', render);
        input.addEventListener('input', render);
        input.addEventListener('blur', close);
        input.addEventListener('compositionstart', () => { composing = true; close(); });
        input.addEventListener('compositionend', () => { composing = false; render(); });
        input.addEventListener('keydown', event => {
            if (event.isComposing || composing || event.keyCode === 229) return;
            if (event.key === 'Escape') { event.preventDefault(); close(); return; }
            if (event.key === 'Tab') { close(); return; }
            if (event.key === 'Enter' && !list.hidden) {
                event.preventDefault();
                if (active >= 0) select(active);
                else close();
                return;
            }
            if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
            event.preventDefault();
            if (list.hidden) render();
            if (!options.length) return;
            active = active < 0 ? (event.key === 'ArrowDown' ? 0 : options.length - 1)
                : (active + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
            [...list.children].forEach((option, i) => option.setAttribute('aria-selected', String(i === active)));
            input.setAttribute('aria-activedescendant', list.children[active].id);
        });
        return { close };
    }
    window.TilCategories = { clean, key, catalog, attach };
})();
