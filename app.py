from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO, join_room, emit
from models import db, Room, Snapshot
from datetime import datetime, timedelta
import uuid, subprocess, sys, threading, time

app = Flask(__name__)
app.config['SECRET_KEY'] = 'collabcode-secret-key'
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///editor.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db.init_app(app)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

active_users = {}   # {room_id: {sid: username}}
chat_history = {}   # {room_id: [messages]}  — in-memory, last 100 per room


# --- Background: delete rooms inactive for 24h ---
def _cleanup_loop():
    while True:
        time.sleep(3600)
        with app.app_context():
            cutoff = datetime.utcnow() - timedelta(hours=24)
            old = Room.query.filter(Room.last_active < cutoff).all()
            for room in old:
                db.session.delete(room)
            if old:
                db.session.commit()

threading.Thread(target=_cleanup_loop, daemon=True).start()

with app.app_context():
    db.create_all()
    # Migration: add last_active to room table if missing (handles existing DBs)
    with db.engine.connect() as conn:
        from sqlalchemy import text
        cols = [r[1] for r in conn.execute(text("PRAGMA table_info(room)")).fetchall()]
        if 'last_active' not in cols:
            conn.execute(text("ALTER TABLE room ADD COLUMN last_active DATETIME DEFAULT CURRENT_TIMESTAMP"))
            conn.commit()


# --- Page routes ---

@app.route('/')
def index():
    return render_template('index.html')


@app.route('/room/<room_id>')
def editor(room_id):
    room = Room.query.get(room_id)
    if not room:
        room = Room(id=room_id, code='# Start coding here...\n', language='python')
        db.session.add(room)
        db.session.commit()
    return render_template('editor.html', room=room)


@app.route('/create-room', methods=['POST'])
def create_room():
    room_id = str(uuid.uuid4())[:8].upper()
    room = Room(id=room_id, code='# Start coding here...\n', language='python')
    db.session.add(room)
    db.session.commit()
    return jsonify({'room_id': room_id})


# --- Code execution ---

@app.route('/execute', methods=['POST'])
def execute_code():
    data = request.json
    code = data.get('code', '')
    language = data.get('language', 'python')

    if language != 'python':
        return jsonify({
            'output': f'Execution is only supported for Python right now.\nOther languages coming soon!',
            'error': False
        })

    try:
        result = subprocess.run(
            [sys.executable, '-c', code],
            capture_output=True, text=True, timeout=5
        )
        output = result.stdout + result.stderr
        return jsonify({'output': output or '(no output)', 'error': bool(result.returncode)})
    except subprocess.TimeoutExpired:
        return jsonify({'output': 'Timed out (5s limit).', 'error': True})
    except Exception as e:
        return jsonify({'output': str(e), 'error': True})


# --- Snapshot routes ---

@app.route('/room/<room_id>/snapshots', methods=['GET'])
def get_snapshots(room_id):
    snaps = Snapshot.query.filter_by(room_id=room_id).order_by(Snapshot.created_at.desc()).all()
    return jsonify([{
        'id': s.id,
        'name': s.name,
        'language': s.language,
        'created_at': s.created_at.strftime('%b %d, %H:%M')
    } for s in snaps])


@app.route('/room/<room_id>/snapshots', methods=['POST'])
def save_snapshot(room_id):
    room = Room.query.get(room_id)
    if not room:
        return jsonify({'error': 'Room not found'}), 404
    data = request.json
    snap = Snapshot(
        id=str(uuid.uuid4())[:8],
        room_id=room_id,
        name=data.get('name', f'Snapshot {datetime.utcnow().strftime("%H:%M")}'),
        code=room.code,
        language=room.language
    )
    db.session.add(snap)
    db.session.commit()
    return jsonify({'id': snap.id, 'name': snap.name, 'language': snap.language,
                    'created_at': snap.created_at.strftime('%b %d, %H:%M')})


@app.route('/room/<room_id>/snapshots/<snap_id>/restore', methods=['POST'])
def restore_snapshot(room_id, snap_id):
    snap = Snapshot.query.get(snap_id)
    if not snap or snap.room_id != room_id:
        return jsonify({'error': 'Not found'}), 404
    room = Room.query.get(room_id)
    room.code = snap.code
    room.language = snap.language
    room.last_active = datetime.utcnow()
    db.session.commit()
    socketio.emit('code_update', {'code': snap.code}, to=room_id)
    socketio.emit('language_update', {'language': snap.language}, to=room_id)
    return jsonify({'code': snap.code, 'language': snap.language})


# --- WebSocket events ---

@socketio.on('join')
def on_join(data):
    room_id = data['room_id']
    username = data['username']
    join_room(room_id)

    active_users.setdefault(room_id, {})[request.sid] = username

    room = Room.query.get(room_id)
    emit('init_code', {'code': room.code, 'language': room.language})

    if room_id in chat_history:
        emit('chat_history', {'messages': chat_history[room_id]})

    emit('user_list_update', {
        'users': list(active_users[room_id].values()),
        'event': 'joined', 'username': username
    }, to=room_id)


@socketio.on('code_change')
def on_code_change(data):
    room_id = data['room_id']
    code = data['code']
    room = Room.query.get(room_id)
    if room:
        room.code = code
        room.last_active = datetime.utcnow()
        db.session.commit()
    emit('code_update', {'code': code}, to=room_id, include_self=False)


@socketio.on('language_change')
def on_language_change(data):
    room_id = data['room_id']
    language = data['language']
    room = Room.query.get(room_id)
    if room:
        room.language = language
        room.last_active = datetime.utcnow()
        db.session.commit()
    emit('language_update', {'language': language}, to=room_id, include_self=False)


@socketio.on('cursor_move')
def on_cursor_move(data):
    room_id = data['room_id']
    username = active_users.get(room_id, {}).get(request.sid, 'Unknown')
    emit('cursor_update', {
        'username': username, 'line': data['line'], 'ch': data['ch']
    }, to=room_id, include_self=False)


@socketio.on('chat_message')
def on_chat_message(data):
    room_id = data['room_id']
    username = active_users.get(room_id, {}).get(request.sid, 'Unknown')
    msg = {'username': username, 'text': data['text'],
           'time': datetime.utcnow().strftime('%H:%M')}
    history = chat_history.setdefault(room_id, [])
    history.append(msg)
    chat_history[room_id] = history[-100:]
    emit('chat_broadcast', msg, to=room_id)


@socketio.on('disconnect')
def on_disconnect():
    for room_id, users in list(active_users.items()):
        if request.sid in users:
            username = users.pop(request.sid)
            emit('remove_cursor', {'username': username}, to=room_id)
            emit('user_list_update', {
                'users': list(users.values()),
                'event': 'left', 'username': username
            }, to=room_id)
            if not users:
                del active_users[room_id]
            break


if __name__ == '__main__':
    socketio.run(app, debug=True, port=5000, allow_unsafe_werkzeug=True)
