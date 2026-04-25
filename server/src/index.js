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
const CHAT_MODEL = "llama3";
const EMBED_MODEL = "nomic-embed-text";
const CHUNK_SIZE = 800;
const CHUNK_OVERLAP = 150;
const TOP_K = 6;

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

/* ─── IN-MEMORY STORE ─── */
const conversations = new Map();

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
  res.json({ ok: true, version: "2.0.0" });
});

app.post("/session", (_, res) => {
  const id = crypto.randomUUID();
  conversations.set(id, {
    docs: [],
    history: [],
    title: "New chat",
    createdAt: Date.now()
  });
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
  res.json({ ok: true });
});

app.delete("/session/:id", (req, res) => {
  conversations.delete(req.params.id);
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
      const reply = "Hi! How can I help you today? Feel free to ask me anything or upload a PDF to chat with it.";
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
    const system = `You are Niglen, a helpful, precise, and multilingual AI assistant.

LANGUAGE: Always respond in ${targetLang}. Never mix languages.

FORMATTING: Use markdown. Use **bold** for key terms. Use bullet points or numbered lists for steps. Use \`code blocks\` for technical content.

SAFETY: Never produce offensive, hateful, sexual, violent, or illegal content.

${hasContext
  ? `KNOWLEDGE: Use ONLY the provided PDF context. Cite source document names. If answer is not in context, say so.`
  : `KNOWLEDGE: No PDF context available. Answer from general knowledge. Be honest if you don't know.`}`;

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

    res.end();
  } catch (e) {
    console.error(e);
    try {
      res.write(`data: ${JSON.stringify({ error: "Engine error. Ensure Ollama is running with llama3 and nomic-embed-text." })}\n\n`);
      res.end();
    } catch {}
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`\n🚀 Niglen v2 running on http://localhost:${PORT}\n`);
});
