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
app.use(express.json({ limit: "10mb" }));

const upload = multer({ dest: "uploads/", limits: { fileSize: 20 * 1024 * 1024 } });

/* ─── CONFIG ─── */
const OLLAMA_URL = "http://localhost:11434";
const CHAT_MODEL = "legal-bot";
const EMBED_MODEL = "nomic-embed-text";
const CHUNK_SIZE = 800;
const CHUNK_OVERLAP = 150;
const TOP_K = 6;
const STORAGE_FILE = "./storage.json";

/* ─── SAFETY ─── */
const BANNED = [
  "kill", "suicide", "bomb", "terror",
  "porn", "rape", "nude",
  "hate", "racist", "violence"
];
function isUnsafe(text = "") {
  const t = text.toLowerCase();
  return BANNED.some(w => t.includes(w));
}

/* ─── PERSISTENT STORAGE ─── */

function loadStorage() {
  try {
    if (fs.existsSync(STORAGE_FILE)) {
      const raw = fs.readFileSync(STORAGE_FILE, "utf-8");
      const data = JSON.parse(raw);
      const map = new Map();
      for (const [id, conv] of Object.entries(data)) {
        conv.docs = (conv.docs || []).map(doc => ({
          ...doc,
          chunks: doc.chunks.map(c => ({
            text: c.text,
            emb: new Float32Array(c.emb),
            norm: c.norm
          }))
        }));
        map.set(id, conv);
      }
      console.log(`📂 Loaded ${map.size} conversations from storage.`);
      return map;
    }
  } catch (e) {
    console.error("⚠️  Could not load storage.json, starting fresh.", e.message);
  }
  return new Map();
}

function saveStorage() {
  try {
    const obj = {};
    for (const [id, conv] of conversations.entries()) {
      obj[id] = {
        ...conv,
        docs: conv.docs.map(doc => ({
          ...doc,
          chunks: doc.chunks.map(c => ({
            text: c.text,
            emb: Array.from(c.emb),
            norm: c.norm
          }))
        }))
      };
    }
    fs.writeFileSync(STORAGE_FILE, JSON.stringify(obj), "utf-8");
  } catch (e) {
    console.error("⚠️  Could not save storage.json:", e.message);
  }
}

const conversations = loadStorage();

/* ─── HELPERS ─── */
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

function vecNorm(v) {
  let s = 0;
  for (const x of v) s += x * x;
  return Math.sqrt(s) || 1e-9;
}

function cosine(a, an, b, bn) {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += a[i] * b[i];
  return d / (an * bn);
}

async function embed(text) {
  const r = await fetch(`${OLLAMA_URL}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, prompt: text })
  });
  const j = await r.json();
  const v = new Float32Array(j.embedding);
  return { v, n: vecNorm(v) };
}

async function chatStream(system, messages, res) {
  const r = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: CHAT_MODEL,
      stream: true,
      messages: [{ role: "system", content: system }, ...messages]
    })
  });

  let full = "";
  const reader = r.body.getReader();
  const dec = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const lines = dec.decode(value).split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        const token = obj?.message?.content || "";
        if (token) {
          full += token;
          res.write(`data: ${JSON.stringify({ token })}\n\n`);
        }
        if (obj.done) {
          res.write(`data: ${JSON.stringify({ done: true, full })}\n\n`);
        }
      } catch { /* skip malformed */ }
    }
  }
  return full;
}

async function chatOnce(system, messages) {
  const r = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: CHAT_MODEL,
      stream: false,
      messages: [{ role: "system", content: system }, ...messages]
    })
  });
  const j = await r.json();
  return j?.message?.content || "";
}

/* ─── ROUTES ─── */

app.get("/health", (_, res) => {
  res.json({ ok: true, version: "2.1.0", model: CHAT_MODEL });
});

app.post("/session", (_, res) => {
  const id = crypto.randomUUID();
  conversations.set(id, {
    docs: [],
    history: [],
    title: "New chat",
    createdAt: Date.now()
  });
  saveStorage();
  res.json({ conversationId: id });
});

app.get("/sessions", (_, res) => {
  const list = [];
  for (const [id, c] of conversations.entries()) {
    list.push({ id, title: c.title, createdAt: c.createdAt, docCount: c.docs.length, messageCount: c.history.length });
  }
  list.sort((a, b) => b.createdAt - a.createdAt);
  res.json(list);
});

app.patch("/session/:id", (req, res) => {
  const conv = conversations.get(req.params.id);
  if (!conv) return res.status(404).json({ error: "Not found" });
  if (req.body.title) conv.title = req.body.title.slice(0, 60);
  saveStorage();
  res.json({ ok: true });
});

app.delete("/session/:id", (req, res) => {
  conversations.delete(req.params.id);
  saveStorage();
  res.json({ ok: true });
});

app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    const { conversationId } = req.body;
    const conv = conversations.get(conversationId);
    if (!conv) return res.status(400).json({ error: "Invalid conversation" });

    const buffer = fs.readFileSync(req.file.path);
    const parsed = await pdfParse(buffer);
    fs.unlinkSync(req.file.path);

    const rawChunks = chunkText(parsed.text);
    const embedded = [];
    for (const c of rawChunks) {
      const { v, n } = await embed(c);
      embedded.push({ text: c, emb: v, norm: n });
    }

    const docId = crypto.randomUUID();
    conv.docs.push({
      id: docId,
      name: req.file.originalname,
      uploadedAt: Date.now(),
      chunks: embedded,
      pageCount: parsed.numpages || null
    });

    saveStorage();
    console.log(`💾 Saved "${req.file.originalname}" (${embedded.length} chunks) permanently.`);

    res.json({ success: true, docId, chunks: embedded.length, pages: parsed.numpages });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "PDF processing failed" });
  }
});

app.delete("/session/:id/doc/:docId", (req, res) => {
  const conv = conversations.get(req.params.id);
  if (!conv) return res.status(404).json({ error: "Not found" });
  conv.docs = conv.docs.filter(d => d.id !== req.params.docId);
  saveStorage();
  res.json({ ok: true });
});

app.get("/session/:id/docs", (req, res) => {
  const conv = conversations.get(req.params.id);
  if (!conv) return res.status(404).json({ error: "Not found" });
  res.json(conv.docs.map(d => ({ id: d.id, name: d.name, uploadedAt: d.uploadedAt, chunks: d.chunks.length, pageCount: d.pageCount })));
});

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
      res.end();
      return;
    }

    const conv = conversations.get(conversationId);
    if (!conv) {
      res.setHeader("Content-Type", "text/event-stream");
      res.write(`data: ${JSON.stringify({ error: "Conversation not found" })}\n\n`);
      res.end();
      return;
    }

    if (isUnsafe(message)) {
      res.setHeader("Content-Type", "text/event-stream");
      const safe = "I'm here to provide safe and helpful information, so I can't assist with that request.";
      res.write(`data: ${JSON.stringify({ token: safe })}\n\n`);
      res.write(`data: ${JSON.stringify({ done: true, full: safe })}\n\n`);
      res.end();
      return;
    }

    const detectedLang = language && language !== "auto"
      ? language
      : (await chatOnce(
          "You are a precise language detector. Respond with ONLY the language name in English.",
          [{ role: "user", content: `Identify the language of:\n${message}` }]
        )).trim();

    const targetLang = language && language !== "auto" ? language : detectedLang;

    const { v: qVec, n: qNorm } = await embed(message);

    let matches = [];
    for (const d of conv.docs) {
      for (const c of d.chunks) {
        matches.push({ score: cosine(qVec, qNorm, c.emb, c.norm), text: c.text, doc: d.name });
      }
    }
    matches.sort((a, b) => b.score - a.score);
    const context = matches
      .slice(0, TOP_K)
      .filter(m => m.score > 0.3)
      .map(m => `[Source: ${m.doc}]\n${m.text}`)
      .join("\n\n---\n\n");

    const hasContext = context.length > 0;
    const system = `You are a specialized Indian legal assistant.

LANGUAGE: Always respond in ${targetLang}. Never mix languages.

DOMAIN: You ONLY answer questions related to Indian law, legal documents, contracts, IPC sections, constitutional rights, consumer protection, and legal procedures. If the question is not legal, respond with ONLY this single sentence and nothing else: "I am a legal assistant and can only help with law-related questions." Do NOT provide any additional information, recipes, tips, or general help after that sentence. Stop immediately.

FORMATTING: Use markdown. Use **bold** for legal terms and section numbers. Use numbered lists for steps or procedures.

SAFETY: Never produce offensive, hateful, or illegal content. Always advise consulting a qualified lawyer for specific legal action.

${hasContext
  ? `KNOWLEDGE: Use ONLY the provided PDF context. Always cite the source document and section. If answer is not in context, say so clearly.`
  : `KNOWLEDGE: Answer from your legal knowledge. Always cite relevant acts, sections, or articles.`}`;

    const historySlice = conv.history.slice(-12);
    const userContent = hasContext
      ? `Question: ${message}\n\nContext from PDFs:\n${context}`
      : message;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const reply = await chatStream(system, [...historySlice, { role: "user", content: userContent }], res);

    if (conv.history.length === 0 && message.trim()) {
      conv.title = message.trim().slice(0, 50) + (message.trim().length > 50 ? "…" : "");
    }

    conv.history.push(
      { role: "user", content: message },
      { role: "assistant", content: reply }
    );

    if (conv.history.length > 40) conv.history = conv.history.slice(-40);

    saveStorage();
    res.end();
  } catch (e) {
    console.error(e);
    try {
      res.write(`data: ${JSON.stringify({ error: "Engine error. Ensure Ollama is running with legal-bot and nomic-embed-text." })}\n\n`);
      res.end();
    } catch {}
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`\n🚀 Niglen Legal v2.1 running on http://localhost:${PORT}`);
  console.log(`   Model: ${CHAT_MODEL}`);
  console.log(`   Storage: ${STORAGE_FILE}\n`);
});