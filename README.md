---
title: AceNow
emoji: 🚀
colorFrom: blue
colorTo: indigo
sdk: docker
pinned: false
license: mit
---

# AceNow - AI-Powered Exam Prep Microservices

AceNow is a focused platform for last-minute exam preparation, offering AI-powered summaries, key topics, and quick quizzes for efficient revision. Built with a modern microservices architecture, it integrates seamlessly with Google Classroom to retrieve study materials and uses state-of-the-art AI models for content analysis.

## ✨ Core Features

- **Google Classroom Integration**: Securely fetch documents (PDF/PPTX) and announcements from your enrolled courses.
- **Smart Study Logic**:
  - **Key Topics**: Automatically identifies high-priority exam concepts.
  - **AI Summaries**: Concise oversight of core ideas for fast reading.
  - **Pedagogical Quizzes**: Scenario-based MCQs with hints and detailed rationales for every answer.
- **Robust AI Fallback**: Multi-provider engine (Gemini 2.0 -> Groq Llama 3 -> Ollama) ensures 100% uptime even during rate limits.
- **Parallel Downloads**: Bundle all course materials into a single ZIP file instantly using JSZip.
- **Modern Responsive UI**: Premium glassmorphic interface with Dark/Light modes and full mobile compatibility.
- **AI Assistant**: Dedicated academic chat interface for deep-diving into complex topics.

## 🏗️ Architecture

The system is split into specialized microservices:

1.  **API Gateway (Port 5000)**: Single entry point that routes requests and manages cross-service communication.
2.  **Auth Service (Port 5001)**: Handles Google OAuth2 authentication and configuration.
3.  **File Parser Service (Port 5002)**: Specialized in extracting text content from PDFs and PPTXs.
4.  **AI Service (Port 5003)**: The "brain" of AceNow, managing complex prompts and various AI model providers.
5.  **Frontend Service (Port 5004)**: Serves the web application, styles, and assets.

## 🚀 Quick Start

### 1. Requirements
- Python 3.9+
- [Google Cloud Project](GOOGLE_SETUP.md) for Google Classroom API.
- [Gemini API Key](https://aistudio.google.com/app/apikey) (Primary).
- [Groq API Key](https://console.groq.com/keys) (Fallback).

### 2. Setup
Create a `.env` file in the root directory:
```env
GOOGLE_CLIENT_ID=your_client_id
GEMINI_API_KEY=your_gemini_key
GROQ_API_KEY=your_groq_key
# Optional: HF_TOKEN=your_huggingface_token
```

### 3. Run with Docker Compose
The easiest way to start the entire cluster:
```bash
docker-compose up --build
```
Access the app at: **http://localhost:5000**

### 4. Run Locally (Dev Mode)
Alternatively, use the provided development runner:
```bash
python run_dev.py
```

## 🌍 Free Hosting & Deployment

AceNow is designed to run entirely on free-tier services.

### Option A: Hugging Face Spaces (Recommended)
1.  Create a new **Space** on Hugging Face.
2.  Select **Docker** as the SDK.
3.  Upload the project (the `Dockerfile` at the root handles the multi-service build).
4.  Go to **Settings > Variables & Secrets** and add your `.env` variables.

### Option B: Render (Manual)
1.  Deploy the **API Gateway** as a Web Service.
2.  Deploy individual services as **Private Services** (no cost for inter-service communication).
3.  Link them using the environment variables in the Gateway.

## 📄 License
© 2026 Jose Davidson. Developed with the assistance of Antigravity.
