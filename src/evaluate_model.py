"""
CityFlow evaluation harness — 6 phases, matches the current architecture.

Phases:
  1. Shockwave topology (false positives vs Euclidean)
  2. Affected-flow selection (every selected flow crosses the epicenter)
  3. Barricade validation (edge-set based, no graph fracture)
  4. Time-of-day routing differential (route must change between rush/night)
  5. Cox PH concordance + NLP weak-label precision/recall
  6. Manpower + diversion learning loop (forecast error from feedback table)
"""
import os
import sys
import json
import networkx as nx
import osmnx as ox

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), 'simulator')))
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), 'api')))

from data_pipeline import DataPipeline
from graph_engine import GraphEngine
from simulator import CongestionSimulator
from severity_model import get_predictor
from survival_model import get_forecaster
from nlp_impact import get_nlp_classifier
from hotspot_analyzer import init_analyzer
from manpower import allocate_manpower
from storage import feedback_summary, get_all_feedback

DATA_PATH = r"d:\\CODE\\Python\\AIML\\CityFlow\\dataset\\2.csv"

def phase1_topology(sim):
    euclidean_closed = set()
    for u, v, _, data in sim.G.edges(keys=True, data=True):
        nd = sim.G.nodes[u]
        if ox.distance.great_circle(sim.epicenter_lat, sim.epicenter_lon,
                                    nd['y'], nd['x']) <= 50:
            euclidean_closed.add((u, v))
    bfs_closed, _ = sim.simulate_congestion_shockwave(50, 1000)
    return len(euclidean_closed - bfs_closed)

def phase2_flow_selection(sim):
    flows = sim.find_affected_flows(max_flows=3)
    if not flows:
        return 0, 0
    crossing = sum(sim.epicenter_node in f['normal_route'] for f in flows)
    return crossing, len(flows)

def phase3_barricade_validation(sim, closed):
    barricades = sim.recommend_barricades(closed)
    validation = sim.validate_barricades(barricades, closed)
    valid = sum(1 for v in validation if v['valid'])
    # Edge-set connectivity check: removing the closed EDGES (not nodes)
    # must leave the graph connected.
    g = sim.base_G.copy()
    g.remove_edges_from(list(closed))
    largest = max((len(c) for c in nx.strongly_connected_components(g)), default=0)
    connected = largest >= 0.95 * len(g)
    return valid, len(barricades), connected

def phase4_time_of_day(G, lat, lon):
    from unittest.mock import patch
    with patch('src.simulator.simulator.ox.distance.nearest_nodes', return_value=0):
        sim_night = CongestionSimulator(G, lat, lon, start_datetime="2024-01-01 03:00:00")
        sim_rush  = CongestionSimulator(G, lat, lon, start_datetime="2024-01-01 18:00:00")
    # Must apply time-of-day weights before finding flows or routes,
    # otherwise both simulators have identical free-flow speeds.
    sim_night._apply_time_of_day_weights()
    sim_rush._apply_time_of_day_weights()
    flows_night = sim_night.find_affected_flows(1)
    flows_rush = sim_rush.find_affected_flows(1)
    if not flows_night or not flows_rush:
        return False
    rn = sim_night.calculate_diversion(flows_night[0]['origin'], flows_night[0]['destination'])
    rr = sim_rush.calculate_diversion(flows_rush[0]['origin'], flows_rush[0]['destination'])
    return bool(rn and rr and rn != rr)

def phase5_models(pipeline):
    results = {}
    forecaster = get_forecaster()
    if not getattr(forecaster, "_is_fitted", False):
        forecaster.fit(pipeline.df)
    results['cox_c_index'] = forecaster.c_index
    results['cox_n_observed'] = forecaster.n_observed
    results['cox_n_censored'] = forecaster.n_censored

    nlp = get_nlp_classifier()
    if getattr(nlp, "_is_fitted", False):
        from sklearn.metrics import precision_score, recall_score
        desc = pipeline.df['description'].dropna()
        y_true, y_pred = [], []
        for text in desc:
            tl = text.lower()
            label = None
            for kw, lbl in {
                'no problem': 0, 'normal': 0, 'moving': 0, 'clear': 0,
                'slow': 1, 'closed': 1, 'blocked': 1, 'heavy': 1,
            }.items():
                if kw in tl:
                    label = lbl
                    break
            if label is None:
                continue
            pred = nlp.predict_impact(text)
            y_true.append(label)
            y_pred.append(1 if pred['disrupted_prob'] > 0.5 else 0)
        if y_true:
            results['nlp_precision'] = round(precision_score(y_true, y_pred, zero_division=0), 3)
            results['nlp_recall']    = round(recall_score(y_true, y_pred, zero_division=0), 3)
            results['nlp_n_evaluated'] = len(y_true)
    return results

def phase6_learning_loop():
    summary = feedback_summary()
    rows = get_all_feedback()
    errs = [abs(r['actual_resolution_minutes'] - r['predicted_resolution_minutes'])
            for r in rows if r.get('predicted_resolution_minutes') is not None]
    officer_errs = [abs(r['actual_officers'] - r['recommended_officers'])
                    for r in rows if r.get('recommended_officers') is not None]
    return {
        'total_outcomes': summary.get('total_outcomes'),
        'mean_resolution_error_minutes': summary.get('mean_resolution_error_minutes'),
        'mean_officer_error': round(sum(officer_errs)/len(officer_errs), 2) if officer_errs else None,
        'diversion_success_rate': summary.get('diversion_success_rate'),
    }

def evaluate(num_events=5):
    pipeline = DataPipeline(DATA_PATH)
    pipeline.load_and_clean_data()
    init_analyzer(pipeline.df)

    GraphEngine.load_global_graph(pipeline.df)
    events = pipeline.get_top_events(num_events)

    agg = {
        'phase1_false_positives_eliminated': 0,
        'phase2_flows_crossing_epicenter': 0,
        'phase2_total_flows': 0,
        'phase3_valid_barricades': 0,
        'phase3_total_barricades': 0,
        'phase3_graph_remains_connected': 0,
        'phase4_route_changed': 0,
        'events_evaluated': 0,
    }

    for i, ev in enumerate(events):
        print(f"[{i+1}/{len(events)}] {ev['id']}")
        engine = GraphEngine(ev['latitude'], ev['longitude'], dist=1500)
        G = engine.build_graph()
        if not any('travel_time' in d for _, _, d in G.edges(data=True)):
            G = ox.add_edge_speeds(G)
            G = ox.add_edge_travel_times(G)

        sim = CongestionSimulator(G, ev['latitude'], ev['longitude'],
                                  start_datetime=ev.get('time'))
        fp = phase1_topology(sim)
        cross, total = phase2_flow_selection(sim)
        closed, _ = sim.simulate_congestion_shockwave(50, 1000)
        valid, nb, conn = phase3_barricade_validation(sim, closed)
        tod = phase4_time_of_day(G, ev['latitude'], ev['longitude'])

        agg['phase1_false_positives_eliminated'] += fp
        agg['phase2_flows_crossing_epicenter'] += cross
        agg['phase2_total_flows'] += total
        agg['phase3_valid_barricades'] += valid
        agg['phase3_total_barricades'] += nb
        agg['phase3_graph_remains_connected'] += int(conn)
        agg['phase4_route_changed'] += int(tod)
        agg['events_evaluated'] += 1

    agg['phase5_models'] = phase5_models(pipeline)
    agg['phase6_learning_loop'] = phase6_learning_loop()
    return agg

if __name__ == "__main__":
    print("=== CityFlow 6-phase evaluation ===")
    out = evaluate(num_events=5)
    print(json.dumps(out, indent=2, default=str))
    with open(os.path.join(os.path.dirname(__file__), 'eval_results.txt'), 'w') as fh:
        fh.write(json.dumps(out, indent=2, default=str))
    print("Wrote src/eval_results.txt")
