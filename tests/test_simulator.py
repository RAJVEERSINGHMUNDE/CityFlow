import unittest
from unittest.mock import patch

import networkx as nx

from src.simulator.simulator import CongestionSimulator


def build_test_graph():
    graph = nx.MultiDiGraph()
    coordinates = {
        -2: (0.0, -0.02), -1: (0.0, -0.005), 0: (0.0, 0.0),
        1: (0.0, 0.005), 2: (0.0, 0.02), 3: (0.01, 0.0),
    }
    for node, (y, x) in coordinates.items():
        graph.add_node(node, y=y, x=x)

    def edge(u, v, length, travel_time):
        graph.add_edge(
            u, v, length=length, travel_time=travel_time, highway='primary'
        )

    edge(-2, -1, 500, 30)
    edge(-1, 0, 20, 5)
    edge(0, 1, 20, 5)
    edge(1, 2, 500, 30)
    edge(-1, 3, 300, 20)
    edge(3, 1, 300, 20)
    return graph


def make_simulator():
    with patch('src.simulator.simulator.ox.distance.nearest_nodes', return_value=0):
        return CongestionSimulator(build_test_graph(), 0.0, 0.0)


class SimulatorTests(unittest.TestCase):
    def test_selected_flow_passes_through_event(self):
        simulator = make_simulator()
        flows = simulator.find_affected_flows(max_flows=1)

        self.assertEqual(len(flows), 1)
        self.assertIn(simulator.epicenter_node, flows[0]['normal_route'])
        self.assertGreaterEqual(flows[0]['normal_distance_km'], 0.8)

    def test_intervention_avoids_closure_and_saves_time(self):
        simulator = make_simulator()
        closed, _ = simulator.simulate_congestion_shockwave(50, 300)
        flow = {
            'flow_id': 'flow-1', 'origin': -2, 'destination': 2,
            'normal_route': [-2, -1, 0, 1, 2], 'normal_distance_km': 1.04,
        }
        result = simulator.evaluate_interventions([flow], closed)[0]

        self.assertIn((-1, 0), closed)
        self.assertEqual(result['diverted_route'], [-2, -1, 3, 1, 2])
        self.assertTrue(result['avoids_closure'])
        self.assertTrue(result['valid_intervention'])
        self.assertGreater(result['time_saved_minutes'], 0)

    def test_barricade_has_closure_entry_and_alternate_exit(self):
        simulator = make_simulator()
        closed, _ = simulator.simulate_congestion_shockwave(50, 300)
        barricades = simulator.recommend_barricades(closed)
        validation = simulator.validate_barricades(barricades, closed)

        self.assertIn(-1, barricades)
        self.assertTrue(validation[0]['valid'])
        self.assertGreaterEqual(validation[0]['alternate_exit_count'], 1)


if __name__ == '__main__':
    unittest.main()
