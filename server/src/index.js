import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs";
import crypto from "crypto";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse"); // ✅ CommonJS safe in Node v22

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

const upload = multer({ dest: "uploads/" });

/**
 * In-memory store (hackathon-friendly)
 * conversations.set(id, { pdfText, history })
 */
const conversations = new Map();

const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3";

// ---------- helpers: chunking + simple retrieval ----------
function normalize(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function chunkText(text, chunkSize = 1200, overlap = 200) {
  const t = (text || "").replace(/\s+/g, " ").trim();
  if (!t) return [];
  const chunks = [];
  let i = 0;
  while (i < t.length) {
    const end = Math.min(i + chunkSize, t.length);
    chunks.push(t.slice(i, end));
    if (end === t.length) break;
    i = Math.max(0, end - overlap);
  }
  return chunks;
}

function scoreOverlap(chunk, query) {
  const c = normalize(chunk);
  const q = normalize(query);
  if (!c || !q) return 0;

  const qWords = q.split(" ").filter((w) => w.length >= 3);
  if (!qWords.length) return 0;

  let score = 0;
  for (const w of qWords) {
    if (c.includes(w)) score += 1;
  }
  return score / qWords.length;
}

function pickBestChunks(pdfText, query, k = 4) {
  const chunks = chunkText(pdfText);
  const scored = chunks
    .map((ch) => ({ ch, s: scoreOverlap(ch, query) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, k);

  const best = scored.filter((x) => x.s > 0).map((x) => x.ch);
  if (best.length) return best;

  return chunks.slice(0, Math.min(k, chunks.length));
}

// ---------- Ollama call ----------
async function ollamaChat({ system, messages }) {
  const r = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      stream: false,
      messages: [{ role: "system", content: system }, ...messages]
    })
  });

  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`Ollama error ${r.status}: ${t}`);
  }

  const data = await r.json();
  return data?.message?.content || "";
}

// ---------- routes ----------
app.post("/session", (req, res) => {
  const id = crypto.randomUUID();
  conversations.set(id, { pdfText: "", history: [] });
  res.json({ conversationId: id });
});

app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    // ✅ allow conversationId from body OR query (fix for frontend mismatch)
    const conversationId = req.body?.conversationId || req.query?.conversationId;

    const conv = conversations.get(conversationId);
    if (!conv) {
      return res.status(400).json({
        error: "Invalid conversationId (session missing on frontend)."
      });
    }

    if (!req.file?.path) {
      return res.status(400).json({ error: "No file uploaded." });
    }

    const buffer = fs.readFileSync(req.file.path);
    const parsed = await pdfParse(buffer);
    const text = (parsed?.text || "").trim();

    conv.pdfText = text;

    fs.unlinkSync(req.file.path);

    res.json({
      success: true,
      chars: text.length
    });
  } catch (err) {
    console.error("PDF upload error:", err);
    res.status(500).json({
      error: "PDF processing failed. Check backend console."
    });
  }
});

app.post("/chat", async (req, res) => {
  try {
    const { conversationId, message, language } = req.body;
    const conv = conversations.get(conversationId);
    if (!conv) return res.status(400).json({ reply: "Conversation not found." });

    const targetLang = language && language !== "auto" ? language : "same as user";

    let contextBlock = "";
    if (conv.pdfText) {
      const best = pickBestChunks(conv.pdfText, message, 4);
      contextBlock =
        "You have access to an uploaded PDF. Use ONLY this PDF context when answering PDF questions.\n\n" +
        best.map((c, i) => `--- PDF CHUNK ${i + 1} ---\n${c}`).join("\n\n");
    } else {
      contextBlock =
        "No PDF is uploaded. Answer normally. If user asks about a PDF, ask them to attach it.";
    }

    const system = `
You are "Niglen", an offline assistant running locally for a hackathon demo.
Rules:
- Be helpful, accurate, and concise.
- If you don't know, say so and ask for the missing info.
- Do NOT generate offensive/unsafe content.
- If PDF context is present, ground answers in it and quote small snippets when useful.
- Reply language: ${targetLang}.
`;

    const history = conv.history || [];
    const trimmedHistory = history.slice(-8);

    const userMsg = conv.pdfText
      ? `User question: ${message}\n\nPDF Context:\n${contextBlock}`
      : message;

    const messages = [...trimmedHistory, { role: "user", content: userMsg }];

    const reply = await ollamaChat({ system, messages });

    conv.history = [
      ...trimmedHistory,
      { role: "user", content: message },
      { role: "assistant", content: reply }
    ];

    res.json({ reply });
  } catch (err) {
    console.error("Chat error:", err);
    res.json({
      reply:
        "I couldn’t reach Ollama. Make sure Ollama is installed, running, and you pulled the model (ollama pull llama3)."
    });
  }
});

const PORT = 8080;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`🧠 Ollama: ${OLLAMA_URL} | Model: ${OLLAMA_MODEL}`);
});
