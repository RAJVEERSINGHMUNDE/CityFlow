import os
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone


DB_PATH = os.environ.get(
    'CITYFLOW_DB_PATH', os.path.join(os.path.dirname(__file__), 'cityflow.db')
)


@contextmanager
def _connect():
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    try:
        yield connection
        connection.commit()
    finally:
        connection.close()


def init_db():
    with _connect() as db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS scenarios (
                id TEXT PRIMARY KEY,
                cause TEXT NOT NULL,
                latitude REAL NOT NULL,
                longitude REAL NOT NULL,
                event_type TEXT NOT NULL,
                start_time TEXT NOT NULL,
                expected_attendance INTEGER NOT NULL DEFAULT 0,
                expected_duration_hours REAL,
                closure_severity TEXT NOT NULL,
                requires_closure INTEGER NOT NULL,
                roads_affected TEXT,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS feedback (
                id TEXT PRIMARY KEY,
                event_id TEXT NOT NULL,
                actual_resolution_minutes REAL NOT NULL,
                predicted_resolution_minutes REAL,
                actual_officers INTEGER NOT NULL,
                recommended_officers INTEGER,
                actual_barricades INTEGER NOT NULL,
                recommended_barricades INTEGER,
                observed_severity TEXT NOT NULL,
                diversion_effective INTEGER NOT NULL,
                notes TEXT,
                created_at TEXT NOT NULL
            );
            
            CREATE TABLE IF NOT EXISTS tasks (
                id TEXT PRIMARY KEY,
                status TEXT NOT NULL,
                result_json TEXT,
                map_html TEXT,
                error TEXT,
                created_at TEXT NOT NULL
            );
            """
        )


def create_scenario(payload):
    scenario_id = f"SCN-{uuid.uuid4().hex[:8].upper()}"
    created_at = datetime.now(timezone.utc).isoformat()
    record = {
        'id': scenario_id,
        'cause': payload['cause'].strip(),
        'latitude': float(payload['latitude']),
        'longitude': float(payload['longitude']),
        'event_type': payload['event_type'],
        'time': payload['start_time'],
        'expected_attendance': int(payload.get('expected_attendance') or 0),
        'duration_hours': float(payload['expected_duration_hours'])
        if payload.get('expected_duration_hours') not in (None, '') else None,
        'closure_severity': payload['closure_severity'],
        'requires_closure': bool(payload['requires_closure']),
        'roads_affected': payload.get('roads_affected', '').strip(),
        'created_at': created_at,
        'source': 'operator_scenario',
    }
    with _connect() as db:
        db.execute(
            """INSERT INTO scenarios VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                record['id'], record['cause'], record['latitude'], record['longitude'],
                record['event_type'], record['time'], record['expected_attendance'],
                record['duration_hours'], record['closure_severity'],
                int(record['requires_closure']), record['roads_affected'], created_at,
            ),
        )
    return record


def list_scenarios(limit=50):
    with _connect() as db:
        rows = db.execute(
            'SELECT * FROM scenarios ORDER BY created_at DESC LIMIT ?', (limit,)
        ).fetchall()
    return [_scenario_from_row(row) for row in rows]


def get_scenario(scenario_id):
    with _connect() as db:
        row = db.execute('SELECT * FROM scenarios WHERE id = ?', (scenario_id,)).fetchone()
    return _scenario_from_row(row) if row else None


def _scenario_from_row(row):
    return {
        'id': row['id'],
        'cause': row['cause'],
        'latitude': row['latitude'],
        'longitude': row['longitude'],
        'event_type': row['event_type'],
        'time': row['start_time'],
        'expected_attendance': row['expected_attendance'],
        'duration_hours': row['expected_duration_hours'],
        'expected_duration_hours': row['expected_duration_hours'],
        'closure_severity': row['closure_severity'],
        'requires_closure': bool(row['requires_closure']),
        'roads_affected': row['roads_affected'],
        'route_path': '',
        'created_at': row['created_at'],
        'source': 'operator_scenario',
    }


def create_feedback(payload):
    record = {
        'id': f"OUT-{uuid.uuid4().hex[:8].upper()}",
        'event_id': payload['event_id'],
        'actual_resolution_minutes': float(payload['actual_resolution_minutes']),
        'predicted_resolution_minutes': _optional_float(payload.get('predicted_resolution_minutes')),
        'actual_officers': int(payload['actual_officers']),
        'recommended_officers': _optional_int(payload.get('recommended_officers')),
        'actual_barricades': int(payload['actual_barricades']),
        'recommended_barricades': _optional_int(payload.get('recommended_barricades')),
        'observed_severity': payload['observed_severity'],
        'diversion_effective': bool(payload['diversion_effective']),
        'notes': payload.get('notes', '').strip(),
        'created_at': datetime.now(timezone.utc).isoformat(),
    }
    with _connect() as db:
        db.execute(
            """INSERT INTO feedback VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                record['id'], record['event_id'], record['actual_resolution_minutes'],
                record['predicted_resolution_minutes'], record['actual_officers'],
                record['recommended_officers'], record['actual_barricades'],
                record['recommended_barricades'], record['observed_severity'],
                int(record['diversion_effective']), record['notes'], record['created_at'],
            ),
        )
    return record


def feedback_summary():
    with _connect() as db:
        rows = db.execute('SELECT * FROM feedback ORDER BY created_at DESC').fetchall()
    if not rows:
        return {
            'total_outcomes': 0,
            'mean_resolution_error_minutes': None,
            'diversion_success_rate': None,
            'recent_outcomes': [],
        }
    errors = [
        abs(row['actual_resolution_minutes'] - row['predicted_resolution_minutes'])
        for row in rows if row['predicted_resolution_minutes'] is not None
    ]
    recent = [dict(row) for row in rows[:10]]
    return {
        'total_outcomes': len(rows),
        'mean_resolution_error_minutes': round(sum(errors) / len(errors), 1) if errors else None,
        'diversion_success_rate': round(
            sum(row['diversion_effective'] for row in rows) / len(rows) * 100, 1
        ),
        'recent_outcomes': recent,
    }


def get_all_feedback() -> list[dict]:
    with _connect() as db:
        rows = db.execute('SELECT * FROM feedback').fetchall()
    return [dict(row) for row in rows]


def _optional_float(value):
    return float(value) if value not in (None, '') else None


def _optional_int(value):
    return int(value) if value not in (None, '') else None

import json

def create_task(task_id):
    with _connect() as db:
        db.execute(
            "INSERT INTO tasks (id, status, created_at) VALUES (?, ?, ?)",
            (task_id, 'pending', datetime.now(timezone.utc).isoformat())
        )

def update_task_success(task_id, result_dict, map_html):
    with _connect() as db:
        db.execute(
            "UPDATE tasks SET status = 'success', result_json = ?, map_html = ? WHERE id = ?",
            (json.dumps(result_dict), map_html, task_id)
        )

def update_task_error(task_id, error_msg):
    with _connect() as db:
        db.execute(
            "UPDATE tasks SET status = 'error', error = ? WHERE id = ?",
            (error_msg, task_id)
        )

def get_task(task_id):
    with _connect() as db:
        row = db.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    if not row:
        return None
    res = {'id': row['id'], 'status': row['status']}
    if row['status'] == 'success' and row['result_json']:
        res.update(json.loads(row['result_json']))
        res['map_url'] = f"/api/maps/{task_id}"
    elif row['status'] == 'error':
        res['error'] = row['error']
    return res

def get_task_map(task_id):
    with _connect() as db:
        row = db.execute("SELECT map_html FROM tasks WHERE id = ?", (task_id,)).fetchone()
    return row['map_html'] if row else None
