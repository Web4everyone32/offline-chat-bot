import React, { useEffect, useState } from "react";

const API_BASE = "http://localhost:8080";

export default function App() {
  const [conversationId, setConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");

  useEffect(() => {
    fetch(`${API_BASE}/session`, { method: "POST" })
      .then((r) => r.json())
      .then((d) => setConversationId(d.conversationId));
  }, []);

  async function send() {
    if (!input.trim()) return;

    const userMsg = { role: "user", content: input };
    setMessages((m) => [...m, userMsg]);
    setInput("");

    const resp = await fetch(`${API_BASE}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId, message: userMsg.content })
    });

    const data = await resp.json();
    setMessages((m) => [...m, { role: "assistant", content: data.reply }]);
  }

  return (
    <div style={{ padding: 20, fontFamily: "Arial" }}>
      <h2>Build-a-Bot Starter</h2>
      <div style={{ border: "1px solid #ccc", height: 400, overflow: "auto", padding: 10 }}>
        {messages.map((m, i) => (
          <div key={i} style={{ margin: "8px 0" }}>
            <b>{m.role === "user" ? "You" : "Bot"}:</b> {m.content}
          </div>
        ))}
      </div>
      <input
        style={{ width: "80%", padding: 10 }}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && send()}
      />
      <button onClick={send} style={{ padding: 10 }}>Send</button>
    </div>
  );
}
