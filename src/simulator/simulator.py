from collections import deque

import folium
import networkx as nx
import osmnx as ox


MAJOR_ROADS = {'primary', 'secondary', 'trunk', 'motorway', 'tertiary'}


class CongestionSimulator:
    # Sensitivity factor per highway class for differential time-of-day weighting
    _CLASS_SENSITIVITY = {
        'motorway': 1.6,
        'trunk': 1.5,
        'primary': 1.4,
        'secondary': 1.2,
        'tertiary': 1.1,
        'residential': 0.7,
        'living_street': 0.6,
        'service': 0.6,
        'unclassified': 0.9,
    }
    def __init__(self, G: nx.MultiDiGraph, epicenter_lat: float, epicenter_lon: float,
                 start_datetime: str = None, seed: int = None, event_type: str = 'unplanned'):
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
        self.event_type = event_type
        self.planned_mode = (event_type == 'planned')

    @staticmethod
    def _highway_value(data):
        highway = data.get('highway', '')
        return highway[0] if isinstance(highway, list) and highway else highway

    def _apply_time_of_day_weights(self):
        """Apply per-road-class, hour-calibrated travel-time multipliers."""
        if not self.start_datetime:
            return
        try:
            import pandas as pd
            hour = pd.to_datetime(self.start_datetime).hour
            if 8 <= hour <= 11 or 17 <= hour <= 20:
                self.time_of_day_label = 'Rush Hour'
            elif hour >= 22 or hour <= 5:
                self.time_of_day_label = 'Night'
            else:
                self.time_of_day_label = 'Off-Peak'
        except (TypeError, ValueError) as exc:
            print(f'Error applying time weights: {exc}')
            return

        # Retrieve calibrated hourly multiplier from HotspotAnalyzer
        hourly_mult = 1.0
        try:
            # Import works when src/simulator is on sys.path (app.py context) OR
            # when src namespace is available (test/repo-root context).
            try:
                from src.simulator.hotspot_analyzer import get_analyzer
            except ImportError:
                from hotspot_analyzer import get_analyzer
            analyzer = get_analyzer()
            if analyzer is not None:
                hourly_mult = analyzer.get_hourly_multiplier(hour)
        except Exception:
            pass

        # Store the multiplier for UI labeling
        self.time_multiplier = float(hourly_mult)

        for graph in (self.base_G, self.G):
            for _, _, _, data in graph.edges(keys=True, data=True):
                if 'travel_time' not in data:
                    continue
                hw = self._highway_value(data)
                sensitivity = self._CLASS_SENSITIVITY.get(hw, 1.0)
                multiplier = max(0.1, 1.0 + (hourly_mult - 1.0) * sensitivity)
                data['travel_time'] = float(data['travel_time']) * multiplier

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
                    # Volume proxy: average road capacity along the route
                    cap_score = self._route_capacity_score(route)
                    candidates.append((distance * cap_score, distance, origin, destination, route))

        selected = []
        used_origins = set()
        used_destinations = set()
        for composite, distance, origin, destination, route in sorted(candidates, reverse=True):
            if origin in used_origins or destination in used_destinations:
                continue
            # Derive capacity score from composite key (avoid division by zero)
            cap_score = composite / distance if distance != 0 else 1.0
            selected.append({
                'flow_id': f'flow-{len(selected) + 1}',
                'origin': origin,
                'destination': destination,
                'normal_route': route,
                'normal_distance_km': distance,
                'capacity_score': float(cap_score),
            })
            used_origins.add(origin)
            used_destinations.add(destination)
            if len(selected) >= max_flows:
                break
        return selected

    @staticmethod
    def _get_base_capacity_and_volume(highway_type):
        """Estimate baseline capacity and volume (vehicles per hour) from road type."""
        capacities = {
            'motorway': (2000, 1800),
            'trunk': (1800, 1500),
            'primary': (1200, 1000),
            'secondary': (1000, 800),
            'tertiary': (800, 600),
            'residential': (400, 200),
            'unclassified': (400, 200)
        }
        return capacities.get(highway_type, (500, 250))

    def _route_capacity_score(self, route) -> float:
        """Average per‑edge capacity (veh/h) along the route — a volume proxy."""
        if not route or len(route) < 2:
            return 1.0
        caps = []
        for u, v in zip(route[:-1], route[1:]):
            edge_data = self.base_G.get_edge_data(u, v)
            if not edge_data:
                continue
            # edge_data may contain multiple parallel edges; take first
            first_edge = next(iter(edge_data.values()))
            hw = self._highway_value(first_edge)
            cap, _ = self._get_base_capacity_and_volume(hw)
            caps.append(cap)
        return float(sum(caps) / len(caps)) if caps else 1.0



    def simulate_congestion_shockwave(self, closure_radius=50, spillover_radius=1000, capacity_factor=1.0, pre_closed_edges=None):
        """Propagate event impact upstream using topological capacity decay and BPR function."""
        print('Simulating BPR topological congestion shockwave...')
        self._apply_time_of_day_weights()
        closed_edges = set()
        spillover_edges = set()
        
        # 1. Base Assignment
        for u, v, k, data in self.G.edges(keys=True, data=True):
            hw_type = self._highway_value(data)
            cap, vol = self._get_base_capacity_and_volume(hw_type)
            data['capacity'] = cap * capacity_factor
            data['volume'] = vol * self.time_multiplier
            data['t0'] = float(data.get('travel_time', 10.0))
            
        if pre_closed_edges:
            for u, v in pre_closed_edges:
                if self.G.has_edge(u, v):
                    for k in self.G[u][v]:
                        self.G[u][v][k]['capacity'] *= 0.05
                        closed_edges.add((u, v))
        
        # 2. Capacity Decay (Queue Spillback)
        queue = deque([(self.epicenter_node, 0.0)])
        visited = {self.epicenter_node: 0.0}
        
        while queue:
            current_node, current_dist = queue.popleft()
            for u, v, k, data in self.G.in_edges(current_node, keys=True, data=True):
                edge_len = float(data.get('length', 10.0))
                new_dist = current_dist + edge_len
                
                if new_dist > spillover_radius:
                    continue
                    
                if new_dist <= closure_radius:
                    # Effectively closed: capacity drops to near zero
                    data['capacity'] *= 0.05
                    closed_edges.add((u, v))
                else:
                    # Upstream bottleneck decay: capacity recovers linearly with distance
                    decay_factor = min(1.0, 0.1 + 0.9 * (new_dist / spillover_radius))
                    data['capacity'] *= decay_factor
                    spillover_edges.add((u, v))
                    
                if new_dist < visited.get(u, float('inf')):
                    visited[u] = new_dist
                    queue.append((u, new_dist))

        # 3. BPR Travel Time Calculation
        alpha = 0.15
        beta = 4.0
        for u, v, k, data in self.G.edges(keys=True, data=True):
            if 't0' in data:
                c = max(1.0, data['capacity'])
                v_flow = data['volume']
                data['travel_time'] = data['t0'] * (1.0 + alpha * (v_flow / c)**beta)

        return closed_edges, spillover_edges

    @staticmethod
    def derive_spillover_radius(expected_attendance: int, base: int = 1000) -> int:
        # 0 attendees -> base (1000m, unplanned default)
        # 1,000 -> ~1.1 * base
        # 10,000 -> ~1.5 * base
        # 100,000 -> ~2.0 * base (capped)
        if not expected_attendance or expected_attendance <= 0:
            return base
        import math
        scale = 1.0 + 0.5 * (math.log10(max(10, expected_attendance)) - 1) / 3
        scale = min(2.0, max(1.0, scale))
        return int(base * scale)

    @staticmethod
    def _remove_edges(graph, edges):
        safe_graph = graph.copy()
        for u, v in edges:
            if safe_graph.has_edge(u, v):
                safe_graph.remove_edges_from((u, v, key) for key in list(safe_graph[u][v]))
        return safe_graph

    def calculate_diversion(self, origin, destination, closed_edges=None, police_deployed=False):
        graph = self.G.copy()
        edges_to_close = closed_edges or set()
        
        # Implement Barricade Compliance Factor
        # If police are not deployed, compliance is 40% -> edge remains but travel time is penalized.
        # If police are deployed, compliance is 95% -> edge is effectively removed.
        for u, v in edges_to_close:
            if graph.has_edge(u, v):
                if police_deployed:
                    graph.remove_edges_from((u, v, key) for key in list(graph[u][v]))
                else:
                    for key in list(graph[u][v]):
                        graph[u][v][key]['travel_time'] *= 2.5 # 1/0.4 non-compliance penalty

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
        """Compare do-nothing and closure-avoiding interventions, with and without police deployment.

        For each flow we compute two diversion routes:
          * diverted_no_police  – police_deployed=False
          * diverted_with_police – police_deployed=True
        The primary diverted_route used for downstream metrics is the with‑police route
        (fallback to the no‑police route if None). Time saved is reported for the
        with‑police scenario (integrated compliance benefit). Additional keys report
        the separate savings and the incremental benefit of police compliance.
        """
        results = []
        for flow in flows:
            normal_route = flow['normal_route']
            # Baseline travel times
            baseline_sec = self.route_travel_time(normal_route, self.base_G)
            without_sec = self.route_travel_time(normal_route, self.G)

            # Diversion without police (compliance 40% → 2.5× travel time penalty)
            diverted_no = self.calculate_diversion(
                flow['origin'], flow['destination'], closed_edges, police_deployed=False
            )
            diverted_no_sec = self.route_travel_time(diverted_no, self.G) if diverted_no else 0.0

            # Diversion with police (compliance 95% → edge effectively removed)
            diverted_yes = self.calculate_diversion(
                flow['origin'], flow['destination'], closed_edges, police_deployed=True
            )
            diverted_yes_sec = self.route_travel_time(diverted_yes, self.G) if diverted_yes else 0.0

            # Primary diverted route for reporting – prefer police‑deployed version
            primary_diverted_route = diverted_yes if diverted_yes is not None else diverted_no

            # Determine whether the chosen diversion avoids the closed edges
            avoids_closure = bool(primary_diverted_route) and not any(
                (u, v) in closed_edges for u, v in zip(primary_diverted_route[:-1], primary_diverted_route[1:])
            )

            # Compute time saved for the two scenarios
            saved_no_sec = without_sec - diverted_no_sec if diverted_no else 0.0
            saved_yes_sec = without_sec - diverted_yes_sec if diverted_yes else 0.0

            # Integrated benefit uses the police‑deployed scenario
            time_saved_no = max(0.0, saved_no_sec)
            time_saved_yes = max(0.0, saved_yes_sec)
            police_benefit_sec = time_saved_yes - time_saved_no

            valid = avoids_closure and time_saved_yes > 0

            results.append({
                **flow,
                'diverted_route': primary_diverted_route,
                'baseline_minutes': round(baseline_sec / 60, 1),
                'without_intervention_minutes': round(without_sec / 60, 1),
                'with_intervention_minutes': round(diverted_yes_sec / 60, 1) if diverted_yes else None,
                'time_saved_minutes': round(time_saved_yes / 60, 1),
                'time_saved_no_police_minutes': round(time_saved_no / 60, 1),
                'time_saved_with_police_minutes': round(time_saved_yes / 60, 1),
                'police_compliance_benefit_minutes': round(max(0.0, police_benefit_sec) / 60, 1),
                'delay_reduction_pct': round(time_saved_yes / without_sec * 100, 1)
                if without_sec and without_sec != float('inf') else 0.0,
                'diversion_distance_km': self.get_route_distance_km(primary_diverted_route),
                'avoids_closure': avoids_closure,
                'valid_intervention': valid,
                'reason': 'Avoids closure and reduces travel time' if valid else
                          'No beneficial closure-avoiding route found',
            })
        return results

    def synthesize_diversion_plan(self, flow_results, barricade_validation,
                                  manpower_plan, closed_edges):
        """Bind barricades -> affected flows -> officers into one plan."""
        closed_set = set(closed_edges)
        # Map each barricade to the flows it protects (flows whose baseline
        # route passes through an edge this barricade blocks).
        plan_entries = []
        for bv in barricade_validation:
            if not bv['valid']:
                continue
            node = bv['node_id']
            blocked = {(u, v) for u, v in self.G.out_edges(node) if (u, v) in closed_set}
            protected_flows = []
            for f in flow_results:
                if not f.get('valid_intervention'):
                    continue
                route_edges = set(zip(f['normal_route'][:-1], f['normal_route'][1:]))
                if route_edges & blocked:
                    protected_flows.append({
                        'flow_id': f['flow_id'],
                        'diversion_route_node_count': len(f.get('diverted_route') or []),
                        'time_saved_minutes': f['time_saved_minutes'],
                    })
            # Officer allocation for this barricade
            officers = next(
                (b['officers_assigned'] for b in manpower_plan.get('barricade_details', [])
                 if b['node_id'] == node),
                manpower_plan.get('officers_per_barricade', 0)
            )
            plan_entries.append({
                'barricade_node': node,
                'lat': bv['lat'],
                'lon': bv['lon'],
                'blocks_edges': [[u, v] for u, v in blocked],
                'protects_flows': protected_flows,
                'officers_assigned': officers,
            })
        return {
            'plan_summary': {
                'total_barricades':   len(plan_entries),
                'total_officers':     manpower_plan.get('total_officers', 0),
                'total_flows_protected': sum(1 for f in flow_results if f.get('valid_intervention')),
                'total_time_saved_minutes': round(
                    sum(f.get('time_saved_minutes', 0) for f in flow_results
                        if f.get('valid_intervention')), 1),
            },
            'barricade_plan': plan_entries,
        }

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

    def visualize_flows(self, flow_results, barricades, output_file=None):
        if output_file:
            print(f'Generating visualization at {output_file}...')
        else:
            print('Generating visualization in memory...')
            
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
            
        if output_file:
            m.save(output_file)
            return None
        return m.get_root().render()

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
