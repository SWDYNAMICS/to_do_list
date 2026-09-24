const TODO_STORAGE_KEY = 'todos';

// 전역 변수
let todos = [];
let currentFilter = 'all';
let cloudUser = null;

// DOM 요소
const todoInput = document.getElementById('todoInput');
const addBtn = document.getElementById('addBtn');
const todoList = document.getElementById('todoList');
const filterBtns = document.querySelectorAll('.filter-btn');
const todoCount = document.getElementById('todoCount');
const clearCompletedBtn = document.getElementById('clearCompleted');

// 이벤트 리스너
addBtn.addEventListener('click', addTodo);
todoInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addTodo();
});

filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        currentFilter = btn.dataset.filter;
        filterBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderTodos();
    });
});

clearCompletedBtn.addEventListener('click', clearCompleted);

// 할 일 추가
function addTodo() {
    const text = todoInput.value.trim();
    
    if (text === '') {
        alert('할 일을 입력해주세요!');
        return;
    }
    
    const todo = {
        id: Date.now(),
        text: text,
        completed: false
    };
    
    todos.push(todo);
    saveTodos();
    todoInput.value = '';
    renderTodos();
}

// 할 일 삭제
function deleteTodo(id) {
    todos = todos.filter(todo => todo.id !== id);
    saveTodos();
    renderTodos();
}

// 할 일 완료 토글
function toggleTodo(id) {
    todos = todos.map(todo => {
        if (todo.id === id) {
            return { ...todo, completed: !todo.completed };
        }
        return todo;
    });
    saveTodos();
    renderTodos();
}

// 완료된 항목 삭제
function clearCompleted() {
    todos = todos.filter(todo => !todo.completed);
    saveTodos();
    renderTodos();
}

function loadLocalTodos() {
    try {
        const stored = JSON.parse(localStorage.getItem(TODO_STORAGE_KEY)) || [];
        if (!Array.isArray(stored)) return [];
        return stored.filter(todo => todo && typeof todo.text === 'string').map(todo => ({
            id: todo.id ?? Date.now(),
            text: todo.text,
            completed: Boolean(todo.completed)
        }));
    } catch (error) {
        console.error('저장된 할 일을 불러오지 못했습니다.', error);
        return [];
    }
}

// 로그인 전에는 로컬에, 로그인 후에는 서버에 저장
function saveTodos() {
    if (cloudUser) {
        window.AppBackend.saveUserData('todos', { version: 1, items: todos });
        return;
    }

    localStorage.setItem(TODO_STORAGE_KEY, JSON.stringify(todos));
}

// 할 일 렌더링
function renderTodos() {
    // 필터링
    let filteredTodos = todos;
    if (currentFilter === 'active') {
        filteredTodos = todos.filter(todo => !todo.completed);
    } else if (currentFilter === 'completed') {
        filteredTodos = todos.filter(todo => todo.completed);
    }
    
    // 리스트 초기화
    todoList.innerHTML = '';
    
    // 할 일 항목 생성
    filteredTodos.forEach(todo => {
        const li = document.createElement('li');
        li.className = `todo-item ${todo.completed ? 'completed' : ''}`;
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = todo.completed;
        checkbox.setAttribute('aria-label', `${todo.text} 완료 상태`);

        const text = document.createElement('span');
        text.textContent = todo.text;

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'delete-btn';
        deleteBtn.textContent = '삭제';

        li.append(checkbox, text, deleteBtn);

        // 체크박스 이벤트
        checkbox.addEventListener('change', () => toggleTodo(todo.id));

        // 삭제 버튼 이벤트
        deleteBtn.addEventListener('click', () => deleteTodo(todo.id));
        
        todoList.appendChild(li);
    });
    
    // 남은 할 일 개수 업데이트
    updateCount();
}

// 남은 할 일 개수 업데이트
function updateCount() {
    const activeCount = todos.filter(todo => !todo.completed).length;
    todoCount.textContent = `${activeCount}개 남음`;
}

function setTodoControlsDisabled(disabled) {
    todoInput.disabled = disabled;
    addBtn.disabled = disabled;
    clearCompletedBtn.disabled = disabled;
    filterBtns.forEach(button => {
        button.disabled = disabled;
    });
}

async function initializeTodos() {
    setTodoControlsDisabled(true);
    const localTodos = loadLocalTodos();

    const result = await window.AppBackend.loadUserData('todos', {
        version: 1,
        items: localTodos
    });
    const items = Array.isArray(result.data?.items) ? result.data.items : [];
    todos = items.filter(todo => todo && typeof todo.text === 'string').map(todo => ({
        id: todo.id ?? Date.now(),
        text: todo.text,
        completed: Boolean(todo.completed)
    }));
    cloudUser = result.user;

    if (result.mode === 'cloud') {
        localStorage.removeItem(TODO_STORAGE_KEY);
    }

    setTodoControlsDisabled(false);
    renderTodos();
}

initializeTodos();
