function isUnsafe(text = "") {
  const banned = [
    "kill", "suicide", "bomb", "terror",
    "porn", "rape", "nude", "sex",
    "hate", "racist", "violence"
  ];

  const t = text.toLowerCase();
  return banned.some(word => t.includes(word));
}


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
app.use(express.json({ limit: "4mb" }));

const upload = multer({ dest: "uploads/" });

/*
Conversation structure:
{
  docs: [
    {
      id,
      name,
      chunks: [{ text, emb, norm }]
    }
  ],
  history: []
}
*/
const conversations = new Map();

const OLLAMA_URL = "http://localhost:11434";
const CHAT_MODEL = "llama3";
const EMBED_MODEL = "nomic-embed-text";

function chunkText(text, size = 1000, overlap = 200) {
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

function norm(v) {
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
  return { v, n: norm(v) };
}

async function chat(system, messages) {
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

/* ---------- ROUTES ---------- */

app.post("/session", (_, res) => {
  const id = crypto.randomUUID();
  conversations.set(id, { docs: [], history: [] });
  res.json({ conversationId: id });
});

/* ---------- MULTI-PDF UPLOAD + EMBEDDING ---------- */
app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    const { conversationId } = req.body;
    const conv = conversations.get(conversationId);
    if (!conv) return res.status(400).json({ error: "Invalid conversation" });

    const buffer = fs.readFileSync(req.file.path);
    const parsed = await pdfParse(buffer);
    fs.unlinkSync(req.file.path);

    const chunks = chunkText(parsed.text);

    const embedded = [];
    for (const c of chunks) {
      const { v, n } = await embed(c);
      embedded.push({ text: c, emb: v, norm: n });
    }

    conv.docs.push({
      id: crypto.randomUUID(),
      name: req.file.originalname,
      chunks: embedded
    });

    res.json({ success: true, chunks: embedded.length });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "PDF processing failed" });
  }
});

/* ---------- TRUE RAG CHAT ---------- */
app.post("/chat", async (req, res) => {
  try {
    const { conversationId, message, language } = req.body;
/* ---------- GREETING SHORT-CIRCUIT ---------- */
const greeting = message?.trim().toLowerCase();

if (["hi", "hello", "hey", "hi niglen", "hello niglen"].includes(greeting)) {
  return res.json({
    reply: "Hi! What would you like to talk about or ask? I'm here to help!"
  });
}

    const conv = conversations.get(conversationId);
    if (!conv) return res.json({ reply: "Conversation not found." });

    /* ---------- 1. Detect language automatically ---------- */
    const detectPrompt = `
Identify the language of the following text.
Respond with ONLY the language name in English.

Text:
${message}
`;

    const detectedLang = (await chat(
      "You are a precise language detector.",
      [{ role: "user", content: detectPrompt }]
    )).trim();

    const targetLang =
      language && language !== "auto" ? language : detectedLang;

    /* ---------- 2. Embed query ---------- */
    const { v: qVec, n: qNorm } = await embed(message);

    /* ---------- 3. Retrieve best chunks across PDFs ---------- */
    let matches = [];

    for (const d of conv.docs) {
      for (const c of d.chunks) {
        matches.push({
          score: cosine(qVec, qNorm, c.emb, c.norm),
          text: c.text,
          doc: d.name
        });
      }
    }

    matches.sort((a, b) => b.score - a.score);

    const context = matches
      .slice(0, 5)
      .map(m => `[${m.doc}] ${m.text}`)
      .join("\n\n");

    /* ---------- 4. Strong multilingual system prompt ---------- */
    const system = `
You are Niglen, a safe and responsible multilingual AI assistant.

STRICT SAFETY RULES:
- Never generate offensive, hateful, sexual, violent, or illegal content.
- If user asks for unsafe or inappropriate content, politely refuse.
- Provide helpful, educational, and respectful responses only.
- Always answer in: ${targetLang}
- Never mix languages.
- If PDF context exists, base answer strictly on it.
- If context is missing, say you don't know.
- Keep answers clear and concise.
`;

    /* ---------- 5. Generate final answer ---------- */
    const reply = await chat(system, [
      {
        role: "user",
        content: `
User question:
${message}

PDF context:
${context || "No PDF context available."}
`
      }
    ]);

    /* ---------- 6. Save conversation history ---------- */
    conv.history.push(
      { role: "user", content: message },
      { role: "assistant", content: reply }
    );

if (isUnsafe(reply)) {
  return res.json({
    reply:
      "I’m here to provide safe and helpful information, so I can’t assist with that request."
  });
}

    res.json({ reply, detectedLang, targetLang });
  } catch (e) {
    console.error(e);
    res.json({
      reply: "Multilingual engine error. Ensure Ollama is running."
    });
  }
});

/* ---------- START SERVER (ONLY ADDITION) ---------- */

const PORT = 8080;

app.listen(PORT, () => {
  console.log(`🚀 Niglen RAG server running on http://localhost:${PORT}`);
});