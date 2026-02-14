from flask import Flask, send_from_directory, jsonify
from flask_cors import CORS
import os
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__, 
            static_folder='static', 
            static_url_path='/static',
            template_folder='templates')
CORS(app)

@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({"status": "healthy", "service": "frontend-service"}), 200

@app.route('/')
def index():
    """Serve main HTML page"""
    return send_from_directory('templates', 'index.html')

if __name__ == '__main__':
    port = int(os.getenv('PORT', 5004))
    print(f"Frontend Service running on port {port}")
    app.run(host='0.0.0.0', port=port, debug=True)
