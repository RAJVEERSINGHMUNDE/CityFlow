import os
import sys
import networkx as nx
import osmnx as ox

# Add simulator directory to path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), 'simulator')))

from data_pipeline import DataPipeline
from graph_engine import GraphEngine
from simulator import CongestionSimulator

def evaluate(num_events=5):
    # Load dataset
    DATA_PATH = r"d:\CODE\Python\AIML\CityFlow\dataset\2.csv"
    pipeline = DataPipeline(DATA_PATH)
    pipeline.load_and_clean_data()
    events = pipeline.get_top_events(num_events)
    
    results = {
        "Phase 1: False Positives Eliminated": 0,
        "Phase 2: Total Time Saved (seconds)": 0.0,
        "Phase 3: Successful Barricade Placements": 0,
        "Phase 4: Time-of-Day Detour Changes": 0,
        "Total Evaluated": len(events),
        "Successful Evaluations": 0
    }
    
    for i, event in enumerate(events):
        print(f"Evaluating Event {i+1}/{len(events)}: {event['id']}")
        lat, lon = event['latitude'], event['longitude']
        
        try:
            # Build local graph
            engine = GraphEngine(lat, lon, dist=1500)
            print(f"  - Fetching map data for {lat}, {lon}...")
            G = ox.graph_from_point((lat, lon), dist=1500, network_type='drive')
            G = ox.add_edge_speeds(G)
            G = ox.add_edge_travel_times(G)
            engine.G = G
            
            # ---------------------------------------------
            # Phase 1: Shockwave Accuracy (Euclidean vs BFS)
            # ---------------------------------------------
            print("  - Running Phase 1 (Shockwave Topography)")
            sim = CongestionSimulator(G, lat, lon)
            euclidean_closed = set()
            for u, v, k, data in sim.G.edges(keys=True, data=True):
                node_data = sim.G.nodes[u]
                # Distance in meters using ox
                dist = ox.distance.great_circle(lat, lon, node_data['y'], node_data['x'])
                if dist <= 50:
                    euclidean_closed.add((u, v))
                    
            # BFS shockwave
            bfs_closed, bfs_spillover = sim.simulate_congestion_shockwave(closure_radius=50, spillover_radius=300)
            
            # False positives eliminated
            false_positives = len(euclidean_closed - bfs_closed)
            results["Phase 1: False Positives Eliminated"] += false_positives
            print(f"    -> Eliminated {false_positives} false positive closed edges.")
            
            # ---------------------------------------------
            # Phase 2: Diversion Route Efficiency
            # ---------------------------------------------
            print("  - Running Phase 2 (Diversion Route Efficiency)")
            origin, destination = sim.get_arterial_od_pair()
            
            try:
                freeflow_route = nx.shortest_path(G, origin, destination, weight='travel_time')
                
                # Calculate gridlock time by running the original route through the heavily congested sim graph
                gridlock_time = 0.0
                for u, v in zip(freeflow_route[:-1], freeflow_route[1:]):
                    # safely get travel time (which is inflated by 100x or 5x in sim.G)
                    edge_data = sim.G.get_edge_data(u, v)
                    if edge_data:
                        # get the first key (usually 0)
                        k = list(edge_data.keys())[0]
                        gridlock_time += edge_data[k].get('travel_time', 10)
                        
                diverted_route = sim.calculate_diversion(origin, destination)
                if diverted_route:
                    diverted_time = 0.0
                    for u, v in zip(diverted_route[:-1], diverted_route[1:]):
                        edge_data = sim.G.get_edge_data(u, v)
                        if edge_data:
                            k = list(edge_data.keys())[0]
                            diverted_time += edge_data[k].get('travel_time', 10)
                            
                    time_saved = gridlock_time - diverted_time
                    if time_saved > 0:
                        results["Phase 2: Total Time Saved (seconds)"] += time_saved
                        print(f"    -> Saved {time_saved:.2f} seconds by diverting.")
                    else:
                        print(f"    -> No time saved.")
            except nx.NetworkXNoPath:
                print("    -> Could not calculate a route.")
                pass
                
            # ---------------------------------------------
            # Phase 3: Barricade Placement Validity
            # ---------------------------------------------
            print("  - Running Phase 3 (Barricade Placement & Connectivity)")
            barricades = sim.recommend_barricades(bfs_closed)
            
            G_safe = G.copy()
            nodes_to_remove = [n for n in barricades if n in G_safe]
            G_safe.remove_nodes_from(nodes_to_remove)
            
            if nx.is_strongly_connected(G_safe):
                results["Phase 3: Successful Barricade Placements"] += 1
                print("    -> Barricades placed successfully (Graph is 100% strongly connected).")
            else:
                # check if largest connected component is still basically the whole graph
                scc = list(nx.strongly_connected_components(G_safe))
                if scc:
                    largest_cc = max(scc, key=len)
                    if len(largest_cc) > len(G_safe) * 0.95:
                        results["Phase 3: Successful Barricade Placements"] += 1
                        print("    -> Barricades placed successfully (Main graph > 95% connected).")
                    else:
                        print("    -> Barricades fractured the graph!")
                else:
                    print("    -> Barricades fractured the graph!")

            # ---------------------------------------------
            # Phase 4: Time-of-Day Sensitivity
            # ---------------------------------------------
            print("  - Running Phase 4 (Time-of-Day Sensitivity)")
            sim_midnight = CongestionSimulator(G, lat, lon, start_datetime="2024-01-01 03:00:00")
            sim_midnight.simulate_congestion_shockwave(50, 300)
            route_midnight = sim_midnight.calculate_diversion(origin, destination)
            
            sim_rushhour = CongestionSimulator(G, lat, lon, start_datetime="2024-01-01 18:00:00")
            sim_rushhour.simulate_congestion_shockwave(50, 300)
            route_rushhour = sim_rushhour.calculate_diversion(origin, destination)
            
            if route_midnight and route_rushhour and route_midnight != route_rushhour:
                results["Phase 4: Time-of-Day Detour Changes"] += 1
                print("    -> AI recommended a different route for midnight vs rush hour!")
            else:
                print("    -> AI recommended the same route regardless of time.")
                
            results["Successful Evaluations"] += 1
            
        except Exception as e:
            print(f"Error evaluating event: {e}")
            
    return results

if __name__ == "__main__":
    print("========================================")
    print("Starting Predictive Performance Evaluation")
    print("========================================")
    
    results = evaluate(num_events=10) # Using 10 events for timely execution
    
    print("\n========================================")
    print("EVALUATION RESULTS")
    print("========================================")
    for k, v in results.items():
        if isinstance(v, float):
            print(f"{k}: {v:.2f}")
        else:
            print(f"{k}: {v}")
