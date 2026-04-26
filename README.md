# ⚖️ Niglen — Offline Indian Legal AI Chatbot v2.3

A fully offline, privacy-first AI legal assistant specialized in Indian law, powered by LLaMA 3 and Retrieval-Augmented Generation (RAG). No cloud, no API keys, no data leaving your machine.

---

## ✨ Features

- 🔒 **100% Offline** — All AI inference runs locally via Ollama
- ⚖️ **Indian Legal Domain** — Trained exclusively on Indian law via Modelfile
- 📚 **277,742 Legal Q&A Pairs** — Powered by the 169Pi/indian_law HuggingFace dataset
- 🌍 **Global Knowledge Base** — Dataset available across ALL conversations automatically
- 📄 **PDF + TXT Chat (RAG)** — Upload legal documents and ask questions grounded in their content
- 💾 **Persistent Storage** — PDFs, embeddings and chat history saved permanently across restarts
- ⚡ **Streaming Responses** — Tokens stream in real time as the AI thinks
- 🌐 **Multilingual** — Auto-detects language; supports English, Tamil, Hindi, Malayalam, French, Spanish, German, Japanese
- 🌙 **Dark Mode** — Toggle between light and dark themes
- 📁 **Document Manager** — View and remove uploaded PDFs per session
- 💬 **Multi-conversation** — Manage multiple chat sessions from the sidebar
- 🛡️ **Safety Guardrails** — Refuses non-legal questions and harmful content
- 📝 **Markdown Rendering** — Responses render bold, lists, code blocks, and headers

---

## 🏗️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + Vite |
| Backend | Node.js + Express |
| AI Runtime | Ollama (local) |
| Chat Model | legal-bot (LLaMA 3 via Modelfile) |
| Embedding Model | nomic-embed-text |
| Vector Search | Cosine similarity (in-memory RAG) |
| PDF Parsing | pdf-parse |
| Storage | Per-file JSON (stream read/write) |
| Dataset | 169Pi/indian_law (HuggingFace) |

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org) v18+
- [Ollama](https://ollama.com/download)
- [Python 3](https://python.org) (for dataset setup)

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

## 📚 Setting Up the Legal Knowledge Base

The global knowledge base (277k Q&A pairs) is not included in this repo due to file size. Set it up once:

### Step 1 — Download the dataset

```python
pip install datasets
```

Create `download_dataset.py` in the server folder:

```python
from datasets import load_dataset

dataset = load_dataset("169Pi/indian_law", split="train")

with open("indian_law_knowledge.txt", "w", encoding="utf-8") as f:
    for item in dataset:
        f.write(f"Q: {item['prompt']}\nA: {item['response']}\n\n")

print(f"Done! {len(dataset)} entries saved.")
```

```bash
python download_dataset.py
```

### Step 2 — Split into parts

Create `split_dataset.py`:

```python
import os

with open("indian_law_knowledge.txt", "r", encoding="utf-8") as f:
    entries = f.read().strip().split("\n\n")

os.makedirs("legal_chunks", exist_ok=True)
chunk_size = 10000
chunks = [entries[i:i+chunk_size] for i in range(0, len(entries), chunk_size)]

for i, chunk in enumerate(chunks):
    with open(f"legal_chunks/law_part_{i+1}.txt", "w", encoding="utf-8") as f:
        f.write("\n\n".join(chunk))
    print(f"Saved part {i+1}")
```

```bash
python split_dataset.py
```

### Step 3 — Upload all parts as global knowledge

Create `upload_all.bat` in server folder:

```bat
@echo off
for /L %%i in (1,1,28) do (
    echo Uploading part %%i of 28...
    curl -X POST http://localhost:8080/global/upload -F "file=@legal_chunks/law_part_%%i.txt"
    timeout /t 5
)
echo All parts uploaded!
```

```bash
upload_all.bat
```

Each part takes 3–4 minutes. Once done, all 28 parts are saved permanently in `global_knowledge/` and load automatically on every server restart.

---

## 📁 Project Structure
niglen/
├── server/
│   ├── src/
│   │   └── index.js          # Express API, RAG pipeline, global knowledge, SSE streaming
│   ├── Modelfile             # Legal-bot domain configuration for Ollama
│   ├── global_knowledge/     # Permanent global dataset storage (not in git)
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
| POST | `/global/upload` | Upload file to global knowledge base |
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
| "Engine error" in chat | Run `ollama serve` in a terminal |
| `legal-bot` not found | Run `ollama create legal-bot -f Modelfile` |
| Upload fails | Ensure server is running on port 8080 |
| `cp` not recognized (Windows) | Use `copy` instead of `cp` |
| storage.json error | Run `del storage.json` and restart server |
| Global knowledge shows 0 | Re-run `upload_all.bat` to reload dataset |

---

## 📄 License

MIT — free to use, modify, and distribute.
