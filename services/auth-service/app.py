from flask import Flask, jsonify, request
from flask_cors import CORS
import os
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
CORS(app)

# Google OAuth Configuration
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "550475677172-a5kk2v33roru9ujnq8jsq93li6t1dep7.apps.googleusercontent.com")

@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({"status": "healthy", "service": "auth-service"}), 200

@app.route('/auth/config', methods=['GET'])
def get_config():
    """Get Google OAuth configuration"""
    return jsonify({
        "clientId": GOOGLE_CLIENT_ID,
        "success": True
    }), 200

@app.route('/auth/verify', methods=['POST'])
def verify_token():
    """Verify Google OAuth token"""
    try:
        data = request.get_json()
        token = data.get('token')
        
        if not token:
            return jsonify({"success": False, "error": "No token provided"}), 400
        
        # In production, verify the token with Google
        # For now, we'll accept any token for development
        return jsonify({
            "success": True,
            "user": {
                "email": "user@example.com",
                "name": "User"
            }
        }), 200
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

if __name__ == '__main__':
    port = int(os.getenv('PORT', 5001))
    print(f"Auth Service running on port {port}")
    app.run(host='0.0.0.0', port=port, debug=True)
