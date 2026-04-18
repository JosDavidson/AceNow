/* 
  ExamPrep App Logic 
  Handles Google Auth, Classroom API fetching, and Quiz UI
*/

// Configuration
let CLIENT_ID = '';
const DISCOVERY_DOCS = ["https://www.googleapis.com/discovery/v1/apis/classroom/v1/rest", "https://www.googleapis.com/discovery/v1/apis/drive/v3/rest"];
const SCOPES = "https://www.googleapis.com/auth/classroom.courses.readonly https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/classroom.announcements.readonly https://www.googleapis.com/auth/classroom.coursework.students.readonly https://www.googleapis.com/auth/classroom.courseworkmaterials.readonly";

const AI_CONFIG = {
    gemini: {
        label: "Google Gemini",
        helpLink: "https://aistudio.google.com/app/apikey",
        models: [
            { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash (Default)" },
            { id: "gemini-1.5-pro", name: "Gemini 1.5 Pro" }
        ]
    },
    groq: {
        label: "Groq (High Speed)",
        helpLink: "https://console.groq.com/keys",
        models: [
            { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B (Latest)" },
            { id: "llama-3.1-8b-instant", name: "Llama 3.1 8B (Fast)" }
        ]
    },
    ollama: {
        label: "Ollama (Requires Local App)",
        helpLink: "https://ollama.com",
        models: [
            { id: "llama3.2", name: "Llama 3.2 (Local)" },
            { id: "deepseek-r1", name: "DeepSeek R1 (Local)" },
            { id: "mistral", name: "Mistral" }
        ]
    }
};

// State
let tokenClient;
let gapiInited = false;
let gisInited = false;
let currentQuiz = [];
let currentQuestionIndex = 0;
let userScore = 0;
let correctCount = 0;
let wrongCount = 0;
let currentTextContent = ""; // Store text to avoid re-parsing for redundant calls
let currentBaseText = ""; // Store base text before file text
let pendingOperation = null;
let currentTextContentForOperation = "";
let currentSubjectName = "";
let quizTimer = null;
let secondsElapsed = 0;
let isTimerEnabled = false;
let allLoadedCourses = []; // Store courses for assistant use
let courseContentCache = {}; // Cache for extracted course text
let currentFileList = []; // Current course files for download
let currentAssistantChatContext = []; // Running conversation for assistant
let wrongQuestionsContext = []; // Topics user got wrong for adaptive quiz

// --- Optimization: Settings & API Key ---
function getSettings() {
    return {
        provider: localStorage.getItem('ai_provider') || "groq",
        model: localStorage.getItem('ai_model') || "llama-3.3-70b-versatile"
    };
}

let tempSelectedModelId = ""; // Track selection within the modal

function updateModelOptions() {
    const list = document.getElementById('model-options-list');
    list.innerHTML = '';

    Object.keys(AI_CONFIG).forEach(providerKey => {
        const config = AI_CONFIG[providerKey];

        // Provider Header
        const header = document.createElement('div');
        header.className = 'settings-provider-header';
        header.innerText = config.label;
        list.appendChild(header);

        config.models.forEach(m => {
            const pill = document.createElement('div');
            pill.className = `model-pill ${m.id === tempSelectedModelId ? 'selected' : ''}`;
            pill.innerText = m.name;
            pill.onclick = () => {
                document.querySelectorAll('.model-pill').forEach(p => p.classList.remove('selected'));
                pill.classList.add('selected');
                tempSelectedModelId = m.id;
            };
            list.appendChild(pill);
        });
    });
}

function openSettings() {
    const modal = document.getElementById('settings-modal');
    const settings = getSettings();
    tempSelectedModelId = settings.model; // Initialize temp selection
    updateModelOptions();
    modal.showModal();
}

function closeSettings() {
    document.getElementById('settings-modal').close();
}

function saveSettings() {
    if (tempSelectedModelId) {
        // Find provider for this model
        let provider = 'gemini';
        Object.keys(AI_CONFIG).forEach(k => {
            if (AI_CONFIG[k].models.find(m => m.id === tempSelectedModelId)) {
                provider = k;
            }
        });

        localStorage.setItem('ai_model', tempSelectedModelId);
        localStorage.setItem('ai_provider', provider);
        closeSettings();
    }
}

// --- Theme Toggle ---
function toggleTheme() {
    const html = document.documentElement;
    const current = html.getAttribute('data-theme');
    const next = current === 'light' ? 'dark' : 'light';
    html.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    updateThemeIcon(next);
}

function updateThemeIcon(theme) {
    const btn = document.getElementById('theme-toggle-btn');
    if (btn) btn.innerText = theme === 'light' ? '☀️' : '🌙';
}

function initTheme() {
    const saved = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', saved);
    updateThemeIcon(saved);
}

// 1. Initial Load
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    fetchConfig();

    // Load images from bundle
    if (typeof IMAGE_BUNDLE !== 'undefined') {
        document.querySelectorAll('img[data-src]').forEach(img => {
            const name = img.dataset.src;
            if (IMAGE_BUNDLE[name]) {
                img.src = IMAGE_BUNDLE[name];
            }
        });
    }
});

async function fetchConfig() {
    try {
        const response = await fetch('/api/config');
        const data = await response.json();
        if (data.clientId && data.clientId !== 'PLACEHOLDER_FOR_USER_TO_FILL') {
            CLIENT_ID = data.clientId;
        }
        gapi.load('client', initializeGapiClient);
        initializeGisClient();
    } catch (e) {
        console.error("Config load failed", e);
    }
}

// 2. Google API Setup

async function initializeGapiClient() {
    await gapi.client.init({ discoveryDocs: DISCOVERY_DOCS });
    gapiInited = true;
    maybeEnableButtons();
}

function initializeGisClient() {
    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: '', // defined below
    });
    gisInited = true;
    maybeEnableButtons();
}

function maybeEnableButtons() {
    if (gapiInited && gisInited) {
        console.log("Google APIs Ready");

        // Session Persistence: Check if we have a saved token
        const savedToken = localStorage.getItem('google_token');
        if (savedToken) {
            try {
                const tokenObj = JSON.parse(savedToken);
                // Check if token is potentially expired (rough check)
                // If it's valid, set it and log in
                gapi.client.setToken(tokenObj);
                updateAuthUI(true);
                listCourses();
            } catch (e) {
                console.warn("Invalid token in storage", e);
                localStorage.removeItem('google_token');
            }
        }
    }
}

function handleAuthClick() {
    tokenClient.callback = async (resp) => {
        if (resp.error !== undefined) throw (resp);

        // Persist token for session recovery on refresh
        localStorage.setItem('google_token', JSON.stringify(resp));

        updateAuthUI(true);
        await listCourses();
    };

    if (gapi.client.getToken() === null) {
        tokenClient.requestAccessToken({ prompt: 'consent' });
    } else {
        tokenClient.requestAccessToken({ prompt: '' });
    }
}

function handleSignoutClick() {
    const token = gapi.client.getToken();
    if (token !== null) {
        google.accounts.oauth2.revoke(token.access_token);
        gapi.client.setToken('');
        localStorage.removeItem('google_token'); // Clear persistent session
        updateAuthUI(false);
    }
}

function updateAuthUI(isSignedIn) {
    const loginView = document.getElementById('login-view');
    const dashboardView = document.getElementById('dashboard-view');

    if (isSignedIn) {
        loginView.style.display = 'none';
        dashboardView.style.display = 'block';

        const loader = document.getElementById('initial-loading');
        const grid = document.getElementById('courses-grid');

        loader.style.display = 'flex'; // show loader while fetching
        animateLoadingText('initial-loading-text');

        // Try to get user info if possible (optional enhancement)
        // const output = document.getElementById('user-profile-pic');
        // output.style.backgroundImage = `url(...)`;

    } else {
        loginView.style.display = 'flex';
        dashboardView.style.display = 'none';
        document.getElementById('courses-grid').innerHTML = '';
    }
}

// 4. Feature Logic: Classroom

async function listCourses() {
    const grid = document.getElementById('courses-grid');
    grid.innerHTML = '';

    try {
        const response = await gapi.client.classroom.courses.list({
            pageSize: 12,
            courseStates: 'ACTIVE'
        });

        document.getElementById('initial-loading').style.display = 'none';
        stopLoadingAnimation();

        const courses = response.result.courses;
        allLoadedCourses = courses || []; // Save to global state
        if (!courses || courses.length === 0) {
            grid.innerHTML = '<p>No courses found.</p>';
            return;
        }

        courses.forEach((course, index) => {
            const card = document.createElement('div');
            card.className = 'card';
            const imgName = `Card${(index % 4) + 1}.png`;
            const cardImg = (typeof IMAGE_BUNDLE !== 'undefined' && IMAGE_BUNDLE[imgName]) ? IMAGE_BUNDLE[imgName] : '';

            card.innerHTML = `
                <div class="card-image-container">
                    <img src="${cardImg}" class="card-banner" alt="${course.name}">
                </div>
                <div class="card-info">
                    <div class="card-text">
                        <div class="card-subtitle">${course.section || 'General'}</div>
                        <div class="card-title">${course.name}</div>
                    </div>
                    <button class="card-action">View Materials</button>
                </div>
            `;
            card.onclick = (e) => {
                loadCourseMaterials(course.id, course.name, course.section || 'General');
            };
            card.style.opacity = '0';
            card.style.transform = 'translateY(20px)';
            card.style.transition = `opacity 0.4s ease ${index * 80}ms, transform 0.4s ease ${index * 80}ms`;
            grid.appendChild(card);
            requestAnimationFrame(() => {
                card.style.opacity = '1';
                card.style.transform = 'translateY(0)';
            });
        });

    } catch (err) {
        console.error(err);
        document.getElementById('initial-loading').style.display = 'none';
        stopLoadingAnimation();
        grid.innerHTML = `<p style="color:red">Error loading courses: ${err.message}</p>`;
    }
}

// 5. Materials & Quiz Logic

// --- Optimization: Caching & Parallel Processing ---

async function loadCourseMaterials(courseId, courseName, courseBatch) {
    currentSubjectName = courseName;

    // Reset UI State
    document.getElementById('quiz-modal').classList.add('active');
    switchView('loading');
    const loadText = document.getElementById('loading-text');
    loadText.innerText = `Scanning ${courseName} for documents...`;

    // Update Action Menu Header placeholders
    document.getElementById('menu-course-name').innerText = courseName;
    document.getElementById('menu-course-batch').innerText = courseBatch;

    try {
        // --- Step 0: Check Cache ---
        if (courseContentCache[courseId]) {
            console.log(`Loading ${courseName} from session cache`);
            currentTextContent = courseContentCache[courseId].text;
            currentBaseText = courseContentCache[courseId].baseText || currentTextContent;
            currentFileList = courseContentCache[courseId].files;
            switchView('action-menu');
            return;
        }

        let aggregatedText = "";
        let filesToProcess = [];

        // --- Step 1: Gather All Metadata (Parallel API Calls) ---
        loadText.innerText = "Fetching Classroom Data...";

        const [announceResp, workResp, matResp] = await Promise.all([
            Promise.resolve(gapi.client.classroom.courses.announcements.list({ courseId, pageSize: 5 })).catch(e => ({ result: {} })),
            Promise.resolve(gapi.client.classroom.courses.courseWork.list({ courseId, pageSize: 10 })).catch(e => ({ result: {} })),
            Promise.resolve(gapi.client.classroom.courses.courseWorkMaterials.list({ courseId, pageSize: 10 })).catch(e => ({ result: {} }))
        ]);

        // Process Announcements
        if (announceResp.result.announcements) {
            announceResp.result.announcements.forEach(a => {
                aggregatedText += (a.text || "") + "\n";
                if (a.materials) filesToProcess.push(...a.materials);
            });
        }

        // Process Assignments
        if (workResp.result.courseWork) {
            workResp.result.courseWork.forEach(w => {
                aggregatedText += (w.description || "") + "\n";
                if (w.materials) filesToProcess.push(...w.materials);
            });
        }

        // Process Materials
        if (matResp.result.courseWorkMaterial) {
            matResp.result.courseWorkMaterial.forEach(m => {
                aggregatedText += (m.description || "") + "\n";
                if (m.materials) filesToProcess.push(...m.materials);
            });
        }

        // --- Step 2: Filter & Deduplicate Files ---
        const uniqueFiles = new Map();
        filesToProcess.forEach(mat => {
            if (mat.driveFile && mat.driveFile.driveFile) {
                const f = mat.driveFile.driveFile;
                const title = f.title.toLowerCase();
                if (title.endsWith('.pdf') || title.endsWith('.pptx')) {
                    if (!uniqueFiles.has(f.id)) {
                        uniqueFiles.set(f.id, f);
                    }
                }
            }
        });

        const fileList = Array.from(uniqueFiles.values());

        // --- Step 3: Process Files in Parallel (with Limit) ---
        if (fileList.length > 0) {
            loadText.innerText = `Processing ${fileList.length} documents...`;

            // map to promises
            const filePromises = fileList.map(file => downloadAndParseFile(file.id, file.title));

            // Wait for all
            const fileResults = await Promise.all(filePromises);

            fileResults.forEach((text, i) => {
                fileList[i].extractedText = text || '';
            });
        }

        console.log(`Classroom data logic completed.`);
        currentBaseText = aggregatedText;
        currentTextContent = aggregatedText; // Fallback
        currentFileList = fileList; // Save for download feature

        // Store both in cache
        courseContentCache[courseId] = {
            baseText: aggregatedText,
            text: aggregatedText,
            files: fileList
        };

        // Show Action Menu instead of direct generation
        switchView('action-menu');

    } catch (e) {
        console.error("Error fetching class data", e);
        const msg = e.result?.error?.message || e.message || "Unknown Error";
        document.getElementById('loading-text').innerText = `Error: ${msg}`;
    }
}

// -------------------------
// Manual File Upload Handler
// -------------------------
async function handleManualUpload(event) {
    const files = Array.from(event.target.files);
    if (!files.length) return;

    // Show quiz modal with loading state
    currentSubjectName = files.map(f => f.name).join(', ');
    document.getElementById('quiz-modal').classList.add('active');
    switchView('loading');

    // Reset file list and cache
    currentFileList = [];
    currentBaseText = '';
    currentTextContent = '';
    currentTextContentForOperation = '';

    try {
        for (const file of files) {
            const formData = new FormData();
            formData.append('file', file, file.name);

            const resp = await fetch('/api/parse-file', {
                method: 'POST',
                body: formData
            });

            if (!resp.ok) {
                console.warn(`Failed to parse ${file.name}`);
                continue;
            }

            const data = await resp.json();
            const text = data.text || '';

            currentFileList.push({
                id: file.name,
                title: file.name,
                extractedText: text
            });
            currentBaseText += text + '\n';
        }

        currentTextContent = currentBaseText;

        // Set menu headers
        const menuName = document.getElementById('menu-course-name');
        const menuBatch = document.getElementById('menu-course-batch');
        if (menuName) menuName.innerText = 'Uploaded Files';
        if (menuBatch) menuBatch.innerText = files.length + ' file(s)';

        switchView('action-menu');
    } catch (e) {
        alert('Upload failed: ' + e.message);
        document.getElementById('quiz-modal').classList.remove('active');
    }

    // Reset the file input so the same file can be uploaded again
    event.target.value = '';
}

// Reuse cache to prevent re-downloading same files
async function downloadAndParseFile(fileId, fileName) {
    const CACHE_KEY = `doc_cache_${fileId}`;

    // 1. Check Local Cache
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
        console.log(`Loaded ${fileName} from cache`);
        return cached;
    }

    try {
        // 2. Download from Drive
        const token = gapi.client.getToken().access_token;
        const directResp = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!directResp.ok) throw new Error("Download failed");
        const blob = await directResp.blob();

        // 3. Parse in Backend
        const formData = new FormData();
        formData.append("file", blob, fileName);

        const parseResp = await fetch('/api/parse-file', {
            method: 'POST',
            body: formData
        });

        const data = await parseResp.json();
        if (data.success) {
            // 4. Save to Cache (Limit size to avoid quota errors - e.g. store first 50kb)
            try {
                // simple length check, maybe trim if too huge
                const content = data.text;
                localStorage.setItem(CACHE_KEY, content);
            } catch (e) {
                console.warn("Cache full");
            }
            return data.text;
        }
        return null;

    } catch (e) {
        console.error(`Failed to parse ${fileName}`, e);
        return null; // Skip file on error
    }
}

// Deprecated: Old processMaterials function replaced by inline logic
// async function processMaterials(materials) { ... }

// New Functions for Action Menu interactions
function showFileSelectionFor(operation) {
    pendingOperation = operation;
    
    document.getElementById('op-course-name').innerText = currentSubjectName;
    document.getElementById('op-course-batch').innerText = document.getElementById('menu-course-batch').innerText;

    const opFileGrid = document.getElementById('operation-file-grid');
    if (!opFileGrid) return;
    opFileGrid.innerHTML = '';
    
    if (currentFileList.length === 0) {
        // No files, execute directly with base text
        executePendingOperation();
        return;
    }

    currentFileList.forEach((file, idx) => {
        const isPdf = file.title.toLowerCase().endsWith('.pdf');
        const icon = isPdf ? '📄' : '📊';
        
        const row = document.createElement('div');
        row.className = 'file-select-row';
        row.innerHTML = `
            <div class="file-info-col">
                <span class="file-icon">${icon}</span>
                <span class="file-title-text">${file.title}</span>
            </div>
            <div class="file-check-col">
                <input type="checkbox" class="op-file-checkbox file-checkbox" id="op-file-${idx}" value="${idx}" data-title="${file.title}" checked>
                <label for="op-file-${idx}"></label>
            </div>
        `;
        row.onclick = (e) => {
            if(e.target.tagName !== 'INPUT' && e.target.tagName !== 'LABEL') {
                const cb = row.querySelector('input[type="checkbox"]');
                cb.checked = !cb.checked;
            }
        };
        opFileGrid.appendChild(row);
    });

    // Reset select all checkbox
    const selectAllCb = document.getElementById('op-select-all');
    if (selectAllCb) selectAllCb.checked = true;

    switchView('operation-file-select');
}

function toggleAllOperationFiles(checkbox) {
    const isChecked = checkbox.checked;
    document.querySelectorAll('.op-file-checkbox').forEach(cb => {
        cb.checked = isChecked;
    });
}

function executePendingOperation() {
    let selectedText = currentBaseText || "";
    
    // Add selected files text
    const checkboxes = document.querySelectorAll('.op-file-checkbox:checked');
    checkboxes.forEach(cb => {
        const idx = cb.value;
        const file = currentFileList[idx];
        if (file && file.extractedText) selectedText += "\n" + file.extractedText;
    });

    if (selectedText.length < 50) {
        selectedText = `
            Subject: ${currentSubjectName}
            This is a generated study context because the classroom query returned limited text. 
            Key concepts in ${currentSubjectName} often include fundamental theories, practical applications, architecture, and core methodologies.
        `;
    }

    currentTextContentForOperation = selectedText;

    if (pendingOperation === 'topics') {
        generateTopics(selectedText);
    } else if (pendingOperation === 'quiz') {
        showQuizConfig();
    } else if (pendingOperation === 'summary') {
        startSummaryGeneration(selectedText);
    }
}

async function startTopicsGeneration() {
    await generateTopics(currentTextContentForOperation || currentTextContent);
}

function showQuizConfig() {
    document.getElementById('config-course-name').innerText = currentSubjectName;
    document.getElementById('config-course-batch').innerText = document.getElementById('menu-course-batch').innerText;

    // Initialize Pill Click Listeners
    setupPills();

    switchView('quiz-config');
}

function setupPills() {
    const pillGroups = ['pill-num-questions', 'pill-difficulty', 'pill-timer'];
    pillGroups.forEach(groupId => {
        const group = document.getElementById(groupId);
        if (!group) return;
        group.querySelectorAll('.pill-option').forEach(pill => {
            pill.onclick = () => {
                group.querySelectorAll('.pill-option').forEach(p => p.classList.remove('selected'));
                pill.classList.add('selected');
            };
        });
    });
}

async function startQuizFromConfig() {
    const numQPill = document.querySelector('#pill-num-questions .selected');
    const diffPill = document.querySelector('#pill-difficulty .selected');
    const timerPill = document.querySelector('#pill-timer .selected');

    const numQ = numQPill ? numQPill.dataset.value : 10;
    const diff = diffPill ? diffPill.dataset.value : "Medium";
    const timerValue = timerPill ? timerPill.dataset.value : "disable";

    isTimerEnabled = (timerValue === 'enable');
    await startQuizFlow(numQ, diff);
}

async function generateTopics(text) {
    switchView('loading');
    document.getElementById('loading-text').innerText = "AI is analyzing key concepts...";

    try {
        const settings = getSettings();
        const response = await fetch('/api/generate-topics', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text: text,
                provider: settings.provider,
                model: settings.model
            })
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || "Failed to generate topics");
        }

        const data = await response.json();

        // Update Topic UI Header
        document.getElementById('topics-course-name').innerText = currentSubjectName;
        // Batch already set in loadCourseMaterials, but let's ensure consistency if needed

        // Render Topics as Pills
        const grid = document.getElementById('topics-pills-grid');
        grid.innerHTML = '';

        data.topics.forEach((t, idx) => {
            const btn = document.createElement('div');
            btn.className = 'topic-pill-btn';
            btn.innerText = t.topic;
            btn.style.animationDelay = `${idx * 60}ms`;
            btn.onclick = () => showTopicExplanation(t.topic);
            grid.appendChild(btn);
        });

        showTopicsGrid(); // Ensure grid view is visible
        switchView('topics');

    } catch (e) {
        alert("AI Error: " + e.message);
        switchView('action-menu');
    }
}

async function showTopicExplanation(topicName) {
    // UI Transitions
    document.getElementById('topics-grid-container').style.display = 'none';
    document.getElementById('topic-explanation-container').style.display = 'block';

    document.getElementById('selected-topic-pill-container').style.display = 'block';
    document.getElementById('selected-topic-name').innerText = topicName;

    document.getElementById('btn-topics-back').style.display = 'none';
    document.getElementById('btn-explanation-back').style.display = 'block';

    const contentArea = document.getElementById('topic-explanation-text');
    contentArea.innerHTML = '<div class="spinner"></div><p style="text-align:center">AI is preparing a detailed explanation...</p>';

    try {
        const settings = getSettings();
        const response = await fetch('/api/explain-topic', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text: currentTextContentForOperation || currentTextContent,
                topic: topicName,
                provider: settings.provider,
                model: settings.model
            })
        });

        if (!response.ok) throw new Error("Explanation failed");

        const data = await response.json();

        // Use Markdown parser for a nice look
        contentArea.innerHTML = parseMarkdown(data.explanation);

    } catch (e) {
        contentArea.innerHTML = `<p style="color:red">Error: ${e.message}</p>`;
    }
}

function showTopicsGrid() {
    document.getElementById('topics-grid-container').style.display = 'block';
    document.getElementById('topic-explanation-container').style.display = 'none';

    document.getElementById('selected-topic-pill-container').style.display = 'none';

    document.getElementById('btn-topics-back').style.display = 'block';
    document.getElementById('btn-explanation-back').style.display = 'none';
}

async function startQuizFlow(numQuestions = 5, difficulty = "Medium") {
    switchView('loading');
    document.getElementById('loading-text').innerText = `Generating ${numQuestions} ${difficulty} Questions...`;

    try {
        let adapterTextContext = currentTextContentForOperation || currentTextContent;
        if (wrongQuestionsContext.length > 0) {
            adapterTextContext += "\n\n--- PREVIOUS USER STRUGGLES ---\n" +
                "The user previously got these topics wrong. Please focus heavily on these areas to reinforce learning:\n" +
                wrongQuestionsContext.join("\n");
        }

        const settings = getSettings();
        const response = await fetch('/api/generate-quiz', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text: adapterTextContext,
                provider: settings.provider,
                model: settings.model,
                numQuestions: parseInt(numQuestions),
                difficulty: difficulty
            })
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || "Failed to generate quiz");
        }

        const data = await response.json();

        currentQuiz = data.quiz.questions;
        currentQuestionIndex = 0;
        userScore = 0;
        correctCount = 0;
        wrongCount = 0;
        secondsElapsed = 0;
        wrongQuestionsContext = []; // Reset struggles context for a fresh start

        if (!currentQuiz || currentQuiz.length === 0) {
            throw new Error("AI returned no questions. Try again.");
        }

        // Setup Header Stats in Active Quiz
        document.getElementById('active-course-name').innerText = currentSubjectName;
        document.getElementById('active-course-batch').innerText = document.getElementById('menu-course-batch').innerText;

        showQuestion();
        switchView('quiz');

        if (isTimerEnabled) {
            startTimer();
        } else {
            document.getElementById('quiz-timer-display').style.display = 'none';
        }

    } catch (e) {
        alert("Quiz Gen Error: " + e.message);
        switchView('action-menu');
    }
}

function startTimer() {
    document.getElementById('quiz-timer-display').style.display = 'block';
    if (quizTimer) clearInterval(quizTimer);
    quizTimer = setInterval(() => {
        secondsElapsed++;
        const mins = Math.floor(secondsElapsed / 60).toString().padStart(2, '0');
        const secs = (secondsElapsed % 60).toString().padStart(2, '0');
        document.getElementById('quiz-timer-display').innerText = `Time: ${mins}:${secs}`;
    }, 1000);
}

async function startSummaryGeneration() {
    switchView('loading');
    document.getElementById('loading-text').innerText = "Creating Course Summary...";

    try {
        const settings = getSettings();
        const response = await fetch('/api/generate-summary', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text: typeof textToUse === 'string' ? textToUse : currentTextContentForOperation || currentTextContent,
                provider: settings.provider,
                model: settings.model
            })
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || "Summary gen failed");
        }

        const data = await response.json();

        // Update Header placeholders
        document.getElementById('summary-course-name').innerText = currentSubjectName;
        document.getElementById('summary-course-batch').innerText = document.getElementById('menu-course-batch').innerText;

        // Use the new Markdown Parser
        const formattedSummary = parseMarkdown(data.summary);

        document.getElementById('summary-content').innerHTML = formattedSummary;
        switchView('summary');

    } catch (e) {
        alert("Error: " + e.message);
        switchView('action-menu');
    }
}

async function downloadAllMaterials() {
    const files = currentFileList.filter(f => {
        const t = f.title.toLowerCase();
        return t.endsWith('.pdf') || t.endsWith('.pptx');
    });

    if (files.length === 0) {
        alert("No downloadable materials (PDF/PPTX) found in this course.");
        return;
    }

    // UI Feedback: Change the "Materials" card text or show a global alert
    alert(`Bundling ${files.length} files... Please wait a moment.`);

    const zip = new JSZip();
    const token = gapi.client.getToken().access_token;

    // Fetch all files in parallel for maximum speed
    const fetchPromises = files.map(async (file) => {
        try {
            console.log(`Fetching: ${file.title}`);
            const response = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (!response.ok) throw new Error(`Download failed for ${file.title}`);

            const blob = await response.blob();
            zip.file(file.title, blob);
            return true;
        } catch (e) {
            console.error(`Error fetching ${file.title}:`, e);
            return false;
        }
    });

    try {
        await Promise.all(fetchPromises);

        // Generate the ZIP file
        const content = await zip.generateAsync({ type: "blob" });

        // Trigger download of the single ZIP file
        const url = window.URL.createObjectURL(content);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        const zipName = `${currentSubjectName.replace(/\s+/g, '_')}_Materials.zip`;
        a.download = zipName;
        document.body.appendChild(a);
        a.click();

        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);

        console.log("ZIP Download started.");
    } catch (e) {
        console.error("ZIP Generation failed:", e);
        alert("Failed to bundle files. Check console for details.");
    }
}

// -------------------------
// Helper: Simple Markdown Parser
// -------------------------
function parseMarkdown(text) {
    if (!text) return "";

    let lines = text.split('\n');
    let html = '';
    let inList = false;

    lines.forEach(line => {
        line = line.trim();
        if (!line) {
            if (inList) {
                html += '</ul>';
                inList = false;
            }
            return;
        }

        // Headers
        if (line.startsWith('### ')) {
            html += `<h4>${line.substring(4)}</h4>`;
        } else if (line.startsWith('## ')) {
            html += `<h3>${line.substring(3)}</h3>`;
        } else if (line.startsWith('# ')) {
            html += `<h3>${line.substring(2)}</h3>`;
        }
        // Lists
        else if (line.startsWith('- ') || line.startsWith('* ')) {
            if (!inList) {
                html += '<ul>';
                inList = true;
            }
            html += `<li>${line.substring(2)}</li>`;
        }
        // Normal paragraphs
        else {
            if (inList) {
                html += '</ul>';
                inList = false;
            }
            // Add bold/italic
            let formatted = line
                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                .replace(/\*(.*?)\*/g, '<em>$1</em>');
            html += `<p>${formatted}</p>`;
        }
    });

    if (inList) html += '</ul>';

    return html;
}

function showQuestion() {
    const q = currentQuiz[currentQuestionIndex];

    // UI Stats Updates
    const timerDisplay = document.getElementById('quiz-timer-display');
    const qnoDisplay = document.getElementById('quiz-qno-display');
    const qText = document.getElementById('question-text');

    if (qnoDisplay) qnoDisplay.innerText = `Q.No. ${currentQuestionIndex + 1}/${currentQuiz.length}`;
    if (qText) qText.innerText = `${currentQuestionIndex + 1}. ${q.question}`;

    // Hint setup
    const hintContainer = document.getElementById('hint-container');
    const hintText = document.getElementById('hint-text');
    if (q.hint) {
        hintContainer.style.display = 'block';
        hintText.innerText = q.hint;
        hintText.style.display = 'none';
        const hintBtn = document.querySelector('.btn-hint');
        if (hintBtn) hintBtn.innerText = '💡 Show Hint';
    } else {
        hintContainer.style.display = 'none';
    }

    // Options setup
    const optionsContainer = document.getElementById('options-container');
    optionsContainer.innerHTML = '';

    // Rationale hidden
    document.getElementById('rationale-container').style.display = 'none';
    document.getElementById('next-question-btn').style.display = 'none';

    // Compatibility check for old vs new AI structure
    const options = q.answerOptions || q.options.map(opt => ({ text: opt, isCorrect: opt === q.correct, rationale: "" }));

    options.forEach(opt => {
        const btn = document.createElement('div');
        btn.className = 'option-btn';
        btn.innerText = opt.text;
        btn.onclick = () => handleAnswer(btn, opt, options);
        optionsContainer.appendChild(btn);
    });
}

function toggleHint() {
    const hintText = document.getElementById('hint-text');
    const btn = document.querySelector('.btn-hint');
    if (hintText.style.display === 'none') {
        hintText.style.display = 'block';
        btn.innerText = 'Hide Hint';
    } else {
        hintText.style.display = 'none';
        btn.innerText = '💡 Show Hint';
    }
}

function handleAnswer(btn, selectedOpt, allOptions) {
    // Disable all buttons
    const allBtns = document.querySelectorAll('.option-btn');
    allBtns.forEach(b => b.style.pointerEvents = 'none');

    const isCorrect = selectedOpt.isCorrect;
    const statusLabel = document.getElementById('answer-status-label');

    if (isCorrect) {
        btn.classList.add('correct');
        userScore++;
        correctCount++;
        if (statusLabel) {
            statusLabel.innerText = 'Correct!';
            statusLabel.style.color = 'var(--success)';
        }
    } else {
        btn.classList.add('wrong');
        wrongCount++;
        if (statusLabel) {
            statusLabel.innerText = 'Incorrect';
            statusLabel.style.color = 'var(--error)';
        }
        // Track wrong topic for adaptive quiz
        const q = currentQuiz[currentQuestionIndex];
        if (q && q.question) wrongQuestionsContext.push(q.question);
        // Find correct button and highlight it
        allBtns.forEach(b => {
            const opt = allOptions.find(o => o.text === b.innerText);
            if (opt && opt.isCorrect) b.classList.add('correct');
        });
    }

    // Show rationale
    const rationaleContainer = document.getElementById('rationale-container');
    const rationaleText = document.getElementById('rationale-text');
    if (selectedOpt.rationale) {
        rationaleContainer.style.display = 'block';
        rationaleText.innerText = selectedOpt.rationale;
    }

    // Show next button
    document.getElementById('next-question-btn').style.display = 'block';
}

function nextQuestion() {
    currentQuestionIndex++;
    if (currentQuestionIndex < currentQuiz.length) {
        showQuestion();
    } else {
        showResults();
    }
}

function showResults() {
    if (quizTimer) clearInterval(quizTimer);

    const percentage = Math.round((userScore / currentQuiz.length) * 100);
    const circle = document.getElementById('final-score-display');
    circle.style.setProperty('--score', percentage);
    circle.innerHTML = `<div>${percentage}%</div>`;

    // Update Counts
    document.getElementById('correct-count').innerText = correctCount;
    document.getElementById('wrong-count').innerText = wrongCount;

    let feedback = "Good effort!";
    if (percentage === 100) feedback = "Perfect Score! You are a master.";
    else if (percentage >= 80) feedback = "Excellent work!";
    else if (percentage < 60) feedback = "You might want to review the topics again.";

    document.getElementById('feedback-text').innerText = feedback;
    switchView('results');
}

// 6. UI Utilities

let isAssistantView = false;

function toggleAssistantView() {
    const coursesView = document.getElementById('courses-view');
    const assistantView = document.getElementById('assistant-view');
    const assistantBtn = document.getElementById('assistant-toggle-btn');

    if (!isAssistantView) {
        // Entering Assistant View
        coursesView.style.display = 'none';
        assistantView.style.display = 'flex';

        if (assistantBtn) {
            assistantBtn.innerText = '← Courses';
        }

        // Show prompt/topics, hide history
        const promptTitle = document.querySelector('.assistant-prompt');
        const topicsEl = document.getElementById('assistant-topics');
        const responseContainer = document.getElementById('assistant-response-container');

        if (promptTitle) promptTitle.style.display = 'block';
        if (topicsEl) topicsEl.style.display = 'flex';
        if (responseContainer) responseContainer.style.display = 'none';

        // Reset conversation context
        currentAssistantChatContext = [];
        const chatHistory = document.getElementById('assistant-chat-history');
        if (chatHistory) chatHistory.innerHTML = '';

        isAssistantView = true;
        populateAssistantTopics();
    } else {
        // Returning to Courses
        coursesView.style.display = 'block';
        assistantView.style.display = 'none';

        if (assistantBtn) {
            assistantBtn.innerText = 'Assistant';
        }

        isAssistantView = false;
    }
}

function populateAssistantTopics() {
    const container = document.getElementById('assistant-topics');
    if (!allLoadedCourses || allLoadedCourses.length === 0) return;

    container.innerHTML = '';
    // Show up to 6 courses as quick starting points
    allLoadedCourses.slice(0, 6).forEach(course => {
        const pill = document.createElement('div');
        pill.className = 'discussion-pill';
        pill.innerText = course.name;
        pill.onclick = () => sendAssistantQuery(`Explain key concepts for ${course.name}`);
        container.appendChild(pill);
    });
}

async function sendAssistantQuery(manualQuery = null) {
    const input = document.getElementById('chat-input');
    const query = manualQuery || input.value.trim();
    const responseContainer = document.getElementById('assistant-response-container');
    const chatHistory = document.getElementById('assistant-chat-history');
    const promptTitle = document.querySelector('.assistant-prompt');

    if (!query) return;

    // UI Updates
    if (promptTitle) promptTitle.style.display = 'none';
    const topicsEl = document.getElementById('assistant-topics');
    if (topicsEl) topicsEl.style.display = 'none';
    
    responseContainer.style.display = 'block';

    // Append User Message
    const userMsg = document.createElement('div');
    userMsg.className = 'chat-message user-message';
    userMsg.innerHTML = `<div class="message-content">${query}</div>`;
    chatHistory.appendChild(userMsg);

    // Clear input early
    if (!manualQuery) input.value = '';

    // Append Temp AI Message
    const aiMsg = document.createElement('div');
    aiMsg.className = 'chat-message ai-message response-card';
    aiMsg.style.padding = '1.5rem';
    aiMsg.innerHTML = '<div style="display:flex; gap:1rem; align-items:center;">' +
        '<div class="spinner"></div>' +
        '<p style="margin:0; font-size: 0.9em; color: var(--text-secondary);">Thinking...</p></div>';
    chatHistory.appendChild(aiMsg);
    
    // Scroll to newly added msg
    aiMsg.scrollIntoView({ behavior: 'smooth', block: 'end' });
    
    // Context Builder
    currentAssistantChatContext.push(`User: ${query}`);
    let baseRef = currentTextContentForOperation || currentTextContent || "";
    // If no text, provide empty. The backend logic will handle fallback if needed, but here we provide context from what was scanned.
    
    const compiledContext = currentAssistantChatContext.join("\n") + "\n\n--- Base Course Reference Material ---\n" + baseRef.substring(0, 5000);

    const settings = getSettings();
    try {
        const response = await fetch('/api/explain-topic', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text: compiledContext,
                topic: query,
                provider: settings.provider,
                model: settings.model
            })
        });

        const data = await response.json();
        if (data.success) {
            // Use full markdown parser for clean formatting
            const html = parseMarkdown(data.explanation);

            // Find model nice name
            let modelNameForReply = "AI Assistant";
            if (settings && settings.model) {
                Object.keys(AI_CONFIG).forEach(providerKey => {
                    const match = AI_CONFIG[providerKey].models.find(m => m.id === settings.model);
                    if (match) modelNameForReply = match.name;
                });
            }
            const modelTag = `<div class="ai-model-tag">Responded using: ${modelNameForReply}</div>`;

            // Wrap in a single bubble div — NOT a <p> — to avoid multi-column
            aiMsg.className = 'chat-message ai-message';
            aiMsg.style.padding = '';
            aiMsg.innerHTML = `<div class="ai-bubble">${html}${modelTag}</div>`;

            // Scroll new message into view
            aiMsg.scrollIntoView({ behavior: 'smooth', block: 'end' });

            // Save AI Context
            currentAssistantChatContext.push(`Assistant: ${data.explanation}`);
        } else {
            aiMsg.innerHTML = `<div style="color: var(--error);">AI Error: ${data.error}</div>`;
        }
    } catch (err) {
        aiMsg.innerHTML = `<div style="color: var(--error);">Connection failed.</div>`;
    }
}

// Add event listener for Enter in chat-input
document.addEventListener('DOMContentLoaded', () => {
    const chatInput = document.getElementById('chat-input');
    if (chatInput) {
        chatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendAssistantQuery();
            }
        });

        // Auto-resize
        chatInput.addEventListener('input', function () {
            this.style.height = 'auto';
            this.style.height = (this.scrollHeight) + 'px';
        });
    }

    // Make Pills clickable
    document.querySelectorAll('.discussion-pill').forEach(pill => {
        pill.addEventListener('click', () => {
            sendAssistantQuery(pill.innerText);
        });
    });
});

const FUNNY_MESSAGES = [
    "Waking up the AI from its nap...",
    "Brewing digital coffee for the processor...",
    "Analyzing your materials (and judging your font choices)...",
    "Counting to infinity... twice...",
    "Herding the data packets...",
    "Consulting the grand oracle of Google...",
    "Searching for the answer to life, the universe, and everything...",
    "Translating professor-speak into human-speak...",
    "Feeding hamsters to power the servers...",
    "Spinning up the anti-gravity engines..."
];

let loadingInterval = null;

function animateLoadingText(containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;
    
    if (loadingInterval) clearInterval(loadingInterval);
    
    // Set first message immediately
    el.innerText = FUNNY_MESSAGES[Math.floor(Math.random() * FUNNY_MESSAGES.length)];
    
    loadingInterval = setInterval(() => {
        const msg = FUNNY_MESSAGES[Math.floor(Math.random() * FUNNY_MESSAGES.length)];
        el.innerText = msg;
        el.style.animation = 'none';
        void el.offsetWidth; // trigger reflow
        el.style.animation = 'pulseText 1s ease';
    }, 2500);
}

function stopLoadingAnimation() {
    if (loadingInterval) clearInterval(loadingInterval);
}

function switchView(viewName) {
    if (viewName !== 'loading') stopLoadingAnimation();

    // Hide all
    document.querySelectorAll('.quiz-view').forEach(el => el.style.display = 'none');
    // Show target
    document.getElementById(`view-${viewName}`).style.display = 'block';

    if (viewName === 'loading') animateLoadingText('loading-text');
}

function closeQuiz() {
    document.getElementById('quiz-modal').classList.remove('active');
}

