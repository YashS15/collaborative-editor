const LANG_MODES = {
  python:     { name: 'python' },
  javascript: { name: 'javascript' },
  cpp:        { name: 'text/x-c++src' },
  java:       { name: 'text/x-java' },
  sql:        { name: 'sql' },
  text:       null,
};

const LANG_EXT = { python: 'py', javascript: 'js', cpp: 'cpp', java: 'java', sql: 'sql', text: 'txt' };

const CURSOR_COLORS = [
  '#7c3aed','#2563eb','#16a34a','#dc2626',
  '#d97706','#0891b2','#c026d3','#ea580c',
];
function colorForUser(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return CURSOR_COLORS[Math.abs(h) % CURSOR_COLORS.length];
}

function initEditor(roomId, initLang, username, isReadonly) {
  // ---- Read-only banner ----
  if (isReadonly) document.getElementById('readonlyBanner').classList.remove('hidden');

  // ---- Font size ----
  let fontSize = parseInt(localStorage.getItem('editorFontSize') || '14');
  function applyFontSize() {
    document.querySelector('.CodeMirror').style.fontSize = fontSize + 'px';
    localStorage.setItem('editorFontSize', fontSize);
  }

  // ---- CodeMirror ----
  const editor = CodeMirror.fromTextArea(document.getElementById('codeEditor'), {
    theme: 'dracula',
    lineNumbers: true,
    autoCloseBrackets: true,
    matchBrackets: true,
    indentUnit: 4,
    tabSize: 4,
    indentWithTabs: false,
    lineWrapping: false,
    readOnly: isReadonly,
    mode: LANG_MODES[initLang] || null,
  });
  applyFontSize();

  const langSelect = document.getElementById('languageSelect');
  langSelect.value = initLang;
  let currentLang = initLang;

  // ---- Remote cursors ----
  // { username: CodeMirror TextMarker/Bookmark }
  const remoteCursors = {};

  function updateRemoteCursor(name, line, ch) {
    if (remoteCursors[name]) remoteCursors[name].clear();

    const color = colorForUser(name);
    const el = document.createElement('span');
    el.className = 'remote-cursor-marker show-label';
    el.style.background = color;

    const label = document.createElement('span');
    label.className = 'remote-cursor-label';
    label.textContent = name;
    label.style.background = color;
    el.appendChild(label);

    // Hide label after 3 seconds
    setTimeout(() => el.classList.remove('show-label'), 3000);

    const doc = editor.getDoc();
    const lineCount = doc.lineCount();
    const safeLine = Math.min(line, lineCount - 1);
    const safeCh   = Math.min(ch, doc.getLine(safeLine).length);

    remoteCursors[name] = editor.setBookmark(
      CodeMirror.Pos(safeLine, safeCh),
      { widget: el, insertLeft: true }
    );
  }

  function removeRemoteCursor(name) {
    if (remoteCursors[name]) {
      remoteCursors[name].clear();
      delete remoteCursors[name];
    }
  }

  // ---- Socket.IO ----
  const socket = io({ reconnection: true, reconnectionDelay: 1000, reconnectionAttempts: Infinity });

  const dot   = document.getElementById('connectionDot');
  const label = document.getElementById('connectionLabel');

  socket.on('connect', () => {
    dot.className = 'connection-dot connected';
    label.textContent = 'Connected';
    socket.emit('join', { room_id: roomId, username });
  });

  socket.on('disconnect', () => {
    dot.className = 'connection-dot disconnected';
    label.textContent = 'Reconnecting...';
  });

  // Auto-rejoin after reconnect
  socket.on('reconnect', () => {
    socket.emit('join', { room_id: roomId, username });
  });

  // ---- State ----
  let isRemote = false;
  let saveTimer = null;

  // ---- Init from server ----
  socket.on('init_code', ({ code, language }) => {
    isRemote = true;
    editor.setValue(code);
    isRemote = false;
    langSelect.value = language;
    currentLang = language;
    editor.setOption('mode', LANG_MODES[language] || null);
  });

  // ---- Remote code update ----
  socket.on('code_update', ({ code }) => {
    const cur = editor.getCursor();
    isRemote = true;
    editor.setValue(code);
    isRemote = false;
    editor.setCursor(cur);
    showSaved();
  });

  // ---- Remote language update ----
  socket.on('language_update', ({ language }) => {
    langSelect.value = language;
    currentLang = language;
    editor.setOption('mode', LANG_MODES[language] || null);
  });

  // ---- Remote cursor ----
  socket.on('cursor_update', ({ username: who, line, ch }) => {
    updateRemoteCursor(who, line, ch);
  });

  socket.on('remove_cursor', ({ username: who }) => {
    removeRemoteCursor(who);
  });

  // ---- User presence ----
  socket.on('user_list_update', ({ users, event, username: who }) => {
    renderUserList(users);
    const status = document.getElementById('saveStatus');
    status.textContent = who + (event === 'joined' ? ' joined' : ' left');
    status.className = '';
    if (event === 'left') removeRemoteCursor(who);
    setTimeout(showSaved, 2000);
  });

  // ---- Local code change ----
  editor.on('change', () => {
    if (isRemote) return;
    const status = document.getElementById('saveStatus');
    status.textContent = 'Saving...';
    status.className = 'saving';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      socket.emit('code_change', { room_id: roomId, code: editor.getValue() });
      showSaved();
    }, 300);
  });

  // ---- Local cursor move ----
  editor.on('cursorActivity', () => {
    if (isRemote) return;
    const { line, ch } = editor.getCursor();
    socket.emit('cursor_move', { room_id: roomId, line, ch });
  });

  // ---- Language change ----
  langSelect.addEventListener('change', () => {
    currentLang = langSelect.value;
    editor.setOption('mode', LANG_MODES[currentLang] || null);
    socket.emit('language_change', { room_id: roomId, language: currentLang });
  });

  // ---- Copy link ----
  document.getElementById('copyBtn').addEventListener('click', () => {
    const url = `${location.origin}/room/${roomId}`;
    navigator.clipboard.writeText(url).then(() => {
      const btn = document.getElementById('copyBtn');
      btn.textContent = 'Copied!';
      btn.classList.add('copied');
      setTimeout(() => { btn.textContent = 'Copy Link'; btn.classList.remove('copied'); }, 2000);
    });
  });

  // ---- Run code ----
  const runBtn = document.getElementById('runBtn');
  const outputPanel = document.getElementById('outputPanel');
  const outputContent = document.getElementById('outputContent');

  runBtn.addEventListener('click', async () => {
    runBtn.textContent = '... Running';
    runBtn.classList.add('running');
    runBtn.disabled = true;

    outputPanel.classList.add('visible');
    outputContent.textContent = 'Running...';
    outputContent.className = 'output-content';

    try {
      const res = await fetch('/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: editor.getValue(), language: currentLang })
      });
      const data = await res.json();
      outputContent.textContent = data.output;
      outputContent.className = 'output-content' + (data.error ? ' error' : '');
    } catch {
      outputContent.textContent = 'Failed to connect to server.';
      outputContent.className = 'output-content error';
    } finally {
      runBtn.textContent = '▶ Run';
      runBtn.classList.remove('running');
      runBtn.disabled = false;
    }
  });

  document.getElementById('clearOutput').addEventListener('click', () => {
    outputContent.textContent = '';
    outputContent.className = 'output-content';
  });

  document.getElementById('closeOutput').addEventListener('click', () => {
    outputPanel.classList.remove('visible');
  });

  // ---- Download ----
  document.getElementById('downloadBtn').addEventListener('click', () => {
    const ext = LANG_EXT[currentLang] || 'txt';
    const blob = new Blob([editor.getValue()], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `code_${roomId}.${ext}`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  // ---- Snapshots ----
  loadSnapshots();

  document.getElementById('snapshotBtn').addEventListener('click', async () => {
    const name = prompt('Snapshot name:', `v${new Date().toLocaleTimeString()}`);
    if (name === null) return;
    const res = await fetch(`/room/${roomId}/snapshots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name || `Snapshot ${new Date().toLocaleTimeString()}` })
    });
    const snap = await res.json();
    prependSnapshot(snap);
    document.getElementById('noSnapshots').classList.add('hidden');
  });

  async function loadSnapshots() {
    const res = await fetch(`/room/${roomId}/snapshots`);
    const snaps = await res.json();
    const list = document.getElementById('snapshotList');
    list.innerHTML = '';
    if (snaps.length > 0) {
      document.getElementById('noSnapshots').classList.add('hidden');
      snaps.forEach(s => prependSnapshot(s, false));
    }
  }

  function prependSnapshot(snap, prepend = true) {
    const list = document.getElementById('snapshotList');
    const li = document.createElement('li');
    li.className = 'snapshot-item';
    li.dataset.id = snap.id;
    li.innerHTML = `
      <div class="snapshot-name">${snap.name}</div>
      <div class="snapshot-meta">${snap.language} &middot; ${snap.created_at}</div>
      <button class="snapshot-restore">Restore</button>
    `;
    li.querySelector('.snapshot-restore').addEventListener('click', () => restoreSnapshot(snap.id));
    prepend ? list.prepend(li) : list.appendChild(li);
  }

  async function restoreSnapshot(snapId) {
    if (!confirm('Restore this snapshot? Current code will be overwritten for everyone.')) return;
    const res = await fetch(`/room/${roomId}/snapshots/${snapId}/restore`, { method: 'POST' });
    const data = await res.json();
    isRemote = true;
    editor.setValue(data.code);
    isRemote = false;
    langSelect.value = data.language;
    currentLang = data.language;
    editor.setOption('mode', LANG_MODES[data.language] || null);
  }

  // ---- Font size ----
  document.getElementById('fontIncBtn').addEventListener('click', () => {
    if (fontSize < 24) { fontSize++; applyFontSize(); }
  });
  document.getElementById('fontDecBtn').addEventListener('click', () => {
    if (fontSize > 10) { fontSize--; applyFontSize(); }
  });

  // ---- Chat ----
  socket.on('chat_history', ({ messages }) => {
    messages.forEach(m => appendChatMsg(m, m.username === username));
  });

  socket.on('chat_broadcast', (msg) => {
    appendChatMsg(msg, msg.username === username);
    // Auto-switch to chat tab if not already there
    if (!document.getElementById('tab-chat').classList.contains('active')) {
      const chatTabBtn = document.querySelector('[data-tab="chat"]');
      chatTabBtn.style.color = '#f59e0b';
    }
  });

  function sendChat() {
    const input = document.getElementById('chatInput');
    const text = input.value.trim();
    if (!text) return;
    socket.emit('chat_message', { room_id: roomId, text });
    input.value = '';
  }

  document.getElementById('chatSend').addEventListener('click', sendChat);
  document.getElementById('chatInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendChat();
  });

  function appendChatMsg(msg, isSelf) {
    const container = document.getElementById('chatMessages');
    const div = document.createElement('div');
    div.className = 'chat-msg' + (isSelf ? ' self' : '');
    const color = colorForUser(msg.username);
    div.innerHTML = `
      <div class="chat-msg-header">
        <span class="chat-msg-user" style="color:${color}">${msg.username}</span>
        <span class="chat-msg-time">${msg.time}</span>
      </div>
      <div class="chat-msg-text">${escapeHtml(msg.text)}</div>
    `;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  }

  // ---- Sidebar tabs ----
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => { b.classList.remove('active'); b.style.color = ''; });
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    });
  });

  // ---- Sidebar toggle (mobile) ----
  document.getElementById('sidebarToggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('collapsed');
  });

  // ---- Helpers ----
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

  function escapeHtml(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
}
