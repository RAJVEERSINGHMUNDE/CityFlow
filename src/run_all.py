import subprocess
import os
import time

def main():
    print("========================================")
    print("Starting CityFlow Digital Twin")
    print("========================================")
    
    # 1. Start Flask API
    print("[1/2] Starting Flask Backend API on port 5000...")
    api_dir = os.path.join(os.path.dirname(__file__), "api")
    api_script = os.path.join(api_dir, "app.py")
    api_process = subprocess.Popen(["python", api_script])
    
    # Give API a second to spin up
    time.sleep(2)
    
    # 2. Start Vite React Dashboard
    print("[2/2] Starting React Dashboard...")
    dashboard_dir = os.path.join(os.path.dirname(__file__), "dashboard")
    
    # Note: On Windows, use shell=True for npm commands
    is_windows = os.name == 'nt'
    dashboard_process = subprocess.Popen(["npm", "run", "dev"], cwd=dashboard_dir, shell=is_windows)
    
    print("\n========================================")
    print("CityFlow is running!")
    print("Dashboard: http://localhost:3000")
    print("API: http://localhost:8000")
    print("Press Ctrl+C to stop both servers.")
    print("========================================\n")
    
    try:
        api_process.wait()
        dashboard_process.wait()
    except KeyboardInterrupt:
        print("\nShutting down gracefully...")
        api_process.terminate()
        dashboard_process.terminate()
        print("Shutdown complete.")

if __name__ == "__main__":
    main()
