from flask import Flask, jsonify, request
from flask_cors import CORS
import os
import json
import requests
from google import genai
from groq import Groq
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
CORS(app)

# API Keys
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
HF_API_KEY = os.getenv("HF_API_KEY")
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")

# Initialize Groq Client
try:
    if GROQ_API_KEY:
        groq_client = Groq(api_key=GROQ_API_KEY)
    else:
        groq_client = None
        print("Warning: GROQ_API_KEY not set")
except Exception as e:
    groq_client = None
    print(f"Failed to initialize Groq Client: {e}")



def configure_genai():
    """Configure Gemini AI - No longer needed with direct requests but kept for interface compatibility if needed"""
    pass

# Initialize Google GenAI Client
try:
    if GEMINI_API_KEY:
        client = genai.Client(api_key=GEMINI_API_KEY)
    else:
        client = None
        print("Warning: GEMINI_API_KEY not set")
except Exception as e:
    client = None
    print(f"Failed to initialize Gemini Client: {e}")

def query_gemini_new(prompt, model_id="gemini-2.0-flash"):
    """Query Gemini 2.0 API using google-genai SDK"""
    if not client:
        raise Exception("Gemini Client not initialized")
    
    # Map old model names to new ones if necessary, or just use what's passed
    if model_id == "gemini-1.5-flash":
        model_id = "gemini-2.0-flash" 
        
    try:
        response = client.models.generate_content(
            model=model_id,
            contents=prompt
        )
        return response.text
    except Exception as e:
        raise Exception(f"Gemini 2.0 Inference Failed: {str(e)}")

def query_groq(prompt, model_id="llama-3.3-70b-versatile"):
    """Query Groq API"""
    if not groq_client:
        raise Exception("Groq Client not initialized (check GROQ_API_KEY)")
    
    # Map old model names to new ones
    if model_id in ["llama3-70b-8192", "llama-3.1-70b-versatile"]:
        model_id = "llama-3.3-70b-versatile"
    
    try:
        chat_completion = groq_client.chat.completions.create(
            messages=[
                {
                    "role": "user",
                    "content": prompt,
                }
            ],
            model=model_id,
        )
        return chat_completion.choices[0].message.content
    except Exception as e:
        raise Exception(f"Groq Inference Failed: {str(e)}")

def query_ollama(prompt, model_id="llama3"):
    """Query local Ollama instance"""
    url = f"{OLLAMA_BASE_URL}/api/generate"
    payload = {
        "model": model_id,
        "prompt": prompt,
        "stream": False
    }
    
    try:
        response = requests.post(url, json=payload)
        if response.status_code != 200:
            raise Exception(f"Ollama Error {response.status_code}: {response.text}")
        return response.json()['response']
    except requests.exceptions.ConnectionError:
        raise Exception("Could not connect to Ollama. Is it running?")
    except Exception as e:
        raise Exception(f"Ollama Inference Failed: {str(e)}")

def query_huggingface(prompt, model_id, api_key=None):
    """Query Hugging Face models"""
    if not api_key:
        api_key = os.getenv("HF_TOKEN") or os.getenv("HF_API_KEY")
    
    if not api_key:
        raise Exception("Hugging Face API key missing")

    if not model_id:
        model_id = "zai-org/GLM-4.7-Flash:novita"

    client = OpenAI(
        base_url="https://router.huggingface.co/v1",
        api_key=api_key
    )

    try:
        completion = client.chat.completions.create(
            model=model_id,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.7,
            max_tokens=4096,
            top_p=0.9
        )
        return completion.choices[0].message.content
    except Exception as e:
        raise Exception(f"Hugging Face Inference Failed: {str(e)}")

def query_ai_with_fallback(prompt, provider=None, model_id=None):
    """Unified query function with automatic fallback on failure (e.g. quota limits)"""
    # Order of fallback: Requested -> Gemini -> Groq -> Ollama
    providers_to_try = []
    
    if provider:
        providers_to_try.append(provider)
    
    # Add others as fallbacks if not already the primary
    for p in ["gemini", "groq", "ollama"]:
        if p not in providers_to_try:
            providers_to_try.append(p)
    
    last_error = None
    for p in providers_to_try:
        try:
            print(f"DEBUG: Trying AI provider: {p}")
            if p == "groq":
                # Only try Groq if key is available
                if not GROQ_API_KEY: 
                    raise Exception("Groq API Key missing")
                m = model_id if provider == "groq" else "llama-3.3-70b-versatile"
                return query_groq(prompt, m)
            
            elif p == "gemini":
                # Only try Gemini if key is available
                if not GEMINI_API_KEY:
                    raise Exception("Gemini API Key missing")
                m = model_id if provider == "gemini" else "gemini-2.0-flash"
                return query_gemini_new(prompt, m)
                
            elif p == "ollama":
                m = model_id if provider == "ollama" else "llama3.2"
                return query_ollama(prompt, m)
                
        except Exception as e:
            last_error = str(e)
            print(f"WARNING: Provider {p} failed: {last_error}")
            # If it's a quota error or connection error, continue to next provider
            if "429" in last_error or "quota" in last_error.lower() or "connection" in last_error.lower():
                continue
            else:
                # For other errors (like prompt issues), we might want to stop, 
                # but for safety let's try the next one anyway.
                continue
                
    raise Exception(f"All AI providers failed. Last error: {last_error}")

@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({
        "status": "healthy",
        "service": "ai-service",
        "hasGeminiKey": bool(GEMINI_API_KEY),
        "hasGroqKey": bool(GROQ_API_KEY)
    }), 200

@app.route('/ai/generate-quiz', methods=['POST'])
def generate_quiz():
    """Generate quiz using improved pedagogical prompt"""
    try:
        data = request.get_json(force=True)
        text_content = data.get("text", "")
        provider = data.get("provider", "gemini") # Default to Gemini
        model_id = data.get("model")
        num_questions = data.get("numQuestions", 5)
        difficulty = data.get("difficulty", "Medium")

        if not text_content:
            return jsonify({"success": False, "error": "No text provided"}), 400

        # Enhanced pedagogical prompt
        prompt = f"""Act as an Expert Educator and DevOps Architect. Your task is to generate a JSON-formatted practice quiz based on the provided file content.

Follow these strict pedagogical rules:
1. FOCUS ON APPLICATION: Do not ask for simple definitions. Create scenario-based questions where the user must apply a concept.
2. RATIONALE-DRIVEN: For every answer option, provide a one-sentence rationale explaining WHY it is correct or WHY it is a common misconception.
3. ADAPTIVE DIFFICULTY: Group questions into 'Conceptual', 'Hands-on/Syntax', and 'Architectural/Problem Solving'.
4. STRICT JSON: Ensure all double quotes within text fields are escaped with a backslash. Use only valid JSON characters.
5. FORMAT: Return only a valid JSON object with the following structure:

{{
  "title": "Quiz Title",
  "questions": [
    {{
      "question": "string",
      "answerOptions": [
        {{"text": "string", "rationale": "string", "isCorrect": boolean}}
      ],
      "hint": "string",
      "category": "Conceptual|Hands-on|Architectural"
    }}
  ]
}}

Generate exactly {num_questions} questions.
The difficulty level should be: {difficulty}.

Text:
{text_content[:10000]}
"""

        # Query AI provider with fallback
        response_text = query_ai_with_fallback(prompt, provider, model_id)

        # Robust JSON cleaning
        cleaned = response_text.strip()
        if cleaned.startswith("```"):
            # Remove markdown blocks if AI accidentally included them despite JSON mode
            parts = cleaned.split("```")
            if len(parts) >= 3:
                cleaned = parts[1]
                if cleaned.startswith("json"):
                    cleaned = cleaned[4:]
        
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start == -1 or end == -1:
            # Fallback for list-style responses if title/questions wrapper is missing
            start = cleaned.find("[")
            end = cleaned.rfind("]")
            if start == -1 or end == -1:
                raise Exception("AI did not return valid JSON structure")
            
            raw_list = json.loads(cleaned[start:end + 1])
            quiz_data = {"title": "Practice Quiz", "questions": raw_list}
        else:
            quiz_data = json.loads(cleaned[start:end + 1])

        return jsonify({"success": True, "quiz": quiz_data}), 200

    except Exception as e:
        print(f"Quiz generation error: {str(e)}")
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/ai/generate-topics', methods=['POST'])
def generate_topics():
    """Extract key topics from text"""
    try:
        data = request.get_json(force=True)
        text_content = data.get("text", "")
        provider = data.get("provider", "gemini") # Changed default to gemini
        model_id = data.get("model")

        if not text_content:
            return jsonify({"success": False, "error": "No text provided"}), 400

        prompt = f"""Extract the 5 most important topics from the text below.
Return ONLY valid JSON:

[
  {{ "topic": "Topic Name", "description": "One sentence description" }}
]

Text:
{text_content[:10000]}
"""

        # Query AI provider with fallback
        response_text = query_ai_with_fallback(prompt, provider, model_id)

        cleaned = response_text.strip()
        if cleaned.startswith("```"):
            parts = cleaned.split("```")
            if len(parts) >= 3:
                cleaned = parts[1]
                if cleaned.startswith("json"):
                    cleaned = cleaned[4:]

        start = cleaned.find("[")
        end = cleaned.rfind("]")
        if start == -1 or end == -1:
            # Maybe it returned a single object?
            start = cleaned.find("{")
            end = cleaned.rfind("}")
            if start == -1 or end == -1:
                raise Exception("AI did not return valid JSON")
            
            topics = [json.loads(cleaned[start:end + 1])]
        else:
            topics = json.loads(cleaned[start:end + 1])

        return jsonify({"success": True, "topics": topics}), 200

    except Exception as e:
        print(f"Topics generation error: {str(e)}")
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/ai/generate-summary', methods=['POST'])
def generate_summary():
    """Generate summary of text"""
    try:
        data = request.get_json(force=True)
        text_content = data.get("text", "")
        provider = data.get("provider", "gemini")
        model_id = data.get("model")

        if not text_content:
            return jsonify({"success": False, "error": "No text provided"}), 400

        prompt = f"""Summarize the following text in a concise and easy-to-understand manner for a student.
Highlight key definitions and core concepts. 
Limit to 3 paragraphs.

Text:
{text_content[:15000]}
"""

        # Query AI provider with fallback
        response_text = query_ai_with_fallback(prompt, provider, model_id)

        return jsonify({"success": True, "summary": response_text}), 200

    except Exception as e:
        print(f"Summary generation error: {str(e)}")
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/ai/explain-topic', methods=['POST'])
def explain_topic():
    """Explain a specific topic in detail based on the text context"""
    try:
        data = request.get_json(force=True)
        text_content = data.get("text", "")
        topic_name = data.get("topic", "")
        provider = data.get("provider", "gemini")
        model_id = data.get("model")

        if not text_content or not topic_name:
            return jsonify({"success": False, "error": "Missing context or topic name"}), 400

        prompt = f"""Explain the topic '{topic_name}' in detail based on its context within the provided text.
Explain it like you are a helpful teacher. Use simple analogies if possible.
Keep the explanation focused, professional, and limited to 2-3 detailed paragraphs.

Context Text:
{text_content[:10000]}
"""

        # Query AI provider with fallback
        response_text = query_ai_with_fallback(prompt, provider, model_id)

        return jsonify({"success": True, "explanation": response_text}), 200

    except Exception as e:
        print(f"Topic explanation error: {str(e)}")
        return jsonify({"success": False, "error": str(e)}), 500

if __name__ == '__main__':
    port = int(os.getenv('PORT', 5003))
    print(f"AI Service running on port {port}")
    app.run(host='0.0.0.0', port=port, debug=True)
