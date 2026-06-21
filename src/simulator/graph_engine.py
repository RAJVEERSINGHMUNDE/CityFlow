import osmnx as ox
import networkx as nx
import os
import threading

# ── OSMnx settings ────────────────────────────────────────────────────────────
ox.settings.timeout = 300          # 5-minute timeout per HTTP request
ox.settings.max_query_area_size = 50_000_000_000  # allow larger queries without subdivision

CACHE_PATH = os.path.join(os.path.dirname(__file__), "cache", "bengaluru_global.graphml")

# Threading event so app.py can wait on / check graph readiness
graph_ready_event = threading.Event()


class GraphEngine:
    GLOBAL_GRAPH = None
    _lock = threading.Lock()

    @classmethod
    def load_global_graph(cls, dataset_df=None):
        """
        Loads (or downloads + caches) the Bengaluru road network graph.
        Always uses graph_from_place so OSMnx handles Overpass pagination safely.
        Thread-safe: safe to call from a background thread.
        """
        with cls._lock:
            if cls.GLOBAL_GRAPH is not None:
                graph_ready_event.set()
                return cls.GLOBAL_GRAPH

            if os.path.exists(CACHE_PATH):
                print(f"[GraphEngine] Loading cached global graph from {CACHE_PATH}...")
                cls.GLOBAL_GRAPH = ox.load_graphml(CACHE_PATH)

                # Ensure numeric types (graphml serialises everything as strings)
                for u, v, k, data in cls.GLOBAL_GRAPH.edges(keys=True, data=True):
                    if 'travel_time' in data:
                        data['travel_time'] = float(data['travel_time'])
                    if 'length' in data:
                        data['length'] = float(data['length'])
                for n, data in cls.GLOBAL_GRAPH.nodes(data=True):
                    data['x'] = float(data['x'])
                    data['y'] = float(data['y'])

                print(f"[GraphEngine] Graph ready: "
                      f"{len(cls.GLOBAL_GRAPH.nodes):,} nodes, "
                      f"{len(cls.GLOBAL_GRAPH.edges):,} edges.")
            else:
                os.makedirs(os.path.dirname(CACHE_PATH), exist_ok=True)
                print("[GraphEngine] Cache not found. Downloading Bengaluru road network...")
                print("[GraphEngine] Using graph_from_place — OSMnx will paginate automatically.")

                # graph_from_place is the most reliable method:
                # - Uses the Nominatim-resolved polygon boundary of Bengaluru
                # - OSMnx splits it into safe sub-queries automatically
                # - Much less likely to hit connection resets than raw bbox queries
                cls.GLOBAL_GRAPH = ox.graph_from_place(
                    'Bengaluru, Karnataka, India',
                    network_type='drive',
                    retain_all=False,
                    simplify=True,
                )

                cls.GLOBAL_GRAPH = ox.add_edge_speeds(cls.GLOBAL_GRAPH)
                cls.GLOBAL_GRAPH = ox.add_edge_travel_times(cls.GLOBAL_GRAPH)

                print(f"[GraphEngine] Downloaded: "
                      f"{len(cls.GLOBAL_GRAPH.nodes):,} nodes, "
                      f"{len(cls.GLOBAL_GRAPH.edges):,} edges.")
                print(f"[GraphEngine] Saving to cache at {CACHE_PATH}...")
                ox.save_graphml(cls.GLOBAL_GRAPH, CACHE_PATH)
                print("[GraphEngine] Graph cached successfully.")

            graph_ready_event.set()
            return cls.GLOBAL_GRAPH

    # ── Instance methods ───────────────────────────────────────────────────────

    def __init__(self, lat: float, lon: float, dist: int = 1500):
        self.lat = lat
        self.lon = lon
        self.dist = dist
        self.G = None

    def build_graph(self) -> nx.MultiDiGraph:
        """Extracts a local subgraph from the global in-memory graph."""
        if GraphEngine.GLOBAL_GRAPH is None:
            raise ValueError("Global graph not loaded. Call GraphEngine.load_global_graph() first.")

        print(f"[GraphEngine] Extracting sub-graph around ({self.lat}, {self.lon}) within {self.dist}m...")
        nearest_node = ox.distance.nearest_nodes(GraphEngine.GLOBAL_GRAPH, X=self.lon, Y=self.lat)

        # ego_graph extracts all nodes reachable within `dist` metres along edges
        self.G = nx.ego_graph(
            GraphEngine.GLOBAL_GRAPH,
            nearest_node,
            radius=self.dist,
            distance='length',
            undirected=True,
        )

        print(f"[GraphEngine] Sub-graph: {len(self.G.nodes):,} nodes, {len(self.G.edges):,} edges.")
        return self.G

    def get_nearest_node(self, target_lat: float, target_lon: float):
        if self.G is None:
            raise ValueError("Graph not built. Call build_graph() first.")
        return ox.distance.nearest_nodes(self.G, X=target_lon, Y=target_lat)


# ── Standalone download script ─────────────────────────────────────────────────
if __name__ == "__main__":
    print("=== Standalone Bengaluru Graph Downloader ===")
    GraphEngine.load_global_graph()
    print("=== Done ===")
