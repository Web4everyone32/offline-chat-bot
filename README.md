🤖 Niglen — Offline AI Chatbot v2
A fully offline, privacy-first AI chatbot with PDF document intelligence. Built with Node.js, React, and Ollama — no cloud, no API keys, no data leaving your machine.

✨ Features
🔒 100% Offline — All AI inference runs locally via Ollama
📄 PDF Chat (RAG) — Upload PDFs and ask questions grounded in their content
⚡ Streaming Responses — Tokens stream in real time as the AI thinks
🌍 Multilingual — Auto-detects language; supports English, Tamil, Hindi, Malayalam, French, Spanish, German, Japanese
🌙 Dark Mode — Toggle between light and dark themes
📁 Document Manager — View and remove uploaded PDFs per session
💬 Multi-conversation — Manage multiple chat sessions from the sidebar
🛡️ Safety Guardrails — Built-in content filtering on inputs and outputs
📝 Markdown Rendering — Responses render bold, lists, code blocks, and headers
🏗️ Tech Stack
Layer	Technology
Frontend	React 18 + Vite
Backend	Node.js + Express
AI Runtime	Ollama (local)
Chat Model	LLaMA 3
Embedding Model	nomic-embed-text
Vector Search	Cosine similarity (in-memory)
PDF Parsing	pdf-parse
🚀 Getting Started
Prerequisites
Node.js v18+
Ollama
1. Install Ollama & pull models
ollama serve
In a new terminal:

ollama pull llama3
ollama pull nomic-embed-text
2. Start the backend
cd server
npm install
copy .env.example.env .env
npm run dev
Server runs on → http://localhost:8080

3. Start the frontend
cd web
npm install
npm run dev
App runs on → http://localhost:5173

📁 Project Structure
niglen/ ├── server/ │ ├── src/ │ │ └── index.js # Express API, RAG pipeline, SSE streaming │ └── package.json └── web/ ├── src/ │ ├── App.jsx # React UI with streaming + markdown │ └── styles.css # Design system with dark mode └── package.json

🔌 API Endpoints
Method	Endpoint	Description
GET	/health	Server health check
POST	/session	Create a new chat session
GET	/sessions	List all sessions
PATCH	/session/:id	Rename a session
DELETE	/session/:id	Delete a session
POST	/upload	Upload and index a PDF
GET	/session/:id/docs	List documents in session
DELETE	/session/:id/doc/:docId	Remove a document
POST	/chat	Send message (SSE stream)
⚠️ Troubleshooting
Problem	Fix
"Multilingual engine error"	Run ollama serve in a terminal
Upload fails	Ensure server is running on port 8080
llama3 not found	Run ollama pull llama3 and wait for completion
cp not recognized (Windows)	Use copy instead of cp
Port conflict	Edit server/.env and update API in web/src/App.jsx
📄 License
MIT — free to use, modify, and distribute.
