# CollabCode — Full Project Summary
> A real-time collaborative code editor built with Flask, WebSockets, and CodeMirror.
> Reference document for learning and interview preparation.

---

## Table of Contents
1. [What We Built](#1-what-we-built)
2. [Tech Stack — Every Tool Explained](#2-tech-stack)
3. [Project Structure](#3-project-structure)
4. [Backend — How It Works](#4-backend)
5. [Frontend — How It Works](#5-frontend)
6. [Database Design](#6-database-design)
7. [Features Built](#7-features-built)
8. [Configuration Details](#8-configuration-details)
9. [Deployment Setup](#9-deployment-setup)
10. [Interview Questions & Answers](#10-interview-questions--answers)

---

## 1. What We Built

**CollabCode** is a browser-based code editor where multiple users can write code together in real time — similar to how Google Docs lets multiple people edit a document simultaneously, but for code.

### Core idea
- User A opens the app, creates a "room" and gets a unique 8-character code (e.g. `A1B2C3D4`)
- User A shares this code with User B
- User B joins using the code
- Both users now see each other's code changes, cursor positions, and can chat — all instantly

---

## 2. Tech Stack

### Backend (Server Side)

| Tool | What it is | Why we used it |
|---|---|---|
| **Python** | Programming language | Easy syntax, huge library ecosystem |
| **Flask** | Web framework | Lightweight, simple to set up routes and serve HTML pages |
| **Flask-SocketIO** | WebSocket extension for Flask | Enables real-time two-way communication between server and browser |
| **Flask-SQLAlchemy** | Database ORM extension | Lets us interact with the database using Python objects instead of raw SQL |
| **SQLite** | Database | File-based database, zero setup needed, perfect for development |
| **Eventlet** | Async networking library | Makes Flask handle many WebSocket connections simultaneously |
| **Gunicorn** | Production web server | Replaces Flask's built-in dev server for deployment |

### Frontend (Browser Side)

| Tool | What it is | Why we used it |
|---|---|---|
| **HTML/CSS** | Structure and styling | Foundation of every web page |
| **Vanilla JavaScript** | Browser scripting | Handles all user interactions, WebSocket events, UI updates |
| **CodeMirror 5** | Code editor library (CDN) | Provides syntax highlighting, line numbers, themes — loaded from internet, no install |
| **Socket.IO Client** | WebSocket client library (CDN) | Connects browser to Flask-SocketIO server, handles real-time events |

### Tools & Services

| Tool | Purpose |
|---|---|
| **Git** | Version control — tracks all code changes |
| **GitHub** | Remote repository — stores code online, used for deployment |
| **Render.com** | Free cloud hosting platform |
| **VS Code** | Code editor (your IDE) |

---

## 3. Project Structure

```
collaborative-editor/
│
├── app.py                  ← Main server file. All routes and WebSocket events
├── models.py               ← Database table definitions
├── requirements.txt        ← List of Python packages to install
├── Procfile                ← Tells Render/Heroku how to start the server
│
├── templates/              ← HTML files (Flask looks here automatically)
│   ├── index.html          ← Home page: Create Room / Join Room
│   └── editor.html         ← Editor page: CodeMirror + sidebar + output panel
│
├── static/                 ← CSS and JS files served directly to browser
│   ├── css/
│   │   └── style.css       ← All styling
│   └── js/
│       └── editor.js       ← All client-side logic (WebSocket, cursors, chat, etc.)
│
└── instance/               ← Auto-created by Flask
    └── editor.db           ← SQLite database file (auto-created on first run)
```

**Why this structure?**
Flask has a convention: it looks for HTML files in `templates/` and serves files in `static/` directly. This separation keeps server code, HTML, and browser code organized.

---

## 4. Backend

### What is a Web Framework?
When a browser requests a page (e.g. visits `http://localhost:5000`), something needs to receive that request and send back HTML. Flask does this. You define "routes" — functions that respond to specific URLs.

### Routes in app.py

```
GET  /                              → Serves index.html (home page)
GET  /room/<room_id>                → Serves editor.html for a specific room
POST /create-room                   → Creates a new room in DB, returns room_id as JSON
POST /execute                       → Runs Python code, returns output as JSON
GET  /room/<id>/snapshots           → Returns list of saved snapshots
POST /room/<id>/snapshots           → Saves current code as a named snapshot
POST /room/<id>/snapshots/<id>/restore → Restores a snapshot for everyone in room
```

### What are WebSockets?
Normal HTTP is one-directional: browser asks → server responds → connection closes.
WebSockets keep the connection open permanently, so the server can push data to the browser at any time without being asked.

This is how real-time features work:
- When User A types, the browser sends a WebSocket message to the server
- The server immediately forwards that message to all other users in the same room
- Their browsers receive it and update the editor — all in milliseconds

### WebSocket Events (the "language" of the app)

| Event | Direction | What it does |
|---|---|---|
| `join` | Browser → Server | User joins a room, server sends them current code + chat history |
| `code_change` | Browser → Server | User typed something, sends full updated code |
| `code_update` | Server → Browser | Server broadcasts code change to all other users in room |
| `cursor_move` | Browser → Server | User moved cursor, sends line and column number |
| `cursor_update` | Server → Browser | Server broadcasts cursor position to others |
| `language_change` | Browser → Server | User changed language (Python → JS etc.) |
| `language_update` | Server → Browser | Server broadcasts language change to room |
| `chat_message` | Browser → Server | User sent a chat message |
| `chat_broadcast` | Server → Browser | Server broadcasts chat message to room |
| `user_list_update` | Server → Browser | Someone joined or left, sends updated user list |
| `remove_cursor` | Server → Browser | User disconnected, remove their cursor marker |

### How rooms work
Each room has a unique 8-character ID (e.g. `A1B2C3D4`). The server keeps a dictionary:
```python
active_users = {
    "A1B2C3D4": {
        "socket_id_abc": "Yash",
        "socket_id_xyz": "Niki"
    }
}
```
When someone sends a code change, the server looks up everyone else in that room and forwards the message to them using SocketIO's `to=room_id` parameter.

### Code Execution (Security Note)
When a user clicks "Run", the browser sends the Python code to the server. The server runs it using Python's `subprocess` module — in an isolated child process with a 5-second timeout. This prevents infinite loops from hanging the server.

```python
result = subprocess.run(
    [sys.executable, '-c', code],  # runs: python -c "<user code>"
    capture_output=True,
    text=True,
    timeout=5   # kill after 5 seconds
)
```

**Limitation:** Only Python is supported for execution (other languages need Docker for safe sandboxing).

### Background Thread — Room Expiry
A daemon thread runs in the background, waking up every hour to delete rooms that haven't been used in 24 hours. This keeps the database clean.

```python
def _cleanup_loop():
    while True:
        time.sleep(3600)           # sleep 1 hour
        # delete rooms inactive > 24h
```

---

## 5. Frontend

### How HTML is served (Jinja2 Templating)
Flask uses a template engine called **Jinja2**. It lets you embed Python variables into HTML using `{{ }}` syntax.

Example in `editor.html`:
```html
<span class="room-id">{{ room.id }}</span>
```
Flask replaces `{{ room.id }}` with the actual room ID (e.g. `A1B2C3D4`) before sending the page to the browser.

### CodeMirror Setup
CodeMirror is a professional code editor library. We load it from a CDN (Content Delivery Network — a server on the internet that hosts the library files):

```html
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/.../codemirror.min.css"/>
<script src="https://cdnjs.cloudflare.com/.../codemirror.min.js"></script>
```

Then we initialize it in JavaScript:
```javascript
const editor = CodeMirror.fromTextArea(document.getElementById('codeEditor'), {
    theme: 'dracula',       // dark purple theme
    lineNumbers: true,      // show line numbers on left
    mode: { name: 'python' } // syntax highlighting for Python
});
```

### Preventing Feedback Loops
This is the trickiest part. When User B receives a code update from User A and we update the editor, CodeMirror fires a "change" event. Without protection, this would cause the browser to emit another `code_change` back to the server — creating an infinite loop.

**Solution: the `isRemote` flag**
```javascript
let isRemote = false;

// When we receive an update from the server:
socket.on('code_update', ({ code }) => {
    isRemote = true;        // tell the change handler to ignore this
    editor.setValue(code);  // update editor
    isRemote = false;       // resume normal tracking
});

// When the user types:
editor.on('change', () => {
    if (isRemote) return;   // skip if we caused this change ourselves
    socket.emit('code_change', { code: editor.getValue() });
});
```

### Debouncing
Sending a WebSocket message on every single keystroke would flood the server. Instead we "debounce" — wait 300ms after the last keystroke before sending.

```javascript
clearTimeout(saveTimer);
saveTimer = setTimeout(() => {
    socket.emit('code_change', { code: editor.getValue() });
}, 300);
```

### Inline Cursor Markers
When another user moves their cursor, we show a colored blinking marker at their position inside the editor. This uses CodeMirror's `setBookmark` API:

```javascript
const marker = editor.setBookmark(
    CodeMirror.Pos(line, ch),  // position in the document
    { widget: cursorElement, insertLeft: true }  // DOM element to show
);
```

The cursor element is a thin colored vertical bar (2px wide) with a username label above it. Each user gets a consistent color based on a hash of their name.

### Auto-Reconnect
Socket.IO handles reconnection automatically. We just need to re-join the room after reconnecting:
```javascript
socket.on('reconnect', () => {
    socket.emit('join', { room_id: roomId, username });
});
```

---

## 6. Database Design

We use SQLite with two tables:

### Room Table
Stores each collaboration room.
```
id          TEXT (8 chars)    Primary key e.g. "A1B2C3D4"
code        TEXT              Current code in the room
language    TEXT              Current language e.g. "python"
created_at  DATETIME          When room was created
last_active DATETIME          Last time someone used the room (for expiry)
```

### Snapshot Table
Stores saved code snapshots (like git commits for your code).
```
id          TEXT (8 chars)    Primary key
room_id     TEXT              Foreign key → Room.id (which room this belongs to)
name        TEXT              User-given name e.g. "v1.0 working version"
code        TEXT              The saved code
language    TEXT              The language at time of snapshot
created_at  DATETIME          When snapshot was saved
```

### ORM (Object Relational Mapper)
SQLAlchemy lets us work with the database using Python objects instead of writing SQL:

```python
# Instead of: INSERT INTO room VALUES (...)
room = Room(id="A1B2C3D4", code="print('hello')", language="python")
db.session.add(room)
db.session.commit()

# Instead of: SELECT * FROM room WHERE id = "A1B2C3D4"
room = Room.query.get("A1B2C3D4")
```

### Migration
When we added the `last_active` column to an existing database, we had to run a migration — a script that modifies an existing table's structure:

```python
# Add column if it doesn't exist in older DBs
if 'last_active' not in existing_columns:
    conn.execute("ALTER TABLE room ADD COLUMN last_active DATETIME")
```

---

## 7. Features Built

| # | Feature | How it works |
|---|---|---|
| 1 | **Create / Join rooms** | Server generates UUID-based 8-char code, stored in SQLite |
| 2 | **Real-time code sync** | WebSocket broadcasts debounced code changes to room |
| 3 | **Syntax highlighting** | CodeMirror 5 with Dracula theme, 5 languages supported |
| 4 | **Language selector** | Change syncs to all users via `language_change` event |
| 5 | **Inline cursor markers** | CodeMirror bookmarks show other users' positions |
| 6 | **Active users list** | Maintained server-side, pushed on join/leave events |
| 7 | **Real-time chat** | Separate WebSocket channel, last 100 messages kept in memory |
| 8 | **Code execution** | Python subprocess with 5s timeout, output shown in panel |
| 9 | **Snapshots / History** | Save named versions to SQLite, restore with one click |
| 10 | **Download code** | Browser Blob API creates downloadable file with correct extension |
| 11 | **Font size controls** | Adjusts CodeMirror font-size, saved in localStorage |
| 12 | **Auto-reconnect** | Socket.IO built-in + manual room rejoin on reconnect |
| 13 | **Read-only mode** | `?mode=view` URL param disables editor, shows banner |
| 14 | **Room expiry** | Daemon thread deletes rooms inactive for 24h |
| 15 | **Mobile responsive** | Sidebar collapses on small screens with a toggle button |
| 16 | **Copy room link** | Clipboard API copies full URL |
| 17 | **Session persistence** | Room code/language saved in SQLite, survives page refresh |

---

## 8. Configuration Details

### requirements.txt
Lists all Python packages that need to be installed (`pip install -r requirements.txt`):
```
flask==3.0.3          ← Web framework
flask-socketio==5.3.6 ← WebSocket support
flask-sqlalchemy==3.1.1 ← Database ORM
eventlet==0.35.2      ← Async library for handling many connections (production)
gunicorn==21.2.0      ← Production-grade web server
```

### Procfile
Tells Render/Heroku exactly how to start the application:
```
web: gunicorn --worker-class eventlet -w 1 --bind 0.0.0.0:$PORT app:app
```
- `gunicorn` — use gunicorn server (not Flask's dev server)
- `--worker-class eventlet` — use eventlet for async/WebSocket support
- `-w 1` — run 1 worker process (WebSockets require sticky sessions; multiple workers break them)
- `--bind 0.0.0.0:$PORT` — listen on the port Render assigns (`$PORT` is an environment variable)
- `app:app` — the Python file is `app.py`, the Flask object inside it is named `app`

### SQLite URI
```python
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///editor.db'
```
Three slashes `///` = relative path. Flask stores the file at `instance/editor.db`.

### Secret Key
```python
app.config['SECRET_KEY'] = 'collabcode-secret-key'
```
Used by Flask to cryptographically sign session cookies. In production, this should be a random string stored as an environment variable, not hardcoded.

### async_mode
```python
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='eventlet')
```
- `cors_allowed_origins="*"` — allows WebSocket connections from any domain
- `async_mode='eventlet'` — tells Flask-SocketIO to use eventlet for concurrency

---

## 9. Deployment Setup

### How Deployment Works (Render.com)
1. You push code to GitHub
2. Render detects the push, pulls your code
3. Render runs `pip install -r requirements.txt` to install packages
4. Render runs the command in `Procfile` to start your server
5. Render gives you a public URL (`https://yourapp.onrender.com`)

### Why not Flask's dev server in production?
Flask's built-in server (`app.run()`) is single-threaded — it can only handle one request at a time. Gunicorn can handle many concurrent connections, which is essential for WebSockets.

### Free Tier Limitation
Render's free tier spins down the app after 15 minutes of inactivity. The first request after that takes ~30 seconds to wake up. This is fine for a portfolio project.

---

## 10. Interview Questions & Answers

### General Architecture

**Q: What is this project and how does it work at a high level?**
A: CollabCode is a real-time collaborative code editor. Multiple users can join a shared "room" using an 8-character code and edit code simultaneously, see each other's cursors, and chat. It uses WebSockets for real-time communication — unlike regular HTTP which closes after each request, WebSockets maintain a persistent connection so the server can push updates to all connected browsers instantly. The backend is Flask + Flask-SocketIO, the frontend uses CodeMirror for the editor, and SQLite stores room state so users can rejoin sessions.

---

**Q: Why did you use WebSockets instead of regular HTTP polling?**
A: Polling means the browser repeatedly asks the server "any updates?" every few seconds, which is wasteful and introduces latency. WebSockets maintain a persistent two-way connection, so updates are pushed the moment they happen — typically under 50ms. For a collaborative editor where you need near-instant sync of every keystroke, polling would feel laggy and would generate huge amounts of unnecessary traffic.

---

**Q: How do you prevent feedback loops when syncing code changes?**
A: When a remote user's code update arrives, we update the editor programmatically. But updating the editor triggers CodeMirror's `change` event, which would cause us to emit the change back to the server, which would broadcast it again, creating an infinite loop. We prevent this with an `isRemote` boolean flag: set it to `true` before applying a remote update, check it at the start of the change handler and return early if true, then set it back to `false` after the update.

---

**Q: What is debouncing and why did you use it?**
A: Debouncing means waiting for a pause in input before acting. If a user types fast, we don't want to send a WebSocket message for every single character — that could be 10+ messages per second per user. Instead, we reset a 300ms timer on each keystroke and only send when the user stops typing for 300ms. This dramatically reduces server load and network traffic with no noticeable UX impact.

---

### Database

**Q: Why SQLite and not PostgreSQL?**
A: SQLite is a file-based database that requires zero configuration — no server process, no connection string, no credentials. For a development project and small-scale deployment, it's perfect. The trade-off is that it doesn't scale well for high concurrency or large datasets, and on platforms like Render, the file is ephemeral (lost on redeploy). For a production app, I'd migrate to PostgreSQL.

---

**Q: What is an ORM and why use one?**
A: ORM stands for Object Relational Mapper. It lets you interact with the database using Python objects and methods instead of writing raw SQL strings. For example, `Room.query.get(room_id)` instead of `SELECT * FROM room WHERE id = room_id`. Benefits: less boilerplate, safer from SQL injection, easier to refactor, and the same code works with different databases (SQLite in dev, PostgreSQL in prod) by just changing the connection string.

---

**Q: What is a database migration and when did you need one?**
A: A migration is a script that modifies an existing database schema — adding columns, renaming tables, etc. We needed one when we added the `last_active` column to the Room table. SQLAlchemy's `create_all()` only creates tables that don't exist — it won't modify existing tables. So we wrote a migration that checks if the column exists using SQLite's `PRAGMA table_info()` and runs `ALTER TABLE room ADD COLUMN last_active` if it's missing.

---

### Real-time & Concurrency

**Q: How do you handle multiple users in the same room?**
A: We maintain a server-side dictionary `active_users = { room_id: { socket_id: username } }`. When a user connects, their socket ID and username are added. When they disconnect, they're removed. Flask-SocketIO's `join_room()` function groups sockets, so when we call `emit('event', data, to=room_id)`, it sends only to users in that room.

---

**Q: Why do you use only 1 gunicorn worker for WebSockets?**
A: WebSockets require "sticky sessions" — once a client connects to a specific server process, all their messages must go to the same process because room state is stored in memory. With multiple workers, a client might connect to worker 1 but their room data is in worker 2's memory. The solution is either 1 worker, or using a shared state backend like Redis. For simplicity, we use 1 worker with eventlet which handles thousands of concurrent connections asynchronously.

---

**Q: What is eventlet and why is it needed?**
A: Eventlet is a concurrent networking library that uses "green threads" (lightweight cooperative threads). By default, Python handles one connection at a time per thread. With WebSockets, you might have 100 users connected simultaneously — you'd need 100 threads, which is expensive. Eventlet uses a single thread that switches between connections whenever one is waiting for I/O (like waiting for a message), making it very memory-efficient for many simultaneous WebSocket connections.

---

### Security

**Q: How did you make code execution safe?**
A: We run user code in a child subprocess using Python's `subprocess.run()` with a 5-second timeout. This isolates the user's code from the server process — it can't access Flask's variables or the database. The timeout prevents infinite loops from blocking the server. The limitation is that malicious code could still do things like write files or make network requests. A production-grade solution would use Docker containers for full isolation (each execution in a fresh, disposable container).

---

**Q: What security concern does CORS address?**
A: CORS (Cross-Origin Resource Sharing) is a browser security mechanism that blocks scripts on one domain from making requests to another domain. We set `cors_allowed_origins="*"` to allow WebSocket connections from any domain — necessary because in development, the browser might connect from `localhost:5000` while in production it connects from `yourapp.render.com`. In a production app with authentication, you'd restrict this to your specific domain.

---

### Frontend

**Q: What is the difference between localStorage and a database for storing font size?**
A: `localStorage` is a key-value store built into every browser that persists data on the user's device. It's perfect for user preferences like font size because: it's per-user (each person has their own preference), it doesn't need a server round-trip, and it persists across browser sessions. A database is used for shared data (like code that all room members need to see). Rule of thumb: if it's per-user preference, use localStorage. If multiple users need to see it, use a database.

---

**Q: How do inline cursor markers work technically?**
A: CodeMirror 5 has a `setBookmark(position, { widget: domElement })` API that inserts a DOM element at a specific position in the document. We create a `<span>` with `width: 2px` and a colored `background` to look like a cursor, plus a username label absolutely positioned above it. Each time a remote user moves their cursor, we clear their old bookmark and create a new one at their current position. The username label shows briefly (3 seconds) then fades out using a CSS class toggle.

---

### System Design

**Q: How would you scale this app to support 10,000 concurrent users?**
A: The current single-process design would break at scale. I'd:
1. Move room state from in-memory dict to Redis (shared across all server instances)
2. Use multiple gunicorn workers/instances behind a load balancer
3. Configure the load balancer for sticky sessions (same user always goes to same server), or use Redis pub/sub so all servers can broadcast to all clients
4. Migrate SQLite to PostgreSQL with connection pooling
5. Add a CDN for static files (CSS, JS)
6. Use Redis for chat history instead of in-memory dict

---

**Q: What would you improve if you had more time?**
A: Several things:
1. **Docker sandbox for code execution** — currently Python code runs directly on the server, which is a security risk. Docker containers would isolate each execution completely
2. **Operational Transform or CRDT** — currently we sync full code on every change. At scale this is wasteful. OT/CRDT algorithms sync only the delta (what changed), handle conflicts intelligently, and are how Google Docs works
3. **Authentication** — currently anyone who knows the room code can join. Adding JWT-based auth would let room owners control access
4. **Multiple files** — currently one code area per room. A file tree with tabs would make it more useful for real projects
5. **PostgreSQL** — replace SQLite for persistent, scalable storage

---

*This document covers the full technical implementation of CollabCode. Every concept here is fair game in SDE interviews — especially WebSockets, debouncing, feedback loop prevention, database design, and the scaling discussion.*
