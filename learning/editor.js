import { Editor, Extension, Mark, generateHTML } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TableKit } from '@tiptap/extension-table';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import { Markdown } from '@tiptap/markdown';
import { EditorState } from '@tiptap/pm/state';
import DOMPurify from 'dompurify';

const FORMAT = 'tiptap-v1';
const TEXT_COLORS = ['blue', 'green', 'teal', 'orange', 'red', 'purple'];
// Store palette names rather than fixed RGB values so each theme stays readable.
const TextColor = Mark.create({
    name: 'textColor',
    addAttributes() {
        return {
            color: {
                default: null,
                parseHTML: element => TEXT_COLORS.includes(element.dataset.textColor)
                    ? element.dataset.textColor : null,
                renderHTML: attributes => TEXT_COLORS.includes(attributes.color)
                    ? { 'data-text-color': attributes.color } : {}
            }
        };
    },
    parseHTML() {
        return [{ tag: 'span[data-text-color]', getAttrs: element =>
            TEXT_COLORS.includes(element.dataset.textColor) ? null : false }];
    },
    renderHTML({ HTMLAttributes }) { return ['span', HTMLAttributes, 0]; }
});

const Indentation = Extension.create({
    name: 'indentation',
    addGlobalAttributes() {
        return [{ types: ['paragraph', 'heading'], attributes: {
            indent: {
                default: 0,
                parseHTML: element => Math.min(6, Math.max(0, Number(element.dataset.indent) || 0)),
                renderHTML: attributes => ({ 'data-indent': Math.min(6, Math.max(0, Number(attributes.indent) || 0)) })
            }
        } }];
    }
});
const extensions = () => [
    StarterKit.configure({
        heading: { levels: [1, 2, 3, 4, 5, 6] },
        link: { openOnClick: false, HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' } }
    }),
    TableKit.configure({ table: { resizable: false } }),
    TaskList,
    TaskItem.configure({
        nested: true,
        HTMLAttributes: { 'data-type': 'taskItem' },
        a11y: { checkboxLabel: node => `${node.textContent || '할 일'} 완료 여부` }
    }),
    Markdown,
    TextColor,
    Indentation
];

function plainDocument(text = '') {
    const content = text.split(/\r?\n/).flatMap((line, index) => [
        ...(index ? [{ type: 'hardBreak' }] : []),
        ...(line ? [{ type: 'text', text: line }] : [])
    ]);
    return { type: 'doc', content: [{ type: 'paragraph', ...(content.length ? { content } : {}) }] };
}

function sanitize(html) {
    return DOMPurify.sanitize(html, {
        USE_PROFILES: { html: true },
        FORBID_TAGS: ['img', 'video', 'audio', 'iframe', 'form', 'style'],
        FORBID_ATTR: ['style']
    });
}

function recordHTML(record) {
    const doc = record.contentFormat === FORMAT && record.richContent?.type === 'doc'
        ? record.richContent : plainDocument(record.content);
    try {
        return sanitize(generateHTML(doc, extensions()));
    } catch {
        return sanitize(generateHTML(plainDocument(record.content), extensions()));
    }
}

function looksLikeMarkdown(text) {
    return /(^|\n)\s{0,3}(#{1,6}\s|[-*+]\s|\d+[.)]\s|>\s|```|~~~|\|.*\|)|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\)/.test(text);
}

function createOutline(container, headings, onSelect) {
    container.replaceChildren();
    if (!headings.length) {
        const empty = document.createElement('p');
        empty.className = 'editor-outline-empty';
        empty.textContent = '제목을 추가하면 목차가 나타납니다.';
        container.append(empty);
        return;
    }
    headings.forEach(heading => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'outline-link';
        button.style.paddingLeft = `${(heading.level - 1) * 12 + 8}px`;
        button.textContent = heading.text || '제목 없음';
        button.addEventListener('click', () => onSelect(heading));
        container.append(button);
    });
}

function create({ element, toolbar, outline, pasteMode, onChange }) {
    let editor;
    const listType = () => editor.isActive('taskItem') ? 'taskItem' : editor.isActive('listItem') ? 'listItem' : null;
    function indent(direction) {
        const list = listType();
        if (list) return direction > 0
            ? editor.chain().focus().sinkListItem(list).run()
            : editor.chain().focus().liftListItem(list).run();
        const type = editor.isActive('heading') ? 'heading' : 'paragraph';
        const current = editor.getAttributes(type).indent || 0;
        return editor.chain().focus().updateAttributes(type, { indent: Math.max(0, Math.min(6, current + direction)) }).run();
    }

    editor = new Editor({
        element,
        extensions: extensions(),
        content: plainDocument(),
        editable: false,
        editorProps: {
            attributes: {
                class: 'rich-text editor-document', role: 'textbox',
                'aria-multiline': 'true', 'aria-labelledby': 'learningContentLabel',
                'aria-describedby': 'editorHelp', 'aria-required': 'true',
                'data-placeholder': '내용을 작성하거나 ChatGPT 답변을 붙여넣으세요.'
            },
            transformPastedHTML: sanitize,
            handleKeyDown(view, event) {
                if (event.key !== 'Tab') return false;
                if (listType()) { indent(event.shiftKey ? -1 : 1); return true; }
                if (editor.isActive('codeBlock') && !event.shiftKey) {
                    view.dispatch(view.state.tr.insertText('  '));
                    return true;
                }
                return false;
            },
            handlePaste(view, event) {
                const clipboard = event.clipboardData;
                if (!clipboard) return false;
                const text = clipboard.getData('text/plain');
                const html = clipboard.getData('text/html');
                const mode = pasteMode.value;
                if (editor.isActive('codeBlock')) {
                    view.dispatch(view.state.tr.insertText(text));
                    return true;
                }
                if (mode === 'plain') {
                    editor.commands.insertContent(plainDocument(text).content);
                    return true;
                }
                if (mode === 'auto' && html) return false;
                if (text && (mode === 'markdown' || looksLikeMarkdown(text))) {
                    editor.commands.insertContent(text, { contentType: 'markdown' });
                    return true;
                }
                editor.commands.insertContent(plainDocument(text).content);
                return true;
            }
        },
        onUpdate() { updateOutline(); updateToolbar(); onChange?.(); },
        onSelectionUpdate() { updateToolbar(); }
    });

    const commands = {
        bold: () => editor.chain().focus().toggleBold().run(),
        italic: () => editor.chain().focus().toggleItalic().run(),
        bulletList: () => editor.chain().focus().toggleBulletList().run(),
        orderedList: () => editor.chain().focus().toggleOrderedList().run(),
        taskList: () => editor.chain().focus().toggleTaskList().run(),
        blockquote: () => editor.chain().focus().toggleBlockquote().run(),
        codeBlock: () => editor.chain().focus().toggleCodeBlock().run(),
        indent: () => indent(1), outdent: () => indent(-1),
        table: () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
        addRow: () => editor.chain().focus().addRowAfter().run(),
        addColumn: () => editor.chain().focus().addColumnAfter().run(),
        deleteTable: () => editor.chain().focus().deleteTable().run(),
        undo: () => editor.chain().focus().undo().run(),
        redo: () => editor.chain().focus().redo().run()
    };
    toolbar.querySelectorAll('[data-command]').forEach(button => {
        button.addEventListener('mousedown', event => event.preventDefault());
        button.addEventListener('click', () => { commands[button.dataset.command](); updateToolbar(); });
    });
    toolbar.querySelectorAll('[data-text-color-option]').forEach(button => {
        button.addEventListener('mousedown', event => event.preventDefault());
        button.addEventListener('click', () => {
            const color = button.dataset.textColorOption;
            if (TEXT_COLORS.includes(color)) editor.chain().focus().setMark('textColor', { color }).run();
            else editor.chain().focus().unsetMark('textColor').run();
            updateToolbar();
        });
    });
    const headingSelect = toolbar.querySelector('[data-heading]');
    headingSelect.addEventListener('change', () => {
        const level = Number(headingSelect.value);
        if (level) editor.chain().focus().setHeading({ level }).run();
        else editor.chain().focus().setParagraph().run();
        updateToolbar();
    });

    function updateToolbar() {
        if (!editor) return;
        toolbar.querySelectorAll('[data-command]').forEach(button => {
            const command = button.dataset.command;
            if (button.hasAttribute('aria-pressed')) button.setAttribute('aria-pressed', String(editor.isActive(command)));
            button.disabled = !editor.isEditable
                || (command === 'undo' && !editor.can().undo())
                || (command === 'redo' && !editor.can().redo());
        });
        toolbar.querySelectorAll('[data-text-color-option]').forEach(button => {
            const color = button.dataset.textColorOption;
            button.setAttribute('aria-pressed', String(color
                ? editor.isActive('textColor', { color }) : !editor.isActive('textColor')));
            button.disabled = !editor.isEditable || editor.isActive('codeBlock') || editor.isActive('code');
        });
        toolbar.querySelector('[data-table-actions]').hidden = !editor.isActive('table');
        headingSelect.value = String(editor.getAttributes('heading').level || 0);
        headingSelect.disabled = !editor.isEditable;
    }
    function updateOutline() {
        const headings = [];
        editor.state.doc.descendants((node, pos) => {
            if (node.type.name === 'heading') headings.push({ text: node.textContent, level: node.attrs.level, pos });
        });
        createOutline(outline, headings, heading => {
            editor.chain().focus().setTextSelection(heading.pos + 1).scrollIntoView().run();
        });
    }
    updateOutline();
    updateToolbar();
    return {
        getValue: () => ({ content: editor.getText(), contentFormat: FORMAT, richContent: editor.getJSON() }),
        setValue(record) {
            editor.commands.setContent(recordHTML(record), { emitUpdate: false, parseOptions: { preserveWhitespace: 'full' } });
            // A different record or draft starts its own undo history.
            editor.view.updateState(EditorState.create({
                doc: editor.state.doc, schema: editor.schema, plugins: editor.state.plugins
            }));
            updateOutline(); updateToolbar();
        },
        clear() { this.setValue({ content: '' }); },
        isEmpty: () => editor.isEmpty || !editor.getText().trim(),
        focus: () => editor.commands.focus(),
        setEditable(editable) { editor.setEditable(editable); updateToolbar(); },
        destroy: () => editor.destroy()
    };
}

function render(record, container) {
    if (record.contentFormat !== FORMAT) {
        container.textContent = record.content;
        return;
    }
    container.classList.add('rich-text');
    container.innerHTML = recordHTML(record);
    container.querySelectorAll('input[type="checkbox"]').forEach(input => { input.disabled = true; });
    const headings = [...container.querySelectorAll('h1,h2,h3,h4,h5,h6')];
    if (headings.length) {
        const details = document.createElement('details');
        details.className = 'editor-outline';
        const summary = document.createElement('summary');
        summary.textContent = `목차 · ${headings.length}`;
        const links = document.createElement('div');
        createOutline(links, headings.map(element => ({ element, text: element.textContent, level: Number(element.tagName[1]) })), heading => {
            heading.element.tabIndex = -1;
            heading.element.focus({ preventScroll: true });
            heading.element.scrollIntoView({ block: 'center' });
        });
        details.append(summary, links);
        container.prepend(details);
    }
}

window.TilEditor = { create, render };
