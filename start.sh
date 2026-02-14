#!/bin/bash

# Start services in background
python services/auth-service/app.py &
python services/file-parser-service/app.py &
python services/ai-service/app.py &
python services/frontend-service/app.py &

# Start API Gateway (main entry point) in foreground
python services/api-gateway/app.py
