import os
import sys
import uuid
import threading
from flask import Flask, jsonify, request
from flask_cors import CORS

# Add simulator directory to path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '../simulator')))

from data_pipeline    import DataPipeline
from graph_engine     import GraphEngine, graph_ready_event, mask_edges_from_linestring
from simulator        import CongestionSimulator
import pandas as pd
from severity_model   import get_predictor, model_ready_event
from survival_model   import get_forecaster
from nlp_impact       import get_nlp_classifier
from hotspot_analyzer import init_analyzer, get_analyzer
from manpower         import allocate_manpower
from realtime_feed import init_feed, get_feed
from storage import (
    create_feedback, create_scenario, feedback_summary, get_scenario,
    init_db, list_scenarios, create_task, update_task_success,
    update_task_error, get_task, get_task_map, get_all_feedback
)

app  = Flask(__name__)
CORS(app)

# ── Data ──────────────────────────────────────────────────────────────────────
DATA_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), '../../dataset/2.csv')
)


pipeline = DataPipeline(DATA_PATH)
pipeline.load_and_clean_data()
init_db()

# Cached events list (avoid full scan on every simulate call)
_events_cache: list | None = None

def get_cached_events(n: int = 500) -> list:
    global _events_cache
    if _events_cache is None:
        _events_cache = pipeline.get_top_events(n)
    return _events_cache

# Pre-populate cache
get_cached_events()


def find_event(event_id: str):
    return (
        next((event for event in get_cached_events() if event['id'] == event_id), None)
        or get_scenario(event_id)
    )

# ── Maps output dir ────────────────────────────────────────────────────────────
MAPS_DIR = os.path.abspath(
    os.path.join(os.path.dirname(__file__), 'static', 'maps')
)
os.makedirs(MAPS_DIR, exist_ok=True)
HEATMAP_PATH = os.path.join(MAPS_DIR, 'hotspot_heatmap.html')

# ── Background startup tasks ───────────────────────────────────────────────────

def _load_graph_background():
    print("[Startup] Background graph loader started...")
    try:
        GraphEngine.load_global_graph(pipeline.df)
        print("[Startup] Global graph ready — fast sub-graph mode active.")
    except Exception as e:
        import traceback
        print(f"[Startup] WARNING: Graph load failed: {e}")
        traceback.print_exc()
        print("[Startup] Simulations will use per-request OSM fetch as fallback.")

def _train_severity_model_background():
    print("[Startup] Background ML training started...")
    try:
        predictor = get_predictor()
        predictor.train(pipeline.df)
        forecaster = get_forecaster()
        forecaster.fit(pipeline.df)
        nlp_clf = get_nlp_classifier()
        nlp_clf.fit(pipeline.df)
        model_ready_event.set()
        print("[Startup] Severity, Survival & NLP models ready.")
    except Exception as e:
        import traceback
        print(f"[Startup] WARNING: ML training failed: {e}")
        traceback.print_exc()
        model_ready_event.set()   # still set so predictions fall back gracefully

def _build_hotspot_background():
    print("[Startup] Building hotspot analytics...")
    try:
        analyzer = init_analyzer(pipeline.df)
        analyzer.generate_heatmap(HEATMAP_PATH)
        print("[Startup] Hotspot analytics and heatmap ready.")
    except Exception as e:
        import traceback
        print(f"[Startup] WARNING: Hotspot build failed: {e}")
        traceback.print_exc()

def _init_realtime_feed_background():
    print("[Startup] Initializing realtime feed...")
    try:
        init_feed(pipeline.df)
        print("[Startup] Realtime feed ready.")
    except Exception as e:
        import traceback
        print(f"[Startup] WARNING: Realtime feed init failed: {e}")
        traceback.print_exc()

threading.Thread(target=_load_graph_background,          daemon=True).start()
threading.Thread(target=_train_severity_model_background, daemon=True).start()
threading.Thread(target=_build_hotspot_background,        daemon=True).start()
threading.Thread(target=_init_realtime_feed_background, daemon=True).start()


# ── API Routes ────────────────────────────────────────────────────────────────

@app.route('/api/events', methods=['GET'])
def get_events():
    return jsonify({
        "events": pipeline.get_top_events(50),
        "scenarios": list_scenarios(),
    })


@app.route('/api/scenarios', methods=['GET', 'POST'])
def scenarios():
    if request.method == 'GET':
        return jsonify({'scenarios': list_scenarios()})
    payload = request.get_json(silent=True) or {}
    error = _validate_scenario(payload)
    if error:
        return jsonify({'error': error}), 400
    return jsonify({'scenario': create_scenario(payload)}), 201


def _validate_scenario(payload):
    required = ['cause', 'latitude', 'longitude', 'event_type', 'start_time',
                'closure_severity', 'requires_closure']
    missing = [field for field in required if payload.get(field) in (None, '')]
    if missing:
        return f"Missing required fields: {', '.join(missing)}"
    try:
        lat, lon = float(payload['latitude']), float(payload['longitude'])
        attendance = int(payload.get('expected_attendance') or 0)
    except (TypeError, ValueError):
        return 'Coordinates and attendance must be numeric.'
    if not (12.6 <= lat <= 13.4 and 77.2 <= lon <= 78.1):
        return 'Scenario coordinates must be within the Bengaluru operating area.'
    if attendance < 0:
        return 'Expected attendance cannot be negative.'
    if payload['event_type'] not in ('planned', 'unplanned'):
        return 'event_type must be planned or unplanned.'
    if payload['closure_severity'] not in ('partial', 'full'):
        return 'closure_severity must be partial or full.'
    if not isinstance(payload['requires_closure'], bool):
        return 'requires_closure must be a boolean.'
    return None


@app.route('/api/feedback', methods=['POST'])
def submit_feedback():
    payload = request.get_json(silent=True) or {}
    required = ['event_id', 'actual_resolution_minutes', 'actual_officers',
                'actual_barricades', 'observed_severity', 'diversion_effective']
    missing = [field for field in required if payload.get(field) in (None, '')]
    if missing:
        return jsonify({'error': f"Missing required fields: {', '.join(missing)}"}), 400
    if payload['observed_severity'] not in ('Green', 'Amber', 'Red'):
        return jsonify({'error': 'observed_severity must be Green, Amber, or Red.'}), 400
    try:
        if any(float(payload[field]) < 0 for field in
               ('actual_resolution_minutes', 'actual_officers', 'actual_barricades')):
            raise ValueError
        outcome = create_feedback(payload)
    except (TypeError, ValueError):
        return jsonify({'error': 'Actual outcome values must be non-negative numbers.'}), 400

    # ── Post-Event Retraining Trigger (NLP + Manpower) ────────────────────────
    feedback_list = get_all_feedback()
    if len(feedback_list) > 0 and len(feedback_list) % 10 == 0:
        # Every 10 feedback entries, trigger retraining asynchronously
        def _retrain():
            df = pipeline.df
            retrain_data = []
            manpower_rows = []
            for f in feedback_list:
                ev_id = f['event_id']
                ev = find_event(ev_id) or {}
                # NLP: join with event descriptions from dataframe
                matches = df[df['id'] == ev_id] if 'id' in df.columns else []
                desc = matches.iloc[0]['description'] if len(matches) > 0 else None
                if desc:
                    f['description'] = desc
                    retrain_data.append(f)
                # Manpower: build feature row from feedback + event metadata
                manpower_rows.append({
                    'actual_officers':       f['actual_officers'],
                    'actual_barricades':     f['actual_barricades'],
                    'recommended_officers':  f.get('recommended_officers'),
                    'recommended_barricades':f.get('recommended_barricades'),
                    'severity_score':        float(ev.get('severity_score', 5.0) or 5.0),
                    'expected_attendance':   int(ev.get('expected_attendance', 0) or 0),
                    'time_of_day_label':     ev.get('time_of_day_label', 'Off-Peak'),
                    'requires_closure':      bool(ev.get('requires_closure', False)),
                })
            if retrain_data:
                get_nlp_classifier().retrain_from_feedback(retrain_data)
            from manpower import refit_manpower_weights
            refit_manpower_weights(manpower_rows)

        threading.Thread(target=_retrain, daemon=True).start()

    return jsonify({'outcome': outcome, 'summary': feedback_summary()}), 201


@app.route('/api/feedback/summary', methods=['GET'])
def get_feedback_summary():
    return jsonify(feedback_summary())


@app.route('/api/severity/<event_id>', methods=['GET'])
def get_severity(event_id):
    """
    Fast severity prediction for a single event (< 5ms after model loads).
    Returns immediately using rule-based fallback if ML model isn't trained yet.
    """
    event = find_event(event_id)
    if not event:
        return jsonify({"error": "Event not found"}), 404

    predictor = get_predictor()
    severity  = predictor.predict(event)

    forecaster = get_forecaster()
    survival = forecaster.predict_clearance(event)
    severity['clearance_forecast'] = survival

    nlp_clf = get_nlp_classifier()
    nlp_impact = nlp_clf.predict_impact(event.get('description', ''))
    severity['nlp_disruption_prob'] = nlp_impact['disrupted_prob']
    severity['nlp_flagged_words'] = nlp_impact.get('flagged_words', [])

    # Attach nearby historical context from hotspot analyzer
    analyzer = get_analyzer()
    if analyzer:
        nearby = analyzer.get_nearby_events(
            event['latitude'], event['longitude'], radius_km=2.0
        )
        severity['nearby_historical_events'] = nearby['total_nearby']
        severity['nearby_closure_events']    = nearby['closure_requiring']
        severity['nearby_cause_breakdown']   = nearby['cause_breakdown']
    else:
        severity['nearby_historical_events'] = 0
        severity['nearby_closure_events']    = 0
        severity['nearby_cause_breakdown']   = {}

    from impact_forecast import get_impact_forecaster
    severity['impact_forecast'] = get_impact_forecaster(analyzer).forecast(event)

    return jsonify(severity)


@app.route('/api/hotspots', methods=['GET'])
def get_hotspots():
    """Returns hotspot junction rankings, temporal patterns, and heatmap URL."""
    analyzer = get_analyzer()
    if not analyzer:
        return jsonify({"status": "building", "message": "Hotspot data still loading..."}), 202

    heatmap_url = '/maps/hotspot_heatmap.html' if os.path.exists(HEATMAP_PATH) else None

    return jsonify({
        "heatmap_url":       heatmap_url,
        "top_junctions":     analyzer.get_hotspot_summary(top_n=20),
        "temporal_patterns": analyzer.get_temporal_patterns(),
        "summary_stats":     analyzer.get_summary_stats(),
    })


from flask import send_from_directory

@app.route('/api/maps/<task_id>')
def serve_maps(task_id):
    """Serves dynamic map HTML directly from the database."""
    map_html = get_task_map(task_id)
    if not map_html:
        return "Map not found", 404
    return map_html

@app.route('/maps/<path:filename>')
def serve_static_maps(filename):
    """Serves static map HTML files (like the heatmap)."""
    return send_from_directory(MAPS_DIR, filename)


# ── Video streaming with HTTP Range support ──────────────────────────────
# A 200–500 MB presentation.mp4 is too big to fully download before the
# user can seek. The <video> element issues partial-content requests when
# the user scrubs, so we parse the Range header and return 206 Partial
# Content with the right Content-Range. Cache-Control is set to
# "immutable" so Cloudflare holds the file at the edge after the first hit.

import os as _os
import mimetypes as _mimetypes

VIDEOS_DIR = _os.path.abspath(
    _os.path.join(_os.path.dirname(__file__), 'static', 'videos')
)
_os.makedirs(VIDEOS_DIR, exist_ok=True)


@app.route('/videos/<path:filename>')
def serve_videos(filename):
    """Stream a video file from static/videos with HTTP Range support."""
    from flask import Response, request, abort

    path = _os.path.join(VIDEOS_DIR, filename)
    if not _os.path.isfile(path):
        abort(404)

    mime, _ = _mimetypes.guess_type(filename)
    mime = mime or 'video/mp4'
    file_size = _os.path.getsize(path)

    common_headers = {
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=31536000, immutable',
    }

    range_header = request.headers.get('Range')
    if not range_header:
        return Response(
            open(path, 'rb').read(),
            mimetype=mime,
            headers={**common_headers, 'Content-Length': str(file_size)},
        )

    # Parse "bytes=START-END"
    try:
        _, rng = range_header.split('=')
        start_s, end_s = rng.split('-')
        start = int(start_s) if start_s else 0
        end   = int(end_s) if end_s else file_size - 1
    except Exception:
        abort(416)

    end   = min(end, file_size - 1)
    length = end - start + 1
    with open(path, 'rb') as f:
        f.seek(start)
        data = f.read(length)

    return Response(
        data,
        status=206,
        mimetype=mime,
        headers={
            **common_headers,
            'Content-Range': f'bytes {start}-{end}/{file_size}',
            'Content-Length': str(length),
        },
    )


def _run_simulation_task(task_id, event_id, lat, lon, time_str, event_dict):
    try:
        import osmnx as ox
        import networkx as nx

        # ── Build local subgraph ───────────────────────────────────────────────
        engine = GraphEngine(lat, lon, dist=1500)
        
        # Wait for global graph to be ready before proceeding
        graph_ready_event.wait(timeout=60)
        
        if GraphEngine.GLOBAL_GRAPH is not None:
            print(f"[Sim] Sub-graph from cache for ({lat:.4f}, {lon:.4f})")
            G = engine.build_graph()
            if not any('travel_time' in d for _, _, d in G.edges(data=True)):
                G = ox.add_edge_speeds(G)
                G = ox.add_edge_travel_times(G)
        else:
            print(f"[Sim] Cache miss — fetching from OSM for ({lat:.4f}, {lon:.4f})")
            G = ox.graph_from_point((lat, lon), dist=1500, network_type='drive')
            G = ox.add_edge_speeds(G)
            G = ox.add_edge_travel_times(G)
            engine.G = G

        # ── Setup and NLP Capacity Modification ───────────────────────────────
        seed = hash(event_id) & 0x7FFF_FFFF
        sim  = CongestionSimulator(G, lat, lon, start_datetime=time_str, seed=seed,
                                    event_type=event_dict.get('event_type', 'unplanned'))

        nlp_clf = get_nlp_classifier()
        nlp_impact = nlp_clf.predict_impact(event_dict.get('description', ''))
        
        # Corridor-weighted capacity factor from NLP disruption prob + historical corridor closure rates
        analyzer = get_analyzer()
        corridor = event_dict.get('corridor', 'Non-corridor')
        corridor_w = analyzer.corridor_closure_weight(corridor) if analyzer else 1.0
        max_reduction = 0.5
        capacity_factor = max(
            0.25, 1.0 - (nlp_impact['disrupted_prob'] * corridor_w * max_reduction)
        )

        # ── Pre-closed edges from linestring ──────────────────────────────────
        pre_closed_edges = mask_edges_from_linestring(G, event_dict.get('route_path'))

        affected_flows = sim.find_affected_flows(max_flows=3)
        if not affected_flows:
            update_task_error(task_id, "No arterial traffic flow through this event could be identified.")
            return

        attendance = int(event_dict.get('expected_attendance') or 0)
        spillover_radius = CongestionSimulator.derive_spillover_radius(attendance, base=1000)
        closed, spillover = sim.simulate_congestion_shockwave(
            closure_radius=50, spillover_radius=spillover_radius,
            capacity_factor=capacity_factor, pre_closed_edges=pre_closed_edges
        )
        flow_results = sim.evaluate_interventions(affected_flows, closed)
        barricades = sim.recommend_barricades(closed)
        barricade_validation = sim.validate_barricades(barricades, closed)
        valid_barricades = [item['node_id'] for item in barricade_validation if item['valid']]

        # ── Enriched metrics ──────────────────────────────────────────────────
        # ── Severity & Clearance (use cached prediction if available) ─────────
        predictor = get_predictor()
        severity  = predictor.predict(event_dict)
        
        forecaster = get_forecaster()
        survival = forecaster.predict_clearance(event_dict)

        # ── Manpower plan ─────────────────────────────────────────────────────
        manpower_plan = allocate_manpower(
            barricade_nodes   = valid_barricades,
            severity_result   = severity,
            event_dict        = event_dict,
            graph             = G,
            time_of_day_label = sim.time_of_day_label,
            cox_t80           = survival['t80_clearance_min'],
        )

        from impact_forecast import get_impact_forecaster
        impact_forecast = get_impact_forecaster(get_analyzer()).forecast(
            event_dict,
            sim_result={
                'closed_edges': len(closed),
                'spillover_edges': len(spillover),
                'spillover_radius_m': spillover_radius,
            },
            flow_results=flow_results,
        )

        map_html = sim.visualize_flows(flow_results, valid_barricades)

        valid_flows = [flow for flow in flow_results if flow['valid_intervention']]
        total_saved = round(sum(flow['time_saved_minutes'] for flow in valid_flows), 1)
        average_reduction = round(
            sum(flow['delay_reduction_pct'] for flow in valid_flows) / len(valid_flows), 1
        ) if valid_flows else 0.0
        public_flows = [
            {key: value for key, value in flow.items()
             if key not in ('normal_route', 'diverted_route')}
            for flow in flow_results
        ]

        # Generate Baseline map (Epicenter + Chaos, no diversions)
        baseline_html = sim.visualize_flows([], [])
        baseline_filename = f"baseline_{task_id}.html"
        baseline_path = os.path.join(MAPS_DIR, baseline_filename)
        with open(baseline_path, 'w', encoding='utf-8') as f:
            f.write(baseline_html)

        result_dict = {
            "metrics": {
                "barricades_needed":     len(valid_barricades),
                "closed_edges":          len(closed),
                "affected_flows":        len(flow_results),
                "valid_diversions":      len(valid_flows),
                "total_time_saved_minutes": total_saved,
                "average_delay_reduction_pct": average_reduction,
                "time_of_day_label":     sim.time_of_day_label,
                "time_multiplier":       sim.time_multiplier,
                "severity_score":        severity.get('severity_score', 5.0),
                "spillover_radius_m":    spillover_radius,
            },
            "impact_forecast": impact_forecast,
            "flow_analysis": public_flows,
            "barricade_validation": barricade_validation,
            "manpower_plan": manpower_plan,
            "diversion_plan": sim.synthesize_diversion_plan(flow_results, barricade_validation, manpower_plan, closed),
            "maps": {
                "active_url": f"/api/maps/{task_id}",
                "baseline_url": f"/maps/{baseline_filename}"
            }
        }
        
        update_task_success(task_id, result_dict, map_html)

    except Exception as e:
        import traceback
        traceback.print_exc()
        update_task_error(task_id, str(e))


@app.route('/api/simulate/<event_id>', methods=['POST'])
def simulate_event(event_id):
    event = find_event(event_id)
    if not event:
        return jsonify({"error": "Event not found"}), 404

    task_id = str(uuid.uuid4())
    create_task(task_id)

    threading.Thread(
        target=_run_simulation_task,
        args=(task_id, event_id, event['latitude'], event['longitude'],
              event.get('time'), event),
        daemon=True,
    ).start()

    return jsonify({"status": "pending", "task_id": task_id})


@app.route('/api/status/<task_id>', methods=['GET'])
def get_task_status(task_id):
    task = get_task(task_id)
    if not task:
        return jsonify({"error": "Task not found"}), 404
    return jsonify(task)

@app.route('/api/realtime/incidents', methods=['GET'])
def get_realtime_incidents():
    as_of = request.args.get('as_of')
    if not as_of:
        return jsonify({'error': 'as_of query param required'}), 400
    try:
        ts = pd.to_datetime(as_of)
    except Exception:
        return jsonify({'error': 'invalid as_of datetime'}), 400
    feed = get_feed()
    if not feed:
        return jsonify({'error': 'Realtime feed not initialized'}), 500
    incidents = feed.get_active_incidents(ts.to_pydatetime())
    return jsonify({'incidents': incidents})

@app.route('/api/realtime/stream', methods=['GET'])
def realtime_stream():
    def generate():
        import random, json, time
        while True:
            data = {
                "type": "live_update",
                "speed_updates": {f"edge_{random.randint(1000, 9000)}": random.randint(5, 45) for _ in range(3)},
                "incident_ping": None
            }
            if random.random() > 0.8:
                data["incident_ping"] = {"message": "New congestion detected near ORR", "severity": "Amber"}
            yield f"data: {json.dumps(data)}\n\n"
            time.sleep(2)
    from flask import Response
    return Response(generate(), mimetype='text/event-stream', headers={'Cache-Control': 'no-cache', 'Connection': 'keep-alive'})

@app.route('/api/scenarios/demo', methods=['POST'])
def load_demo_scenarios():
    demos = [
        {
            "cause": "Cricket Match",
            "latitude": 12.9784,
            "longitude": 77.5994,
            "event_type": "planned",
            "start_time": "2024-05-15T18:00:00",
            "closure_severity": "partial",
            "requires_closure": True,
            "expected_attendance": 35000,
            "description": "Cricket Match at M. Chinnaswamy Stadium"
        },
        {
            "cause": "Heavy Vehicle Breakdown",
            "latitude": 12.9345,
            "longitude": 77.6266,
            "event_type": "unplanned",
            "start_time": "2024-05-16T08:30:00",
            "closure_severity": "full",
            "requires_closure": True,
            "description": "Heavy multi-axle truck broken down blocking two lanes on ORR."
        },
        {
            "cause": "Accident / Radio Report",
            "latitude": 13.0285,
            "longitude": 77.5895,
            "event_type": "unplanned",
            "start_time": "2024-05-16T09:15:00",
            "closure_severity": "partial",
            "requires_closure": False,
            "description": "ಟ್ರಾಫಿಕ್ ತುಂಬಾ ನಿಧಾನವಾಗಿದೆ. Heavy traffic moving slow near Mekhri Circle."
        }
    ]
    created = []
    for d in demos:
        created.append(create_scenario(d))
    return jsonify({"message": "Demo scenarios loaded", "scenarios": created}), 201


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8000, debug=False)
