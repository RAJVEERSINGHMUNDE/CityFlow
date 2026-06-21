import networkx as nx
import osmnx as ox
import folium
import random
import datetime

class CongestionSimulator:
    def __init__(self, G: nx.MultiDiGraph, epicenter_lat: float, epicenter_lon: float,
                 start_datetime: str = None, seed: int = None):
        self.G = G.copy()
        self.epicenter_lat = epicenter_lat
        self.epicenter_lon = epicenter_lon
        self.epicenter_node = ox.distance.nearest_nodes(self.G, X=epicenter_lon, Y=epicenter_lat)
        self.start_datetime = start_datetime
        self.time_of_day_label = "Off-Peak"
        self.time_multiplier = 1.0

        # Seed random for deterministic results per event
        _seed = seed if seed is not None else hash((epicenter_lat, epicenter_lon))
        random.seed(_seed)

    def _apply_time_of_day_weights(self):
        """Applies baseline traffic multipliers based on rush hour."""
        if not self.start_datetime:
            return

        try:
            import pandas as pd
            dt = pd.to_datetime(self.start_datetime)
            hour = dt.hour
            if (8 <= hour <= 11) or (17 <= hour <= 20):
                self.time_multiplier = 1.5
                self.time_of_day_label = "Rush Hour"
            elif 22 <= hour or hour <= 5:
                self.time_multiplier = 0.8
                self.time_of_day_label = "Night"
            else:
                self.time_multiplier = 1.0
                self.time_of_day_label = "Off-Peak"

            if self.time_multiplier != 1.0:
                for u, v, k, data in self.G.edges(keys=True, data=True):
                    if 'travel_time' in data:
                        data['travel_time'] *= self.time_multiplier
        except Exception as e:
            print(f"Error applying time weights: {e}")

    def get_arterial_od_pair(self):
        """
        Finds a deterministic Origin-Destination pair using the northernmost
        and southernmost major arterial nodes in the local subgraph.
        This guarantees the two endpoints are geographically separated and
        likely to have a meaningful route through the event epicenter.
        """
        arterial_nodes = []
        for u, v, k, data in self.G.edges(keys=True, data=True):
            hw = data.get('highway', '')
            if isinstance(hw, list):
                hw = hw[0]
            if hw in ['primary', 'secondary', 'trunk', 'motorway', 'tertiary']:
                arterial_nodes.append(u)
                arterial_nodes.append(v)

        arterial_nodes = list(set(arterial_nodes))

        if len(arterial_nodes) < 2:
            nodes = list(self.G.nodes())
            if len(nodes) < 2:
                return self.epicenter_node, self.epicenter_node
            arterial_nodes = nodes

        # Deterministic: pick northernmost vs southernmost node
        # (sorted by latitude = 'y' coordinate in OSMnx)
        arterial_nodes_sorted = sorted(
            arterial_nodes,
            key=lambda n: self.G.nodes[n].get('y', 0)
        )
        origin = arterial_nodes_sorted[0]       # Southernmost
        destination = arterial_nodes_sorted[-1]  # Northernmost

        return origin, destination

    def simulate_congestion_shockwave(self, closure_radius=50, spillover_radius=300):
        """
        Simulates the effect of the event using Topological Congestion
        (Reverse Breadth-First Search) propagating upstream from the epicenter.
        """
        print("Simulating topological congestion shockwave...")
        self._apply_time_of_day_weights()

        closed_edges = []
        spillover_edges = []

        queue = [(self.epicenter_node, 0.0)]
        visited = {self.epicenter_node: 0.0}

        while queue:
            current_node, current_dist = queue.pop(0)

            for u, v, k, data in self.G.in_edges(current_node, keys=True, data=True):
                edge_length = data.get('length', 10.0)
                new_dist = current_dist + edge_length

                if new_dist <= spillover_radius:
                    if new_dist <= closure_radius:
                        data['travel_time'] = data.get('travel_time', 10) * 100
                        if (u, v) not in closed_edges:
                            closed_edges.append((u, v))
                    else:
                        data['travel_time'] = data.get('travel_time', 10) * 5
                        if (u, v) not in spillover_edges:
                            spillover_edges.append((u, v))

                    if u not in visited or new_dist < visited[u]:
                        visited[u] = new_dist
                        queue.append((u, new_dist))

        return set(closed_edges), set(spillover_edges)

    def calculate_diversion(self, origin, destination):
        try:
            route = nx.shortest_path(self.G, origin, destination, weight='travel_time')
            return route
        except nx.NetworkXNoPath:
            print("No viable diversion route found!")
            return None

    def get_delay_estimate(self, normal_route: list, diverted_route: list) -> float:
        """
        Computes the added delay in minutes between the normal and diverted routes.
        Uses the pre-congestion travel times for the normal route and
        the post-congestion (modified) graph for the diverted route.
        Returns added delay in minutes (can be negative if diversion is faster).
        """
        def route_travel_time(route):
            total = 0.0
            for i in range(len(route) - 1):
                u, v = route[i], route[i + 1]
                edge_data = self.G.get_edge_data(u, v)
                if edge_data:
                    # MultiDiGraph: get minimum travel_time across parallel edges
                    times = [d.get('travel_time', 30) for d in edge_data.values()]
                    total += min(times)
                else:
                    total += 30  # fallback 30 seconds
            return total

        if not normal_route or not diverted_route:
            return 0.0

        normal_time = route_travel_time(normal_route)
        diverted_time = route_travel_time(diverted_route)
        added_seconds = diverted_time - normal_time
        return round(added_seconds / 60, 1)

    def get_route_distance_km(self, route: list) -> float:
        """Returns the total road distance of a route in kilometres."""
        if not route or len(route) < 2:
            return 0.0
        total_length = 0.0
        for i in range(len(route) - 1):
            u, v = route[i], route[i + 1]
            edge_data = self.G.get_edge_data(u, v)
            if edge_data:
                lengths = [d.get('length', 0) for d in edge_data.values()]
                total_length += min(lengths)
        return round(total_length / 1000, 2)

    def recommend_barricades(self, closed_edges):
        barricade_nodes = set()
        closed_set = set(closed_edges)

        for u, v in closed_edges:
            current_node = u
            visited = {current_node}

            while current_node:
                outgoing = list(self.G.out_edges(current_node))

                # Check if this intersection allows for continuous flow diversion
                has_diversion = False
                for out_u, out_v in outgoing:
                    if (out_u, out_v) not in closed_set:
                        has_diversion = True
                        break

                if has_diversion:
                    barricade_nodes.add(current_node)
                    break
                else:
                    # Intersection is a trap. Traverse further upstream.
                    incoming = list(self.G.in_edges(current_node))
                    if not incoming:
                        barricade_nodes.add(current_node)
                        break

                    moved = False
                    for in_u, in_v in incoming:
                        if in_u not in visited:
                            current_node = in_u
                            visited.add(in_u)
                            moved = True
                            break

                    if not moved:
                        barricade_nodes.add(current_node)
                        break

        return list(barricade_nodes)

    def visualize(self, origin, destination, normal_route, diverted_route, barricades,
                  output_file="diversion_plan.html"):
        print(f"Generating visualization at {output_file}...")
        m = folium.Map(location=[self.epicenter_lat, self.epicenter_lon],
                       zoom_start=14, tiles='CartoDB dark_matter')

        def get_route_coords(route):
            return [[self.G.nodes[n]['y'], self.G.nodes[n]['x']] for n in route]

        if normal_route and len(normal_route) > 1:
            folium.PolyLine(
                get_route_coords(normal_route),
                color='red', weight=5, opacity=0.5,
                tooltip="Original Route (Blocked)"
            ).add_to(m)

        if diverted_route and len(diverted_route) > 1:
            folium.PolyLine(
                get_route_coords(diverted_route),
                color='cyan', weight=6,
                tooltip="AI-Recommended Diversion Route"
            ).add_to(m)

        folium.Marker(
            location=[self.epicenter_lat, self.epicenter_lon],
            popup='Event Epicenter (Road Closed)',
            icon=folium.Icon(color='black', icon='info-sign')
        ).add_to(m)

        for b_node in barricades:
            lat = self.G.nodes[b_node]['y']
            lon = self.G.nodes[b_node]['x']
            folium.CircleMarker(
                location=[lat, lon],
                radius=6,
                color='orange',
                fill=True,
                fill_color='orange',
                popup='Recommended Barricade'
            ).add_to(m)

        m.save(output_file)
        print("Visualization complete.")
