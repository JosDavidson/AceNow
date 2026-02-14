from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
import requests
import os
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__, static_folder=None)
CORS(app)

# Service URLs
AUTH_SERVICE_URL = os.getenv("AUTH_SERVICE_URL", "http://localhost:5001")
FILE_PARSER_SERVICE_URL = os.getenv("FILE_PARSER_SERVICE_URL", "http://localhost:5002")
AI_SERVICE_URL = os.getenv("AI_SERVICE_URL", "http://localhost:5003")
FRONTEND_SERVICE_URL = os.getenv("FRONTEND_SERVICE_URL", "http://localhost:5004")

@app.route('/health', methods=['GET'])
def health():
    """Health check for API Gateway"""
    services_health = {}
    
    # Check all services
    services = {
        "auth": AUTH_SERVICE_URL,
        "file-parser": FILE_PARSER_SERVICE_URL,
        "ai": AI_SERVICE_URL,
        "frontend": FRONTEND_SERVICE_URL
    }
    
    for name, url in services.items():
        try:
            response = requests.get(f"{url}/health", timeout=2)
            print(f"DEBUG: Service {name} at {url} returned status {response.status_code}")
            services_health[name] = "healthy" if response.status_code == 200 else "unhealthy"
        except Exception as e:
            print(f"DEBUG: Service {name} at {url} failed: {str(e)}")
            services_health[name] = "unreachable"
    
    return jsonify({
        "status": "healthy",
        "service": "api-gateway",
        "services": services_health
    }), 200

# ==================== AUTH ROUTES ====================
@app.route('/api/config', methods=['GET'])
def get_config():
    """Get authentication configuration"""
    try:
        response = requests.get(f"{AUTH_SERVICE_URL}/auth/config")
        return jsonify(response.json()), response.status_code
    except Exception as e:
        return jsonify({"success": False, "error": f"Auth service unavailable: {str(e)}"}), 503

@app.route('/api/auth/verify', methods=['POST'])
def verify_token():
    """Verify authentication token"""
    try:
        response = requests.post(
            f"{AUTH_SERVICE_URL}/auth/verify",
            json=request.get_json()
        )
        return jsonify(response.json()), response.status_code
    except Exception as e:
        return jsonify({"success": False, "error": f"Auth service unavailable: {str(e)}"}), 503

# ==================== FILE PARSER ROUTES ====================
@app.route('/api/parse-file', methods=['POST'])
def parse_file():
    """Parse uploaded file"""
    try:
        # Forward the file to the file parser service
        files = {'file': request.files['file']}
        response = requests.post(
            f"{FILE_PARSER_SERVICE_URL}/parse-file",
            files=files
        )
        return jsonify(response.json()), response.status_code
    except Exception as e:
        return jsonify({"success": False, "error": f"File parser service unavailable: {str(e)}"}), 503

# ==================== AI ROUTES ====================
@app.route('/api/generate-quiz', methods=['POST'])
def generate_quiz():
    """Generate quiz from text"""
    try:
        response = requests.post(
            f"{AI_SERVICE_URL}/ai/generate-quiz",
            json=request.get_json()
        )
        return jsonify(response.json()), response.status_code
    except Exception as e:
        return jsonify({"success": False, "error": f"AI service unavailable: {str(e)}"}), 503

@app.route('/api/generate-topics', methods=['POST'])
def generate_topics():
    """Generate key topics from text"""
    try:
        response = requests.post(
            f"{AI_SERVICE_URL}/ai/generate-topics",
            json=request.get_json()
        )
        return jsonify(response.json()), response.status_code
    except Exception as e:
        return jsonify({"success": False, "error": f"AI service unavailable: {str(e)}"}), 503

@app.route('/api/generate-summary', methods=['POST'])
def generate_summary():
    """Generate summary from text"""
    try:
        response = requests.post(
            f"{AI_SERVICE_URL}/ai/generate-summary",
            json=request.get_json()
        )
        return jsonify(response.json()), response.status_code
    except Exception as e:
        return jsonify({"success": False, "error": f"AI service unavailable: {str(e)}"}), 503

@app.route('/api/explain-topic', methods=['POST'])
def explain_topic():
    """Explain a specific topic in detail"""
    try:
        response = requests.post(
            f"{AI_SERVICE_URL}/ai/explain-topic",
            json=request.get_json()
        )
        return jsonify(response.json()), response.status_code
    except Exception as e:
        return jsonify({"success": False, "error": f"AI service unavailable: {str(e)}"}), 503

# ==================== FRONTEND ROUTES ====================
@app.route('/')
def index():
    """Serve main page"""
    try:
        response = requests.get(f"{FRONTEND_SERVICE_URL}/")
        # Forward original content type from upstream if available
        headers = {'Content-Type': response.headers.get('Content-Type', 'text/html')}
        return response.content, response.status_code, headers
    except Exception as e:
        return f"Frontend service unavailable: {str(e)}", 503

@app.route('/static/<path:path>')
def serve_static(path):
    """Serve static files"""
    try:
        # Construct the upstream URL
        url = f"{FRONTEND_SERVICE_URL}/static/{path}"
        response = requests.get(url, stream=True)
        
        if response.status_code != 200:
            return f"Static file not found at upstream: {path} (Checked: {url})", 404

        # Forward important headers, especially Content-Type
        headers = {}
        if 'Content-Type' in response.headers:
            headers['Content-Type'] = response.headers['Content-Type']
        
        return response.content, response.status_code, headers
    except Exception as e:
        return f"Static file proxy error: {str(e)}", 500

if __name__ == '__main__':
    port = int(os.getenv('PORT', 5000))
    print(f"API Gateway running on port {port}")
    print(f"   Auth Service: {AUTH_SERVICE_URL}")
    print(f"   File Parser: {FILE_PARSER_SERVICE_URL}")
    print(f"   AI Service: {AI_SERVICE_URL}")
    print(f"   Frontend: {FRONTEND_SERVICE_URL}")
    app.run(host='0.0.0.0', port=port, debug=True)
