import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { nanoid } from "nanoid";

const app = express();

const PORT = 8080;
const CLIENT_ORIGIN = "http://localhost:5173";

/**
 * Local Ollama endpoint (NO API KEY)
 */
const OLLAMA_URL = "http://localhost:11434/api/generate";

app.use(helmet());
app.use(cors({ origin: CLIENT_ORIGIN }));
app.use(express.json({ limit: "1mb" }));

app.use(
  rateLimit({
    windowMs: 60_000,
    limit: 100
  })
);

const conversations = new Map();

/**
 * Smart system prompt aligned with hackathon judging
 */
function buildPrompt(history, message) {
  return `
You are a helpful AI chatbot built for a hackathon.

Rules:
- Be clear and concise.
- Provide logical explanations.
- Be safe and respectful.
- Help users solve problems step-by-step.
- If unsure, ask a clarifying question.

Conversation:
${history.map(h => `${h.role}: ${h.content}`).join("\n")}

User: ${message}
Assistant:
`;
}

/**
 * Call LOCAL Ollama (offline AI)
 */
async function callLocalAI(prompt) {
  const resp = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "llama3",
      prompt,
      stream: false
    })
  });

  if (!resp.ok) {
    throw new Error("Local AI not running. Start Ollama first.");
  }

  const data = await resp.json();
  return data.response;
}

app.post("/session", (_req, res) => {
  const id = nanoid();
  conversations.set(id, []);
  res.json({ conversationId: id });
});

app.post("/chat", async (req, res) => {
  try {
    const { conversationId, message } = req.body;

    if (!conversationId || !message) {
      return res.status(400).json({ error: "Missing conversationId or message" });
    }

    const history = conversations.get(conversationId) ?? [];

    const prompt = buildPrompt(history, message);

    let reply;

    try {
      reply = await callLocalAI(prompt);
    } catch {
      /**
       * Fallback rule-based response (never fail demo)
       */
      reply =
        "I'm currently running in offline safety mode. " +
        "Please ensure the local AI model is started, or ask a general question.";
    }

    conversations.set(conversationId, [
      ...history,
      { role: "user", content: message },
      { role: "assistant", content: reply }
    ]);

    res.json({ reply });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Offline chatbot running on http://localhost:${PORT}`);
});
