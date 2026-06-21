from collections import deque

import folium
import networkx as nx
import osmnx as ox


MAJOR_ROADS = {'primary', 'secondary', 'trunk', 'motorway', 'tertiary'}


class CongestionSimulator:
    def __init__(self, G: nx.MultiDiGraph, epicenter_lat: float, epicenter_lon: float,
                 start_datetime: str = None, seed: int = None):
        del seed  # Kept for backwards-compatible callers; analysis is deterministic.
        self.base_G = G.copy()
        self.G = G.copy()
        self.epicenter_lat = epicenter_lat
        self.epicenter_lon = epicenter_lon
        self.epicenter_node = ox.distance.nearest_nodes(
            self.G, X=epicenter_lon, Y=epicenter_lat
        )
        self.start_datetime = start_datetime
        self.time_of_day_label = 'Off-Peak'
        self.time_multiplier = 1.0

    @staticmethod
    def _highway_value(data):
        highway = data.get('highway', '')
        return highway[0] if isinstance(highway, list) and highway else highway

    def _apply_time_of_day_weights(self):
        """Apply the same baseline traffic factor to reference and impact graphs."""
        if not self.start_datetime:
            return
        try:
            import pandas as pd
            hour = pd.to_datetime(self.start_datetime).hour
            if 8 <= hour <= 11 or 17 <= hour <= 20:
                self.time_multiplier = 1.5
                self.time_of_day_label = 'Rush Hour'
            elif hour >= 22 or hour <= 5:
                self.time_multiplier = 0.8
                self.time_of_day_label = 'Night'
            else:
                self.time_multiplier = 1.0

            for graph in (self.base_G, self.G):
                for _, _, _, data in graph.edges(keys=True, data=True):
                    if 'travel_time' in data:
                        data['travel_time'] = float(data['travel_time']) * self.time_multiplier
        except (TypeError, ValueError) as exc:
            print(f'Error applying time weights: {exc}')

    def get_arterial_od_pair(self):
        """Legacy single-flow API; returns the first event-affected flow."""
        flows = self.find_affected_flows(max_flows=1)
        if flows:
            return flows[0]['origin'], flows[0]['destination']
        nodes = list(self.G.nodes)
        return (nodes[0], nodes[-1]) if len(nodes) > 1 else (self.epicenter_node,) * 2

    def _boundary_arterial_nodes(self, incoming=True):
        candidates = set()
        for u, v, _, data in self.base_G.edges(keys=True, data=True):
            if self._highway_value(data) in MAJOR_ROADS:
                candidates.add(u if incoming else v)
        if not candidates:
            candidates = set(self.base_G.nodes)

        search_graph = self.base_G.reverse(copy=False) if incoming else self.base_G
        distances = nx.single_source_dijkstra_path_length(
            search_graph, self.epicenter_node, cutoff=3000, weight='length'
        )
        ranked = []
        for node in candidates:
            distance = distances.get(node)
            if distance is None:
                continue
            # Endpoints should be well outside the spillover zone.
            if distance >= 450:
                ranked.append((float(distance), node))
        ranked.sort(reverse=True)
        return [node for _, node in ranked[:12]]

    def find_affected_flows(self, max_flows=3):
        """Find arterial OD movements whose baseline route passes through the event."""
        origins = self._boundary_arterial_nodes(incoming=True)
        destinations = self._boundary_arterial_nodes(incoming=False)
        candidates = []

        for origin in origins:
            try:
                to_event = nx.shortest_path(
                    self.base_G, origin, self.epicenter_node, weight='travel_time'
                )
            except (nx.NetworkXNoPath, nx.NodeNotFound):
                continue
            for destination in destinations:
                if destination == origin:
                    continue
                try:
                    from_event = nx.shortest_path(
                        self.base_G, self.epicenter_node, destination, weight='travel_time'
                    )
                except (nx.NetworkXNoPath, nx.NodeNotFound):
                    continue
                route = to_event + from_event[1:]
                distance = self.get_route_distance_km(route, graph=self.base_G)
                if distance >= 0.8:
                    candidates.append((distance, origin, destination, route))

        selected = []
        used_origins = set()
        used_destinations = set()
        for distance, origin, destination, route in sorted(candidates, reverse=True):
            if origin in used_origins or destination in used_destinations:
                continue
            selected.append({
                'flow_id': f'flow-{len(selected) + 1}',
                'origin': origin,
                'destination': destination,
                'normal_route': route,
                'normal_distance_km': distance,
            })
            used_origins.add(origin)
            used_destinations.add(destination)
            if len(selected) >= max_flows:
                break
        return selected

    def simulate_congestion_shockwave(self, closure_radius=50, spillover_radius=300):
        """Propagate event impact upstream along connected road distance."""
        print('Simulating topological congestion shockwave...')
        self._apply_time_of_day_weights()
        closed_edges = set()
        spillover_edges = set()
        queue = deque([(self.epicenter_node, 0.0)])
        visited = {self.epicenter_node: 0.0}

        while queue:
            current_node, current_dist = queue.popleft()
            for u, v, _, data in self.G.in_edges(current_node, keys=True, data=True):
                new_dist = current_dist + float(data.get('length', 10.0))
                if new_dist > spillover_radius:
                    continue
                if new_dist <= closure_radius:
                    data['travel_time'] = float(data.get('travel_time', 10)) * 100
                    closed_edges.add((u, v))
                else:
                    data['travel_time'] = float(data.get('travel_time', 10)) * 5
                    spillover_edges.add((u, v))
                if new_dist < visited.get(u, float('inf')):
                    visited[u] = new_dist
                    queue.append((u, new_dist))
        return closed_edges, spillover_edges

    @staticmethod
    def _remove_edges(graph, edges):
        safe_graph = graph.copy()
        for u, v in edges:
            if safe_graph.has_edge(u, v):
                safe_graph.remove_edges_from((u, v, key) for key in list(safe_graph[u][v]))
        return safe_graph

    def calculate_diversion(self, origin, destination, closed_edges=None):
        graph = self._remove_edges(self.G, closed_edges or set())
        try:
            return nx.shortest_path(graph, origin, destination, weight='travel_time')
        except (nx.NetworkXNoPath, nx.NodeNotFound):
            return None

    @staticmethod
    def route_travel_time(route, graph):
        if not route or len(route) < 2:
            return 0.0
        total = 0.0
        for u, v in zip(route[:-1], route[1:]):
            edge_data = graph.get_edge_data(u, v)
            if not edge_data:
                return float('inf')
            total += min(float(data.get('travel_time', 30)) for data in edge_data.values())
        return total

    def evaluate_interventions(self, flows, closed_edges):
        """Compare do-nothing and closure-avoiding intervention for each flow."""
        results = []
        for flow in flows:
            normal_route = flow['normal_route']
            diverted_route = self.calculate_diversion(
                flow['origin'], flow['destination'], closed_edges
            )
            baseline_sec = self.route_travel_time(normal_route, self.base_G)
            without_sec = self.route_travel_time(normal_route, self.G)
            diverted_sec = self.route_travel_time(diverted_route, self.G)
            avoids_closure = bool(diverted_route) and not any(
                (u, v) in closed_edges for u, v in zip(diverted_route[:-1], diverted_route[1:])
            )
            saved_sec = without_sec - diverted_sec if diverted_route else 0.0
            valid = avoids_closure and saved_sec > 0
            results.append({
                **flow,
                'diverted_route': diverted_route,
                'baseline_minutes': round(baseline_sec / 60, 1),
                'without_intervention_minutes': round(without_sec / 60, 1),
                'with_intervention_minutes': round(diverted_sec / 60, 1) if diverted_route else None,
                'time_saved_minutes': round(max(0.0, saved_sec) / 60, 1),
                'delay_reduction_pct': round(max(0.0, saved_sec) / without_sec * 100, 1)
                if without_sec and without_sec != float('inf') else 0.0,
                'diversion_distance_km': self.get_route_distance_km(diverted_route),
                'avoids_closure': avoids_closure,
                'valid_intervention': valid,
                'reason': 'Avoids closure and reduces travel time' if valid else
                          'No beneficial closure-avoiding route found',
            })
        return results

    def get_delay_estimate(self, normal_route, diverted_route):
        normal_time = self.route_travel_time(normal_route, self.G)
        diverted_time = self.route_travel_time(diverted_route, self.G)
        if not normal_route or not diverted_route:
            return 0.0
        return round((diverted_time - normal_time) / 60, 1)

    def get_route_distance_km(self, route, graph=None):
        graph = graph or self.G
        if not route or len(route) < 2:
            return 0.0
        total = 0.0
        for u, v in zip(route[:-1], route[1:]):
            edge_data = graph.get_edge_data(u, v)
            if edge_data:
                total += min(float(data.get('length', 0)) for data in edge_data.values())
        return round(total / 1000, 2)

    def recommend_barricades(self, closed_edges):
        """Return a minimal set of upstream intersections with a viable exit."""
        closed_set = set(closed_edges)
        barricades = set()
        for u, _ in closed_set:
            current = u
            visited = set()
            while current not in visited:
                visited.add(current)
                safe_exits = [
                    v for _, v in self.G.out_edges(current)
                    if (current, v) not in closed_set and v != self.epicenter_node
                ]
                if safe_exits:
                    barricades.add(current)
                    break
                upstream = [node for node, _ in self.G.in_edges(current) if node not in visited]
                if not upstream:
                    break
                current = upstream[0]
        return sorted(barricades, key=str)

    def validate_barricades(self, barricades, closed_edges):
        details = []
        closed_set = set(closed_edges)
        for node in barricades:
            blocked_entries = [
                [u, v] for u, v in self.G.out_edges(node) if (u, v) in closed_set
            ]
            alternate_exits = [
                v for _, v in self.G.out_edges(node)
                if (node, v) not in closed_set and v != self.epicenter_node
            ]
            valid = bool(blocked_entries and alternate_exits)
            details.append({
                'node_id': node,
                'lat': round(float(self.G.nodes[node].get('y', 0)), 5),
                'lon': round(float(self.G.nodes[node].get('x', 0)), 5),
                'blocked_entries': blocked_entries,
                'alternate_exit_count': len(alternate_exits),
                'valid': valid,
                'reason': f'Blocks {len(blocked_entries)} closure entry and offers '
                          f'{len(alternate_exits)} alternate exit(s)' if valid else
                          'Rejected: no closure entry or viable upstream exit',
            })
        return details

    def visualize_flows(self, flow_results, barricades, output_file):
        print(f'Generating visualization at {output_file}...')
        m = folium.Map(
            location=[self.epicenter_lat, self.epicenter_lon],
            zoom_start=14,
            tiles='CartoDB dark_matter',
        )

        def coords(route):
            return [[self.G.nodes[node]['y'], self.G.nodes[node]['x']] for node in route]

        colors = ['cyan', 'lime', 'magenta']
        for index, flow in enumerate(flow_results):
            if flow.get('normal_route'):
                folium.PolyLine(
                    coords(flow['normal_route']), color='red', weight=4, opacity=0.35,
                    tooltip=f"{flow['flow_id']} without intervention",
                ).add_to(m)
            if flow.get('valid_intervention') and flow.get('diverted_route'):
                folium.PolyLine(
                    coords(flow['diverted_route']), color=colors[index % len(colors)],
                    weight=6,
                    tooltip=f"{flow['flow_id']}: saves {flow['time_saved_minutes']} min",
                ).add_to(m)

        folium.Marker(
            [self.epicenter_lat, self.epicenter_lon],
            popup='Event epicenter and closure zone',
            icon=folium.Icon(color='red', icon='warning-sign'),
        ).add_to(m)
        for node in barricades:
            folium.CircleMarker(
                [self.G.nodes[node]['y'], self.G.nodes[node]['x']], radius=6,
                color='orange', fill=True, fill_color='orange',
                popup='Validated upstream barricade candidate',
            ).add_to(m)
        m.save(output_file)

    def visualize(self, origin, destination, normal_route, diverted_route, barricades,
                  output_file='diversion_plan.html'):
        """Backwards-compatible single-flow visualizer."""
        del origin, destination
        self.visualize_flows([{
            'flow_id': 'flow-1',
            'normal_route': normal_route,
            'diverted_route': diverted_route,
            'valid_intervention': bool(diverted_route),
            'time_saved_minutes': 0,
        }], barricades, output_file)
