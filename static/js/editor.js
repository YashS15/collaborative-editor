// Maps language names to CodeMirror modes
const LANG_MODES = {
  python:     { name: 'python' },
  javascript: { name: 'javascript' },
  cpp:        { name: 'text/x-c++src' },
  java:       { name: 'text/x-java' },
  sql:        { name: 'sql' },
  text:       null,
};

// Generates a consistent color per username
const USER_COLORS = [
  '#7c3aed', '#2563eb', '#16a34a', '#dc2626',
  '#d97706', '#0891b2', '#c026d3', '#ea580c',
];
function colorForUser(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return USER_COLORS[Math.abs(hash) % USER_COLORS.length];
}

function initEditor(roomId, initialLang, username) {
  // ---- CodeMirror setup ----
  const editor = CodeMirror.fromTextArea(document.getElementById('codeEditor'), {
    theme: 'dracula',
    lineNumbers: true,
    autoCloseBrackets: true,
    matchBrackets: true,
    indentUnit: 4,
    tabSize: 4,
    indentWithTabs: false,
    lineWrapping: false,
    mode: LANG_MODES[initialLang] || null,
  });

  // Set language selector to match room's saved language
  const langSelect = document.getElementById('languageSelect');
  langSelect.value = initialLang;

  // ---- Socket.IO connection ----
  const socket = io();

  // ---- State ----
  let isRemoteUpdate = false;   // prevents feedback loop on remote code sync
  let saveTimer = null;
  const cursors = {};           // { username: { line, ch } }

  // ---- Connection status UI ----
  const dot = document.getElementById('connectionDot');
  const connLabel = document.getElementById('connectionLabel');

  socket.on('connect', () => {
    dot.className = 'connection-dot connected';
    connLabel.textContent = 'Connected';
    socket.emit('join', { room_id: roomId, username });
  });

  socket.on('disconnect', () => {
    dot.className = 'connection-dot disconnected';
    connLabel.textContent = 'Disconnected';
  });

  // ---- Init: receive current room state ----
  socket.on('init_code', ({ code, language }) => {
    isRemoteUpdate = true;
    editor.setValue(code);
    isRemoteUpdate = false;

    langSelect.value = language;
    setEditorMode(language);
  });

  // ---- Receive remote code changes ----
  socket.on('code_update', ({ code }) => {
    const cursor = editor.getCursor();
    isRemoteUpdate = true;
    editor.setValue(code);
    isRemoteUpdate = false;
    editor.setCursor(cursor);   // restore own cursor after remote update
    showSaved();
  });

  // ---- Receive remote language change ----
  socket.on('language_update', ({ language }) => {
    langSelect.value = language;
    setEditorMode(language);
  });

  // ---- Receive remote cursor positions ----
  socket.on('cursor_update', ({ username: remoteUser, line, ch }) => {
    cursors[remoteUser] = { line, ch };
    renderCursors();
  });

  // ---- User presence ----
  socket.on('user_list_update', ({ users, event, username: who }) => {
    renderUserList(users);
    const status = document.getElementById('saveStatus');
    if (event === 'joined') {
      status.textContent = `${who} joined the room`;
      status.className = 'saving';
    } else {
      status.textContent = `${who} left the room`;
      status.className = '';
      delete cursors[who];
      renderCursors();
    }
    setTimeout(() => {
      status.textContent = 'All changes saved';
      status.className = 'saved';
    }, 2000);
  });

  // ---- Send local code changes ----
  editor.on('change', () => {
    if (isRemoteUpdate) return;

    // Show "saving" status
    const status = document.getElementById('saveStatus');
    status.textContent = 'Saving...';
    status.className = 'saving';

    // Debounce: emit after 300ms of no keystrokes
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      socket.emit('code_change', { room_id: roomId, code: editor.getValue() });
      showSaved();
    }, 300);
  });

  // ---- Send cursor position on movement ----
  editor.on('cursorActivity', () => {
    if (isRemoteUpdate) return;
    const { line, ch } = editor.getCursor();
    socket.emit('cursor_move', { room_id: roomId, line, ch });
  });

  // ---- Language selector ----
  langSelect.addEventListener('change', () => {
    const lang = langSelect.value;
    setEditorMode(lang);
    socket.emit('language_change', { room_id: roomId, language: lang });
  });

  // ---- Copy room link ----
  document.getElementById('copyBtn').addEventListener('click', () => {
    const url = `${window.location.origin}/room/${roomId}`;
    navigator.clipboard.writeText(url).then(() => {
      const btn = document.getElementById('copyBtn');
      btn.textContent = 'Copied!';
      btn.classList.add('copied');
      setTimeout(() => {
        btn.textContent = 'Copy Link';
        btn.classList.remove('copied');
      }, 2000);
    });
  });

  // ---- Helpers ----
  function setEditorMode(lang) {
    editor.setOption('mode', LANG_MODES[lang] || null);
  }

  function showSaved() {
    const status = document.getElementById('saveStatus');
    status.textContent = 'All changes saved';
    status.className = 'saved';
  }

  function renderUserList(users) {
    const ul = document.getElementById('userList');
    ul.innerHTML = '';
    users.forEach(name => {
      const li = document.createElement('li');
      li.className = 'user-item';
      const avatar = document.createElement('div');
      avatar.className = 'user-avatar';
      avatar.style.background = colorForUser(name);
      avatar.textContent = name.charAt(0).toUpperCase();
      const nameSpan = document.createElement('span');
      nameSpan.className = 'user-name';
      nameSpan.textContent = name;
      if (name === username) {
        const badge = document.createElement('span');
        badge.className = 'you-badge';
        badge.textContent = '(you)';
        nameSpan.appendChild(badge);
      }
      li.appendChild(avatar);
      li.appendChild(nameSpan);
      ul.appendChild(li);
    });
  }

  function renderCursors() {
    const container = document.getElementById('cursorInfo');
    const entries = Object.entries(cursors);
    if (entries.length === 0) {
      container.innerHTML = '<p class="muted">No other users yet.</p>';
      return;
    }
    container.innerHTML = entries.map(([name, { line, ch }]) =>
      `<div class="cursor-entry">
        <span style="color:${colorForUser(name)}">${name}</span>
        Ln ${line + 1}, Col ${ch + 1}
      </div>`
    ).join('');
  }
}
