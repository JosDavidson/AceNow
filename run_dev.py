import subprocess
import os
import sys
import time
import threading

# Define services with their directories and ports
SERVICES = [
    {"name": "Auth Service", "dir": "services/auth-service", "port": 5001},
    {"name": "File Parser", "dir": "services/file-parser-service", "port": 5002},
    {"name": "AI Service", "dir": "services/ai-service", "port": 5003},
    {"name": "Frontend", "dir": "services/frontend-service", "port": 5004},
    {"name": "API Gateway", "dir": "services/api-gateway", "port": 5000},
]

processes = []

def run_service(service):
    print(f"Starting {service['name']}...")
    cwd = os.path.join(os.getcwd(), service['dir'])
    
    # Use the current python interpreter
    cmd = [sys.executable, "app.py"]
    
    # Set environment variables if needed
    env = os.environ.copy()
    env["PORT"] = str(service["port"])
    env["NO_PROXY"] = "*" # Disable proxy for inter-service communication
    
    process = subprocess.Popen(
        cmd, 
        cwd=cwd, 
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1
    )
    processes.append(process)
    
    # Print service logs with prefix
    for line in iter(process.stdout.readline, ""):
        print(f"[{service['name']}] {line.strip()}")
    
    process.stdout.close()

def main():
    print("🌟 AceNow Microservices Development Runner")
    print("==========================================")
    
    threads = []
    for service in SERVICES:
        t = threading.Thread(target=run_service, args=(service,))
        t.daemon = True
        t.start()
        threads.append(t)
        time.sleep(1) # Small delay to avoid clashes
    
    print("\nAll services started. Access the app at http://localhost:5000")
    print("Press Ctrl+C to stop all services.\n")
    
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\nStopping all services...")
        for p in processes:
            p.terminate()
        sys.exit(0)

if __name__ == "__main__":
    main()
