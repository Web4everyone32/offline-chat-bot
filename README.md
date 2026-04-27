# ⚖️ Niglen — Offline Indian Legal AI Chatbot v2.3

A fully offline, privacy-first AI legal assistant specialized in Indian law, powered by a fine-tuned LLaMA 3 model and Retrieval-Augmented Generation (RAG). No cloud, no API keys, no data leaving your machine.

---

## ✨ Features

- 🔒 **100% Offline** — All AI inference runs locally via Ollama
- 🧠 **Fine-tuned LLaMA 3** — Trained on 134,828 Indian legal Q&A pairs
- ⚖️ **Indian Legal Domain** — Specialized in IPC, Constitution, Consumer Law, Contract Law, Arbitration
- 📚 **277,742 Legal Q&A Pairs** — Powered by 169Pi/indian_law HuggingFace dataset
- 🌍 **Global Knowledge Base** — Dataset available across ALL conversations automatically
- 📄 **PDF + TXT Chat (RAG)** — Upload legal documents and ask questions grounded in their content
- 💾 **Persistent Storage** — PDFs, embeddings and chat history saved permanently
- ⚡ **Streaming Responses** — Tokens stream in real time
- 🌐 **Multilingual** — Auto-detects language; supports English, Tamil, Hindi, Malayalam, French, Spanish, German, Japanese
- 🌙 **Dark Mode** — Toggle between light and dark themes
- 📁 **Document Manager** — View and remove uploaded PDFs per session
- 💬 **Multi-conversation** — Manage multiple chat sessions from the sidebar
- 🛡️ **Safety Guardrails** — Refuses non-legal questions and harmful content
- 📝 **Markdown Rendering** — Responses render bold, lists, code blocks, and headers
- ⚡ **Lazy Loading** — Server starts instantly, global knowledge loads in background

---

## 🏗️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + Vite |
| Backend | Node.js + Express |
| AI Runtime | Ollama (local) |
| Chat Model | legal-bot-finetuned (LLaMA 3.1 8B fine-tuned) |
| Embedding Model | nomic-embed-text |
| Vector Search | Cosine similarity RAG |
| PDF Parsing | pdf-parse |
| Fine-tuning | Unsloth + LoRA on Google Colab T4 |
| Dataset | 169Pi/indian_law (HuggingFace) |
| Storage | Per-file JSON (stream read/write) |

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org) v18+
- [Ollama](https://ollama.com/download)
- [Python 3](https://python.org)

### 1. Install Ollama & pull models

```bash
ollama serve
```

In a new terminal:

```bash
ollama pull llama3
ollama pull nomic-embed-text
```

### 2. Create the legal-bot model

```bash
cd server
ollama create legal-bot -f Modelfile
```

### 3. Start the backend

```bash
cd server
npm install
copy .env.example.env .env
npm run dev
```

Server runs on → `http://localhost:8080`

### 4. Start the frontend

```bash
cd web
npm install
npm run dev
```

App runs on → `http://localhost:5173`

---

## 🧠 Fine-Tuned Model Setup

The chatbot includes a fine-tuned version of LLaMA 3.1 8B trained on 134,828 Indian legal Q&A pairs.

### Training Details

| Setting | Value |
|---|---|
| Base Model | LLaMA 3.1 8B Instruct |
| Method | LoRA fine-tuning via Unsloth |
| Dataset | 169Pi/indian_law (HuggingFace) |
| Training steps | 1,000 (initial) |
| GPU | Google Colab T4 |
| Output format | GGUF q8_0 (~8.5GB) |

### To use the fine-tuned model

1. Download `legal-llama3.gguf` and place it in the server folder
2. Create the model in Ollama:
```bash
ollama create legal-bot-finetuned -f Modelfile-finetuned
```
3. Update `server/src/index.js`:
```js
const CHAT_MODEL = "legal-bot-finetuned";
```
4. Restart server

---

## 📚 Setting Up the Legal Knowledge Base

### Step 1 — Download the dataset

```python
pip install datasets

# Run download_dataset.py
from datasets import load_dataset

dataset = load_dataset("169Pi/indian_law", split="train")

with open("indian_law_knowledge.txt", "w", encoding="utf-8") as f:
    for item in dataset:
        f.write(f"Q: {item['prompt']}\nA: {item['response']}\n\n")
```

### Step 2 — Split into parts

```bash
python split_dataset.py
```

### Step 3 — Upload all parts as global knowledge

```bash
upload_all.bat
```

---

## 📁 Project Structure
niglen/
├── server/
│   ├── src/
│   │   └── index.js          # Express API, RAG, SSE streaming, lazy loading
│   ├── Modelfile             # legal-bot domain configuration
│   ├── Modelfile-finetuned   # Fine-tuned model configuration
│   ├── global_knowledge/     # Permanent global dataset (not in git)
│   ├── storage/              # Per-conversation storage (not in git)
│   └── package.json
└── web/
├── src/
│   ├── App.jsx           # React UI with streaming + markdown
│   └── styles.css        # Design system with dark mode
└── package.json

---

## 🔌 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Server health check |
| POST | `/global/upload` | Upload to global knowledge base |
| GET | `/global/docs` | List global documents |
| DELETE | `/global/doc/:id` | Remove a global document |
| POST | `/session` | Create a new chat session |
| GET | `/sessions` | List all sessions |
| PATCH | `/session/:id` | Rename a session |
| DELETE | `/session/:id` | Delete a session |
| POST | `/upload` | Upload session-specific document |
| GET | `/session/:id/docs` | List session documents |
| DELETE | `/session/:id/doc/:docId` | Remove a session document |
| POST | `/chat` | Send message (SSE stream) |

---

## ⚠️ Troubleshooting

| Problem | Fix |
|---------|-----|
| "Engine error" | Run `ollama serve` |
| `legal-bot` not found | Run `ollama create legal-bot -f Modelfile` |
| `legal-bot-finetuned` not found | Run `ollama create legal-bot-finetuned -f Modelfile-finetuned` |
| Upload fails | Ensure server is running on port 8080 |
| `cp` not recognized (Windows) | Use `copy` instead |
| Server takes long to start | Global knowledge is lazy loading — wait 2-3 mins |
| Global knowledge shows 0 | Re-run `upload_all.bat` |

---

## 📄 License

MIT — free to use, modify, and distribute.
