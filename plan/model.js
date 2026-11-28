(function initializePlanModel() {
    const CATEGORY_INFO = Object.freeze({
        personal: {
            label: '개인',
            placeholder: '씻기\n밥 먹기\n산책 가기'
        },
        work: {
            label: '회사',
            placeholder: '메일 확인\n회의 준비\n업무 보고'
        }
    });

    function normalizeCategory(value) {
        return Object.prototype.hasOwnProperty.call(CATEGORY_INFO, value) ? value : 'personal';
    }

    function createId() {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return crypto.randomUUID();
        }
        return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }

    function isValidId(value) {
        return typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
    }

    function normalizeCreatedAt(value) {
        return typeof value === 'string' && Number.isFinite(Date.parse(value))
            ? new Date(value).toISOString() : null;
    }

    const NOTE_MAX_LENGTH = 500;

    function normalizeNotes(value) {
        if (!Array.isArray(value)) return [];
        const seen = new Set();
        return value.filter(note => note && isValidId(note.id) && typeof note.text === 'string'
            && note.text.trim() && !seen.has(note.id) && seen.add(note.id))
            .map(note => ({ id: note.id, text: note.text.trim().slice(0, NOTE_MAX_LENGTH) }));
    }

    function normalizeChainName(value) {
        return typeof value === 'string' ? value.trim().slice(0, 80) : '';
    }

    class LinkedPlan {
        constructor(id = createId(), head = null, nodes = [], category = 'personal', createdAt = null, name = '') {
            this.id = isValidId(id) ? id : createId();
            this.head = head;
            this.createdAt = normalizeCreatedAt(createdAt);
            this.name = normalizeChainName(name);
            this.category = normalizeCategory(category);
            this.nodes = new Map(nodes.map(node => [node.id, node]));
            this.repairLinks();
        }

        static fromData(data) {
            if (!data || !Array.isArray(data.nodes)) return null;

            const seenIds = new Set();
            const nodes = data.nodes
                .filter(node => {
                    const hasValidShape = node
                        && isValidId(node.id)
                        && typeof node.text === 'string'
                        && Boolean(node.text.trim())
                        && !seenIds.has(node.id);

                    if (hasValidShape) seenIds.add(node.id);
                    return hasValidShape;
                })
                .map(node => ({
                    id: node.id,
                    text: node.text.trim(),
                    completed: Boolean(node.completed),
                    notes: normalizeNotes(node.notes),
                    next: isValidId(node.next) ? node.next : null
                }));

            const head = isValidId(data.head) ? data.head : null;
            return new LinkedPlan(data.id, head, nodes, data.category, data.createdAt, data.name);
        }

        createNode(text) {
            let id;
            do {
                id = createId();
            } while (this.nodes.has(id));

            return {
                id,
                text: text.trim(),
                completed: false,
                notes: [],
                next: null
            };
        }

        // Notes are plain findings attached below an element; they are never checkable.
        addNote(nodeId, text, afterNoteId = null) {
            const node = this.nodes.get(nodeId);
            const cleanText = text.trim().slice(0, NOTE_MAX_LENGTH);
            if (!node || !cleanText) return null;
            if (!Array.isArray(node.notes)) node.notes = [];
            let id;
            do {
                id = createId();
            } while (node.notes.some(note => note.id === id));
            const note = { id, text: cleanText };
            const afterIndex = afterNoteId ? node.notes.findIndex(item => item.id === afterNoteId) : -1;
            node.notes.splice(afterIndex < 0 ? node.notes.length : afterIndex + 1, 0, note);
            return note;
        }

        updateNote(nodeId, noteId, text) {
            const note = this.nodes.get(nodeId)?.notes?.find(item => item.id === noteId);
            const cleanText = text.trim().slice(0, NOTE_MAX_LENGTH);
            if (!note || !cleanText) return null;
            const previousText = note.text;
            note.text = cleanText;
            return { note, previousText };
        }

        removeNote(nodeId, noteId) {
            const notes = this.nodes.get(nodeId)?.notes;
            const index = notes ? notes.findIndex(item => item.id === noteId) : -1;
            return index < 0 ? null : notes.splice(index, 1)[0];
        }

        appendMany(texts) {
            const validTexts = texts.map(text => text.trim()).filter(Boolean);
            if (!validTexts.length) return [];

            let previous = this.getTail();
            const created = [];

            validTexts.forEach(text => {
                const node = this.createNode(text);
                this.nodes.set(node.id, node);

                if (previous) {
                    previous.next = node.id;
                } else {
                    this.head = node.id;
                }

                previous = node;
                created.push(node);
            });

            return created;
        }

        insertAfter(nodeId, text) {
            const previous = this.nodes.get(nodeId);
            const cleanText = text.trim();
            if (!previous || !cleanText) return null;

            const node = this.createNode(cleanText);
            node.next = previous.next;
            previous.next = node.id;
            this.nodes.set(node.id, node);
            return node;
        }

        remove(nodeId) {
            const target = this.nodes.get(nodeId);
            if (!target) return null;

            if (this.head === nodeId) {
                this.head = target.next;
            } else {
                const previous = this.findPrevious(nodeId);
                if (!previous) return null;
                previous.next = target.next;
            }

            this.nodes.delete(nodeId);
            return target;
        }

        move(nodeId, targetIndex) {
            const ordered = this.toArray();
            const index = ordered.findIndex(node => node.id === nodeId);
            if (index < 0 || !Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= ordered.length || index === targetIndex) return false;
            const [node] = ordered.splice(index, 1);
            ordered.splice(targetIndex, 0, node);
            this.head = ordered[0].id;
            ordered.forEach((item, position) => { item.next = ordered[position + 1]?.id || null; });
            return true;
        }

        toggle(nodeId) {
            const node = this.nodes.get(nodeId);
            if (!node) return null;
            node.completed = !node.completed;
            return node;
        }

        updateText(nodeId, text) {
            const node = this.nodes.get(nodeId);
            const cleanText = text.trim();
            if (!node || !cleanText) return null;

            const previousText = node.text;
            node.text = cleanText;
            return { node, previousText };
        }

        findPrevious(nodeId) {
            let current = this.head ? this.nodes.get(this.head) : null;
            const visited = new Set();

            while (current && !visited.has(current.id)) {
                if (current.next === nodeId) return current;
                visited.add(current.id);
                current = current.next ? this.nodes.get(current.next) : null;
            }

            return null;
        }

        getTail() {
            let current = this.head ? this.nodes.get(this.head) : null;
            if (!current) return null;

            const visited = new Set();
            while (current.next && this.nodes.has(current.next) && !visited.has(current.next)) {
                visited.add(current.id);
                current = this.nodes.get(current.next);
            }
            return current;
        }

        toArray() {
            const result = [];
            const visited = new Set();
            let current = this.head ? this.nodes.get(this.head) : null;

            while (current && !visited.has(current.id)) {
                result.push(current);
                visited.add(current.id);
                current = current.next ? this.nodes.get(current.next) : null;
            }

            return result;
        }

        repairLinks() {
            if (!this.nodes.size) {
                this.head = null;
                return;
            }

            if (!this.head || !this.nodes.has(this.head)) {
                this.head = this.nodes.keys().next().value;
            }

            const reachable = new Set();
            let current = this.nodes.get(this.head);

            while (current && !reachable.has(current.id)) {
                reachable.add(current.id);

                if (current.next && (!this.nodes.has(current.next) || reachable.has(current.next))) {
                    current.next = null;
                }

                current = current.next ? this.nodes.get(current.next) : null;
            }

            for (const id of this.nodes.keys()) {
                if (!reachable.has(id)) this.nodes.delete(id);
            }
        }

        toData() {
            return {
                id: this.id,
                head: this.head,
                category: this.category,
                createdAt: this.createdAt,
                name: this.name,
                nodes: this.toArray()
            };
        }
    }

    class PlanCollection {
        constructor(chains = [], deletedChains = []) {
            this.chains = chains.filter(chain => chain.toArray().length > 0);
            this.deletedChains = deletedChains;
            this.ensureUniqueIds();
        }

        static empty() {
            return new PlanCollection();
        }

        static fromJSON(value) {
            const data = JSON.parse(value);
            if (!data || !Array.isArray(data.chains)) return PlanCollection.empty();

            const chains = data.chains
                .map(chain => LinkedPlan.fromData(chain))
                .filter(Boolean);
            const deletedChains = (Array.isArray(data.deletedChains) ? data.deletedChains : [])
                .filter(entry => entry && typeof entry.deletedAt === 'string'
                    && Number.isFinite(Date.parse(entry.deletedAt)) && Array.isArray(entry.items))
                .map(entry => ({
                    category: normalizeCategory(entry.category),
                    deletedAt: new Date(entry.deletedAt).toISOString(),
                    createdAt: normalizeCreatedAt(entry.createdAt),
                    name: normalizeChainName(entry.name),
                    items: entry.items.filter(item => typeof item === 'string' && item.trim())
                }))
                .filter(entry => entry.items.length)
                .sort((a, b) => Date.parse(b.deletedAt) - Date.parse(a.deletedAt));
            return new PlanCollection(chains, deletedChains);
        }

        ensureUniqueIds() {
            const usedIds = new Set();
            this.chains.forEach(chain => {
                while (usedIds.has(chain.id)) chain.id = createId();
                usedIds.add(chain.id);
            });
        }

        addChain(texts, category = 'personal', name = '') {
            let id;
            do {
                id = createId();
            } while (this.chains.some(chain => chain.id === id));

            const chain = new LinkedPlan(id, null, [], category, new Date().toISOString(), name);
            chain.appendMany(texts);
            if (!chain.toArray().length) return null;

            this.chains.unshift(chain);
            return chain;
        }

        findChain(chainId) {
            return this.chains.find(chain => chain.id === chainId) || null;
        }

        removeChain(chainId) {
            const index = this.chains.findIndex(chain => chain.id === chainId);
            if (index < 0) return null;
            const chain = this.chains[index];
            const items = chain.toArray().map(node => node.text);
            if (items.length) {
                this.deletedChains.unshift({
                    category: chain.category,
                    deletedAt: new Date().toISOString(),
                    createdAt: chain.createdAt,
                    name: chain.name || `라인 ${String(this.getChains(chain.category).indexOf(chain) + 1).padStart(2, '0')}`,
                    items
                });
            }
            return this.chains.splice(index, 1)[0];
        }

        getDeletedChains(category) {
            return this.deletedChains.filter(entry => entry.category === normalizeCategory(category));
        }

        removeDeletedChain(entry) {
            const index = this.deletedChains.indexOf(entry);
            if (index < 0) return null;
            return this.deletedChains.splice(index, 1)[0];
        }

        getChains(category) {
            const normalizedCategory = normalizeCategory(category);
            return this.chains.filter(chain => chain.category === normalizedCategory);
        }

        getAllNodes(category = null) {
            const chains = category ? this.getChains(category) : this.chains;
            return chains.flatMap(chain => chain.toArray());
        }

        serialize() {
            return JSON.stringify({
                version: 3,
                chains: this.chains.map(chain => chain.toData()),
                deletedChains: this.deletedChains
            });
        }
    }

    class RoutineCollection {
        constructor(routines = []) {
            const usedIds = new Set();
            this.routines = routines
                .map(routine => RoutineCollection.normalize(routine, usedIds))
                .filter(Boolean);
        }

        static empty() {
            return new RoutineCollection();
        }

        static fromJSON(value) {
            const data = JSON.parse(value);
            if (!data || !Array.isArray(data.routines)) return RoutineCollection.empty();
            return new RoutineCollection(data.routines);
        }

        static normalize(routine, usedIds = new Set()) {
            if (!routine || typeof routine.name !== 'string' || !Array.isArray(routine.items)) {
                return null;
            }

            const name = routine.name.trim();
            const items = routine.items
                .filter(item => typeof item === 'string')
                .map(item => item.trim())
                .filter(Boolean);
            if (!name || !items.length) return null;

            let id = isValidId(routine.id) ? routine.id : createId();
            while (usedIds.has(id)) id = createId();
            usedIds.add(id);

            return {
                id,
                name,
                items,
                category: normalizeCategory(routine.category),
                updatedAt: typeof routine.updatedAt === 'string'
                    ? routine.updatedAt
                    : new Date().toISOString()
            };
        }

        add(name, items, category) {
            const routine = RoutineCollection.normalize({
                id: createId(),
                name,
                items,
                category,
                updatedAt: new Date().toISOString()
            }, new Set(this.routines.map(item => item.id)));
            if (!routine) return null;

            this.routines.unshift(routine);
            return routine;
        }

        update(routineId, name, items) {
            const routine = this.find(routineId);
            const cleanName = name.trim();
            const cleanItems = items.map(item => item.trim()).filter(Boolean);
            if (!routine || !cleanName || !cleanItems.length) return null;

            routine.name = cleanName;
            routine.items = cleanItems;
            routine.updatedAt = new Date().toISOString();
            return routine;
        }

        remove(routineId) {
            const index = this.routines.findIndex(routine => routine.id === routineId);
            if (index < 0) return null;
            return this.routines.splice(index, 1)[0];
        }

        find(routineId) {
            return this.routines.find(routine => routine.id === routineId) || null;
        }

        getByCategory(category) {
            const normalizedCategory = normalizeCategory(category);
            return this.routines.filter(routine => routine.category === normalizedCategory);
        }

        serialize() {
            return JSON.stringify({
                version: 1,
                routines: this.routines
            });
        }
    }

    window.PlanModel = Object.freeze({
        CATEGORY_INFO,
        normalizeCategory,
        createId,
        normalizeChainName,
        NOTE_MAX_LENGTH,
        LinkedPlan,
        PlanCollection,
        RoutineCollection
    });
})();
