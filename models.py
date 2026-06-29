from flask_sqlalchemy import SQLAlchemy
from datetime import datetime

db = SQLAlchemy()


class Room(db.Model):
    id = db.Column(db.String(8), primary_key=True)
    code = db.Column(db.Text, default='')
    language = db.Column(db.String(20), default='python')
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
