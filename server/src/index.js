import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs";
import crypto from "crypto";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

const app = express();
app.use(cors());
app.use(express.json({ limit: "280mb" }));

const upload = multer({ dest: "uploads/", limits: { fileSize: 280 * 1024 * 1024 } });

const OLLAMA_URL = "http://localhost:11434";
const CHAT_MODEL = "legal-bot";
const EMBED_MODEL = "nomic-embed-text";
const CHUNK_SIZE = 800;
const CHUNK_OVERLAP = 150;
const TOP_K = 6;
const MAX_GLOBAL_CHUNKS = 155000;
const STORAGE_DIR = "./storage";
const GLOBAL_DIR = "./global_knowledge";

const BANNED = ["kill","suicide","bomb","terror","porn","rape","nude","hate","racist","violence"];
function isUnsafe(text = "") {
  const t = text.toLowerCase();
  return BANNED.some(w => t.includes(w));
}

if (!fs.existsSync(STORAGE_DIR)) fs.mkdirSync(STORAGE_DIR);
if (!fs.existsSync(GLOBAL_DIR)) fs.mkdirSync(GLOBAL_DIR);

// ─── GLOBAL KNOWLEDGE BASE ───
let globalDocs = [];

// Stream save — writes chunk by chunk to avoid string length crash
function saveGlobalDoc(doc) {
  return new Promise((resolve, reject) => {
    try {
      const filePath = `${GLOBAL_DIR}/${doc.id}.json`;
      const stream = fs.createWriteStream(filePath, { encoding: "utf-8" });

      const meta = {
        id: doc.id,
        name: doc.name,
        uploadedAt: doc.uploadedAt,
        pageCount: doc.pageCount,
        global: true
      };

      stream.write('{"meta":' + JSON.stringify(meta) + ',"chunks":[');

      const chunks = doc.chunks;
      for (let i = 0; i < chunks.length; i++) {
        const c = chunks[i];
        const entry = JSON.stringify({
          text: c.text,
          emb: Array.from(c.emb),
          norm: c.norm
        });
        stream.write(entry + (i < chunks.length - 1 ? "," : ""));
        if (i % 5000 === 0) console.log(`   💾 Writing chunk ${i}/${chunks.length}...`);
      }

      stream.write("]}");
      stream.end(() => {
        console.log(`🌍 Global doc saved: ${doc.name} (${chunks.length} chunks)`);
        resolve();
      });

      stream.on("error", (e) => {
        console.error(`Could not save global doc ${doc.name}:`, e.message);
        reject(e);
      });

    } catch (e) {
      console.error(`Could not save global doc ${doc.name}:`, e.message);
      reject(e);
    }
  });
}

async function loadGlobalDocFile(filePath) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let buffer = "";
    let metaStr = "";
    let metaParsed = false;
    let depth = 0;
    let currentObj = "";
    let inObj = false;

    const stream = fs.createReadStream(filePath, {
      encoding: "utf-8",
      highWaterMark: 64 * 1024
    });

    stream.on("data", (data) => {
      buffer += data;

      if (!metaParsed) {
        const metaEnd = buffer.indexOf('},"chunks":[');
        if (metaEnd !== -1) {
          metaStr = buffer.slice(0, metaEnd + 1).replace('{"meta":', "");
          buffer = buffer.slice(metaEnd + 12);
          metaParsed = true;
        }
      }

      if (metaParsed) {
        for (let i = 0; i < buffer.length; i++) {
          const ch = buffer[i];
          if (ch === "{") { depth++; inObj = true; }
          if (inObj) currentObj += ch;
          if (ch === "}" && inObj) {
            depth--;
            if (depth === 0) {
              try {
                const c = JSON.parse(currentObj);
                chunks.push({
                  text: c.text,
                  emb: new Float32Array(c.emb),
                  norm: c.norm
                });
                if (chunks.length % 10000 === 0)
                  console.log(`   📖 Parsed ${chunks.length} chunks...`);
              } catch {}
              currentObj = "";
              inObj = false;
            }
          }
        }
        buffer = "";
      }
    });

    stream.on("end", () => {
      try {
        const meta = metaStr ? JSON.parse(metaStr) : {};
        console.log(`   ✅ Loaded: ${meta.name} (${chunks.length} chunks)`);
        resolve({ ...meta, chunks });
      } catch (e) {
        reject(e);
      }
    });

    stream.on("error", reject);
  });
}

function loadGlobalDocs() {
  return [];  // Async load happens below
}

async function loadGlobalDocsAsync() {
  const docs = [];
  try {
    const files = fs.readdirSync(GLOBAL_DIR).filter(f => f.endsWith(".json"));
    for (const file of files) {
      try {
        console.log(`   📖 Loading: ${file}...`);
        const doc = await loadGlobalDocFile(`${GLOBAL_DIR}/${file}`);
        docs.push(doc);
        console.log(`   ✅ Loaded: ${doc.name} (${doc.chunks.length} chunks)`);
      } catch (e) {
        console.error(`Could not load global doc ${file}:`, e.message);
      }
    }
    console.log(`🌍 Loaded ${docs.length} global knowledge document(s).`);
  } catch (e) {
    console.error("Could not load global knowledge:", e.message);
  }
  return docs;
}

function deleteGlobalDoc(docId) {
  try {
    const f = `${GLOBAL_DIR}/${docId}.json`;
    if (fs.existsSync(f)) fs.unlinkSync(f);
    globalDocs = globalDocs.filter(d => d.id !== docId);
  } catch (e) {
    console.error("Could not delete global doc:", e.message);
  }
}

globalDocs = loadGlobalDocs();

// ─── PER-CONVERSATION STORAGE ───
function convToDisk(conv) {
  return {
    ...conv,
    docs: conv.docs.map(doc => ({
      ...doc,
      chunks: doc.chunks.map(c => ({ text: c.text, emb: Array.from(c.emb), norm: c.norm }))
    }))
  };
}

function convFromDisk(data) {
  return {
    ...data,
    docs: (data.docs || []).map(doc => ({
      ...doc,
      chunks: doc.chunks.map(c => ({ text: c.text, emb: new Float32Array(c.emb), norm: c.norm }))
    }))
  };
}

function saveConversation(id, conv) {
  try {
    fs.writeFileSync(`${STORAGE_DIR}/${id}.json`, JSON.stringify(convToDisk(conv)), "utf-8");
  } catch (e) {
    console.error(`Could not save conversation ${id}:`, e.message);
  }
}

function deleteConversation(id) {
  try {
    const f = `${STORAGE_DIR}/${id}.json`;
    if (fs.existsSync(f)) fs.unlinkSync(f);
  } catch {}
}

function loadStorage() {
  const map = new Map();
  try {
    const files = fs.readdirSync(STORAGE_DIR).filter(f => f.endsWith(".json"));
    for (const file of files) {
      try {
        const id = file.replace(".json", "");
        const raw = fs.readFileSync(`${STORAGE_DIR}/${file}`, "utf-8");
        map.set(id, convFromDisk(JSON.parse(raw)));
      } catch (e) {
        console.error(`Could not load ${file}:`, e.message);
      }
    }
    console.log(`📂 Loaded ${map.size} conversations from storage.`);
  } catch (e) {
    console.error("Could not load storage:", e.message);
  }
  return map;
}

const conversations = loadStorage();

// ─── HELPERS ───
function chunkText(text, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  const clean = text.replace(/\s+/g, " ").trim();
  const chunks = [];
  let i = 0;
  while (i < clean.length) {
    const end = Math.min(i + size, clean.length);
    chunks.push(clean.slice(i, end));
    if (end === clean.length) break;
    i = end - overlap;
  }
  return chunks;
}

function vecNorm(v) { let s = 0; for (const x of v) s += x * x; return Math.sqrt(s) || 1e-9; }
function cosine(a, an, b, bn) { let d = 0; for (let i = 0; i < a.length; i++) d += a[i] * b[i]; return d / (an * bn); }

async function embed(text) {
  const r = await fetch(`${OLLAMA_URL}/api/embeddings`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, prompt: text })
  });
  const j = await r.json();
  const v = new Float32Array(j.embedding);
  return { v, n: vecNorm(v) };
}

async function chatStream(system, messages, res) {
  const r = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: CHAT_MODEL, stream: true, messages: [{ role: "system", content: system }, ...messages] })
  });
  let full = "";
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const line of dec.decode(value).split("\n").filter(Boolean)) {
      try {
        const obj = JSON.parse(line);
        const token = obj?.message?.content || "";
        if (token) { full += token; res.write(`data: ${JSON.stringify({ token })}\n\n`); }
        if (obj.done) res.write(`data: ${JSON.stringify({ done: true, full })}\n\n`);
      } catch {}
    }
  }
  return full;
}

async function chatOnce(system, messages) {
  const r = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: CHAT_MODEL, stream: false, messages: [{ role: "system", content: system }, ...messages] })
  });
  return (await r.json())?.message?.content || "";
}

// ─── ROUTES ───

app.get("/health", (_, res) => res.json({ ok: true, version: "2.3.0", model: CHAT_MODEL, globalDocs: globalDocs.length }));

// ─── GLOBAL KNOWLEDGE ROUTES ───

app.post("/global/upload", upload.single("file"), async (req, res) => {
  try {
    const buffer = fs.readFileSync(req.file.path);
    fs.unlinkSync(req.file.path);

    let text = "", pageCount = null;
    if (req.file.originalname.toLowerCase().endsWith(".txt")) {
      text = buffer.toString("utf-8");
    } else {
      const parsed = await pdfParse(buffer);
      text = parsed.text;
      pageCount = parsed.numpages || null;
    }

    const rawChunks = chunkText(text).slice(0, MAX_GLOBAL_CHUNKS);
    const embedded = [];
    console.log(`🌍 [GLOBAL] Embedding ${rawChunks.length} chunks for "${req.file.originalname}"...`);

    for (let i = 0; i < rawChunks.length; i++) {
      const { v, n } = await embed(rawChunks[i]);
      embedded.push({ text: rawChunks[i], emb: v, norm: n });
      if (i % 500 === 0) console.log(`   ${i}/${rawChunks.length} chunks embedded...`);
    }

    const docId = crypto.randomUUID();
    const doc = {
      id: docId,
      name: req.file.originalname,
      uploadedAt: Date.now(),
      chunks: embedded,
      pageCount,
      global: true
    };

    globalDocs.push(doc);

    // Stream save — no string length crash
    await saveGlobalDoc(doc);

    console.log(`✅ [GLOBAL] "${req.file.originalname}" — ${embedded.length} chunks saved permanently.`);
    res.json({ success: true, docId, chunks: embedded.length, pages: pageCount, global: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Global upload failed: " + e.message });
  }
});

app.get("/global/docs", (_, res) => {
  res.json(globalDocs.map(d => ({
    id: d.id,
    name: d.name,
    uploadedAt: d.uploadedAt,
    chunks: d.chunks.length,
    pageCount: d.pageCount,
    global: true
  })));
});

app.delete("/global/doc/:docId", (req, res) => {
  deleteGlobalDoc(req.params.docId);
  res.json({ ok: true });
});

// ─── SESSION ROUTES ───

app.post("/session", (_, res) => {
  const id = crypto.randomUUID();
  const conv = { docs: [], history: [], title: "New chat", createdAt: Date.now() };
  conversations.set(id, conv);
  saveConversation(id, conv);
  res.json({ conversationId: id });
});

app.get("/sessions", (_, res) => {
  const list = [];
  for (const [id, c] of conversations.entries())
    list.push({ id, title: c.title, createdAt: c.createdAt, docCount: c.docs.length, messageCount: c.history.length });
  res.json(list.sort((a, b) => b.createdAt - a.createdAt));
});

app.patch("/session/:id", (req, res) => {
  const conv = conversations.get(req.params.id);
  if (!conv) return res.status(404).json({ error: "Not found" });
  if (req.body.title) conv.title = req.body.title.slice(0, 60);
  saveConversation(req.params.id, conv);
  res.json({ ok: true });
});

app.delete("/session/:id", (req, res) => {
  conversations.delete(req.params.id);
  deleteConversation(req.params.id);
  res.json({ ok: true });
});

app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    const { conversationId } = req.body;
    const conv = conversations.get(conversationId);
    if (!conv) return res.status(400).json({ error: "Invalid conversation" });

    const buffer = fs.readFileSync(req.file.path);
    fs.unlinkSync(req.file.path);

    let text = "", pageCount = null;
    if (req.file.originalname.toLowerCase().endsWith(".txt")) {
      text = buffer.toString("utf-8");
    } else {
      const parsed = await pdfParse(buffer);
      text = parsed.text;
      pageCount = parsed.numpages || null;
    }

    const rawChunks = chunkText(text);
    const embedded = [];
    console.log(`⚙️  Embedding ${rawChunks.length} chunks for "${req.file.originalname}"...`);

    for (let i = 0; i < rawChunks.length; i++) {
      const { v, n } = await embed(rawChunks[i]);
      embedded.push({ text: rawChunks[i], emb: v, norm: n });
      if (i % 500 === 0) console.log(`   ${i}/${rawChunks.length} chunks embedded...`);
    }

    const docId = crypto.randomUUID();
    conv.docs.push({ id: docId, name: req.file.originalname, uploadedAt: Date.now(), chunks: embedded, pageCount });
    saveConversation(conversationId, conv);
    console.log(`✅ Saved "${req.file.originalname}" — ${embedded.length} chunks`);

    res.json({ success: true, docId, chunks: embedded.length, pages: pageCount });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "File processing failed: " + e.message });
  }
});

app.delete("/session/:id/doc/:docId", (req, res) => {
  const conv = conversations.get(req.params.id);
  if (!conv) return res.status(404).json({ error: "Not found" });
  conv.docs = conv.docs.filter(d => d.id !== req.params.docId);
  saveConversation(req.params.id, conv);
  res.json({ ok: true });
});

app.get("/session/:id/docs", (req, res) => {
  const conv = conversations.get(req.params.id);
  if (!conv) return res.status(404).json({ error: "Not found" });
  res.json(conv.docs.map(d => ({ id: d.id, name: d.name, uploadedAt: d.uploadedAt, chunks: d.chunks.length, pageCount: d.pageCount })));
});

// ─── CHAT ───

app.post("/chat", async (req, res) => {
  try {
    const { conversationId, message, language } = req.body;
    const g = message?.trim().toLowerCase();

    if (["hi", "hello", "hey"].includes(g)) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      const reply = "Hi! I am your Indian Legal Assistant. Ask me about IPC sections, contracts, consumer rights, or upload a legal document for analysis.";
      res.write(`data: ${JSON.stringify({ token: reply })}\n\n`);
      res.write(`data: ${JSON.stringify({ done: true, full: reply })}\n\n`);
      res.end(); return;
    }

    const conv = conversations.get(conversationId);
    if (!conv) {
      res.setHeader("Content-Type", "text/event-stream");
      res.write(`data: ${JSON.stringify({ error: "Conversation not found" })}\n\n`);
      res.end(); return;
    }

    if (isUnsafe(message)) {
      res.setHeader("Content-Type", "text/event-stream");
      const safe = "I'm here to provide safe and helpful information, so I can't assist with that request.";
      res.write(`data: ${JSON.stringify({ token: safe })}\n\n`);
      res.write(`data: ${JSON.stringify({ done: true, full: safe })}\n\n`);
      res.end(); return;
    }

    const detectedLang = language && language !== "auto"
      ? language
      : (await chatOnce("You are a precise language detector. Respond with ONLY the language name in English.",
          [{ role: "user", content: `Identify the language of:\n${message}` }])).trim();
    const targetLang = language && language !== "auto" ? language : detectedLang;

    const { v: qVec, n: qNorm } = await embed(message);

    let matches = [];

    for (const d of globalDocs)
      for (const c of d.chunks)
        matches.push({ score: cosine(qVec, qNorm, c.emb, c.norm), text: c.text, doc: `[Global] ${d.name}` });

    for (const d of conv.docs)
      for (const c of d.chunks)
        matches.push({ score: cosine(qVec, qNorm, c.emb, c.norm), text: c.text, doc: d.name });

    matches.sort((a, b) => b.score - a.score);
    const context = matches.slice(0, TOP_K).filter(m => m.score > 0.3)
      .map(m => `[Source: ${m.doc}]\n${m.text}`).join("\n\n---\n\n");

    const hasContext = context.length > 0;
    const system = `You are a specialized Indian legal assistant.

LANGUAGE: Always respond in ${targetLang}. Never mix languages.

DOMAIN: You ONLY answer questions related to Indian law, legal documents, contracts, IPC sections, constitutional rights, consumer protection, and legal procedures. If the question is not legal, respond with ONLY this single sentence and nothing else: "I am a legal assistant and can only help with law-related questions." Do NOT provide any additional information after that sentence. Stop immediately.

FORMATTING: Use markdown. Use **bold** for legal terms and section numbers. Use numbered lists for steps or procedures.

SAFETY: Never produce offensive, hateful, or illegal content. Always advise consulting a qualified lawyer for specific legal action.

${hasContext
  ? `KNOWLEDGE: Use ONLY the provided context. Always cite the source document. If answer is not in context, say so clearly.`
  : `KNOWLEDGE: Answer from your legal knowledge. Always cite relevant acts, sections, or articles.`}`;

    const historySlice = conv.history.slice(-12);
    const userContent = hasContext ? `Question: ${message}\n\nContext:\n${context}` : message;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const reply = await chatStream(system, [...historySlice, { role: "user", content: userContent }], res);

    if (conv.history.length === 0 && message.trim())
      conv.title = message.trim().slice(0, 50) + (message.trim().length > 50 ? "…" : "");

    conv.history.push({ role: "user", content: message }, { role: "assistant", content: reply });
    if (conv.history.length > 40) conv.history = conv.history.slice(-40);

    saveConversation(conversationId, conv);
    res.end();
  } catch (e) {
    console.error(e);
    try { res.write(`data: ${JSON.stringify({ error: "Engine error. Ensure Ollama is running with legal-bot and nomic-embed-text." })}\n\n`); res.end(); } catch {}
  }
});

const PORT = process.env.PORT || 8080;
// Load global docs async before starting server
loadGlobalDocsAsync().then(docs => {
  globalDocs = docs;
  app.listen(PORT, () => {
    console.log(`\n🚀 Niglen Legal v2.3 running on http://localhost:${PORT}`);
    console.log(`   Model: ${CHAT_MODEL}`);
    console.log(`   Global Knowledge: ${globalDocs.length} document(s) loaded`);
    console.log(`   Max Global Chunks: ${MAX_GLOBAL_CHUNKS}`);
    console.log(`   Storage: ${STORAGE_DIR}/\n`);
  });
});