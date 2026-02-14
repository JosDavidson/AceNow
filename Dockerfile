FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy all services
COPY . .

# Install dependencies from root requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Create non-root user (good practice for HF Spaces)
RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH

WORKDIR /app

# Ensure start script is executable
USER root
RUN chmod +x start.sh
USER user

# Default Port for many free hosting services
EXPOSE 5000

# Start script
CMD ["./start.sh"]
