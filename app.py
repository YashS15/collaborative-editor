from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO, join_room, leave_room, emit
from models import db, Room
import uuid

app = Flask(__name__)
app.config['SECRET_KEY'] = 'collabcode-secret-key'
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///editor.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db.init_app(app)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

# {room_id: {sid: username}}
active_users = {}


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


# --- WebSocket Events ---

@socketio.on('join')
def on_join(data):
    room_id = data['room_id']
    username = data['username']

    join_room(room_id)

    if room_id not in active_users:
        active_users[room_id] = {}
    active_users[room_id][request.sid] = username

    room = Room.query.get(room_id)
    emit('init_code', {
        'code': room.code,
        'language': room.language
    })

    emit('user_list_update', {
        'users': list(active_users[room_id].values()),
        'event': 'joined',
        'username': username
    }, to=room_id)


@socketio.on('code_change')
def on_code_change(data):
    room_id = data['room_id']
    code = data['code']

    room = Room.query.get(room_id)
    if room:
        room.code = code
        db.session.commit()

    emit('code_update', {'code': code}, to=room_id, include_self=False)


@socketio.on('language_change')
def on_language_change(data):
    room_id = data['room_id']
    language = data['language']

    room = Room.query.get(room_id)
    if room:
        room.language = language
        db.session.commit()

    emit('language_update', {'language': language}, to=room_id, include_self=False)


@socketio.on('cursor_move')
def on_cursor_move(data):
    room_id = data['room_id']
    username = active_users.get(room_id, {}).get(request.sid, 'Unknown')
    emit('cursor_update', {
        'username': username,
        'line': data['line'],
        'ch': data['ch']
    }, to=room_id, include_self=False)


@socketio.on('disconnect')
def on_disconnect():
    for room_id, users in list(active_users.items()):
        if request.sid in users:
            username = users.pop(request.sid)
            emit('user_list_update', {
                'users': list(users.values()),
                'event': 'left',
                'username': username
            }, to=room_id)
            if not users:
                del active_users[room_id]
            break


if __name__ == '__main__':
    with app.app_context():
        db.create_all()
    socketio.run(app, debug=True, port=5000)
