from flask_sqlalchemy import SQLAlchemy
from datetime import datetime

db = SQLAlchemy()


class Room(db.Model):
    id = db.Column(db.String(8), primary_key=True)
    code = db.Column(db.Text, default='')
    language = db.Column(db.String(20), default='python')
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    last_active = db.Column(db.DateTime, default=datetime.utcnow)
    snapshots = db.relationship('Snapshot', backref='room', lazy=True, cascade='all, delete-orphan')


class Snapshot(db.Model):
    id = db.Column(db.String(8), primary_key=True)
    room_id = db.Column(db.String(8), db.ForeignKey('room.id'), nullable=False)
    name = db.Column(db.String(100))
    code = db.Column(db.Text)
    language = db.Column(db.String(20))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
