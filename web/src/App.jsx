import { useEffect, useRef, useState, useCallback } from "react";
import "./styles.css";

const API = "http://localhost:8080";
const LS_KEY = "niglen_v2_chats";

/* ─── SIMPLE MARKDOWN RENDERER ─── */
function renderMarkdown(text) {
  if (!text) return "";
  let html = text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    // Code blocks
    .replace(/```[\w]*\n?([\s\S]*?)```/g, (_, code) =>
      `<pre><code>${code.trim()}</code></pre>`)
    // Inline code
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    // Bold
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    // Italic
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    // Headers
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    // Numbered lists
    .replace(/^\d+\.\s+(.+)$/gm, "<li class='ol-item'>$1</li>")
    // Bullet lists
    .replace(/^[-*]\s+(.+)$/gm, "<li>$1</li>")
    // Paragraphs / line breaks
    .replace(/\n\n/g, "</p><p>")
    .replace(/\n/g, "<br>");

  // Wrap consecutive <li> into <ul>
  html = html.replace(/(<li(?:[^>]*)>[\s\S]*?<\/li>\s*)+/g, m => {
    if (m.includes("ol-item")) return `<ol>${m.replace(/ class='ol-item'/g, "")}</ol>`;
    return `<ul>${m}</ul>`;
  });

  return `<p>${html}</p>`;
}

function MessageBubble({ msg }) {
  const isUser = msg.role === "user";
  return (
    <div className={`msg-row ${isUser ? "user" : "assistant"}`}>
      {!isUser && (
        <div className="avatar">N</div>
      )}
      <div className={`bubble ${isUser ? "bubble-user" : "bubble-ai"}`}>
        {msg.fileName && (
          <div className="file-chip">
            <span className="file-icon">📄</span>
            <span className="file-name">{msg.fileName}</span>
          </div>
        )}
        {isUser ? (
          <p className="msg-text">{msg.content}</p>
        ) : (
          <div
            className="msg-text markdown"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
          />
        )}
        {msg.streaming && <span className="cursor-blink" />}
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="msg-row assistant">
      <div className="avatar">N</div>
      <div className="bubble bubble-ai">
        <div className="typing-dots">
          <span /><span /><span />
        </div>
      </div>
    </div>
  );
}

/* ─── MAIN APP ─── */
export default function App() {
  const [conversations, setConversations] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [input, setInput] = useState("");
  const [pendingFile, setPendingFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [language, setLanguage] = useState("auto");
  const [darkMode, setDarkMode] = useState(() =>
    localStorage.getItem("niglen_dark") === "true"
  );
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [docsPanel, setDocsPanel] = useState(false);
  const [sessionDocs, setSessionDocs] = useState([]);

  const fileRef = useRef(null);
  const endRef = useRef(null);
  const textareaRef = useRef(null);

  // Load from localStorage
  useEffect(() => {
    const saved = (() => { try { return JSON.parse(localStorage.getItem(LS_KEY)) || []; } catch { return []; } })();
    if (saved.length) {
      setConversations(saved);
      setActiveId(saved[0].id);
    } else {
      createConversation().then(c => {
        setConversations([c]);
        setActiveId(c.id);
      });
    }
  }, []);

  useEffect(() => {
    if (conversations.length) localStorage.setItem(LS_KEY, JSON.stringify(conversations));
  }, [conversations]);

  useEffect(() => {
    localStorage.setItem("niglen_dark", darkMode);
    document.documentElement.setAttribute("data-theme", darkMode ? "dark" : "light");
  }, [darkMode]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversations, loading, activeId]);

  const active = conversations.find(c => c.id === activeId);

  async function createConversation() {
    const resp = await fetch(`${API}/session`, { method: "POST" });
    const data = await resp.json();
    return {
      id: crypto.randomUUID(),
      backendId: data.conversationId,
      title: "New chat",
      messages: [{ role: "assistant", content: "Hi! How can I help you today? You can ask me anything or upload a PDF to chat with it." }],
      createdAt: Date.now()
    };
  }

  async function newChat() {
    const c = await createConversation();
    setConversations(prev => [c, ...prev]);
    setActiveId(c.id);
    setInput("");
    setPendingFile(null);
    setDocsPanel(false);
    setSessionDocs([]);
  }

  function updateActive(updater) {
    setConversations(prev => prev.map(c => c.id === activeId ? updater(c) : c));
  }

  async function loadDocs() {
    if (!active) return;
    try {
      const r = await fetch(`${API}/session/${active.backendId}/docs`);
      setSessionDocs(await r.json());
    } catch { setSessionDocs([]); }
  }

  async function removeDoc(docId) {
    if (!active) return;
    await fetch(`${API}/session/${active.backendId}/doc/${docId}`, { method: "DELETE" });
    setSessionDocs(prev => prev.filter(d => d.id !== docId));
  }

  function onSelectFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setPendingFile(f);
    e.target.value = "";
  }

  const send = useCallback(async () => {
    if (!active || loading || uploading) return;
    const text = input.trim();
    if (!text && !pendingFile) return;

    const userText = text || "📄 Please use the attached document.";
    const fileName = pendingFile?.name || null;

    // Optimistically add user message
    updateActive(c => ({
      ...c,
      title: c.title === "New chat" && text
        ? text.slice(0, 40) + (text.length > 40 ? "…" : "")
        : c.title,
      messages: [...c.messages, { role: "user", content: userText, fileName }]
    }));
    setInput("");

    // Upload file first
    if (pendingFile) {
      setUploading(true);
      const form = new FormData();
      form.append("file", pendingFile);
      form.append("conversationId", active.backendId);
      setPendingFile(null);
      try {
        const up = await fetch(`${API}/upload`, { method: "POST", body: form });
        if (!up.ok) throw new Error("Upload failed");
        const result = await up.json();
        updateActive(c => ({
          ...c,
          messages: [...c.messages, {
            role: "assistant",
            content: `✅ **${fileName}** uploaded successfully — ${result.chunks} chunks indexed across ${result.pages || "?"} pages. Ask me anything about it!`
          }]
        }));
      } catch {
        updateActive(c => ({
          ...c,
          messages: [...c.messages, { role: "assistant", content: "❌ Upload failed. Please check the server and try again." }]
        }));
        setUploading(false);
        setLoading(false);
        return;
      }
      setUploading(false);
    }

    if (!text) return;

    // Add placeholder streaming message
    const streamId = crypto.randomUUID();
    updateActive(c => ({
      ...c,
      messages: [...c.messages, { role: "assistant", content: "", streaming: true, id: streamId }]
    }));
    setLoading(true);

    try {
      const resp = await fetch(`${API}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: active.backendId, message: userText, language })
      });

      const reader = resp.body.getReader();
      const dec = new TextDecoder();
      let buffer = "";
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += dec.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const obj = JSON.parse(line.slice(6));
            if (obj.token) {
              accumulated += obj.token;
              setConversations(prev => prev.map(c => {
                if (c.id !== activeId) return c;
                return {
                  ...c,
                  messages: c.messages.map(m =>
                    m.id === streamId
                      ? { ...m, content: accumulated, streaming: true }
                      : m
                  )
                };
              }));
            }
            if (obj.done || obj.error) {
              setConversations(prev => prev.map(c => {
                if (c.id !== activeId) return c;
                return {
                  ...c,
                  messages: c.messages.map(m =>
                    m.id === streamId
                      ? { ...m, content: accumulated || obj.error || "…", streaming: false, id: undefined }
                      : m
                  )
                };
              }));
            }
          } catch { /* skip */ }
        }
      }
    } catch {
      setConversations(prev => prev.map(c => {
        if (c.id !== activeId) return c;
        return {
          ...c,
          messages: c.messages.map(m =>
            m.streaming ? { ...m, content: "❌ Server error. Make sure Ollama is running.", streaming: false } : m
          )
        };
      }));
    } finally {
      setLoading(false);
    }
  }, [active, loading, uploading, input, pendingFile, language, activeId]);

  function onKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  // Auto-resize textarea
  function onInput(e) {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 160) + "px";
  }

  return (
    <div className="page">
      {/* Sidebar */}
      <aside className={`sidebar ${sidebarOpen ? "open" : "closed"}`}>
        <div className="sidebar-header">
          <div className="brand">
            <span className="brand-dot" />
            Niglen
          </div>
          <button className="icon-btn" onClick={() => setSidebarOpen(false)} title="Collapse">
            ‹
          </button>
        </div>

        <button className="new-chat-btn" onClick={newChat}>
          <span>+</span> New chat
        </button>

        <div className="chat-list">
          {conversations.map(c => (
            <div
              key={c.id}
              className={`chat-item ${c.id === activeId ? "active" : ""}`}
              onClick={() => { setActiveId(c.id); setDocsPanel(false); }}
            >
              <span className="chat-item-title">{c.title}</span>
              <button
                className="delete-btn"
                onClick={e => {
                  e.stopPropagation();
                  setConversations(prev => prev.filter(x => x.id !== c.id));
                  if (activeId === c.id) setActiveId(conversations.find(x => x.id !== c.id)?.id || null);
                }}
                title="Delete"
              >×</button>
            </div>
          ))}
        </div>

        <div className="sidebar-footer">
          <span className="status-dot" />
          <span>Offline · Local AI</span>
        </div>
      </aside>

      {/* Collapsed sidebar toggle */}
      {!sidebarOpen && (
        <button className="sidebar-toggle" onClick={() => setSidebarOpen(true)}>›</button>
      )}

      {/* Main */}
      <main className="main">
        {/* Topbar */}
        <header className="topbar">
          <div className="topbar-left">
            <span className="chat-title">{active?.title || "Chat"}</span>
          </div>
          <div className="topbar-right">
            <button
              className={`toolbar-btn ${docsPanel ? "active" : ""}`}
              onClick={() => { setDocsPanel(v => !v); if (!docsPanel) loadDocs(); }}
              title="Manage documents"
            >
              📄 Docs {active?.messages?.filter(m => m.fileName).length > 0 ? `(${sessionDocs.length})` : ""}
            </button>
            <select className="lang-select" value={language} onChange={e => setLanguage(e.target.value)}>
              <option value="auto">🌐 Auto</option>
              <option value="English">English</option>
              <option value="Tamil">Tamil</option>
              <option value="Hindi">Hindi</option>
              <option value="Malayalam">Malayalam</option>
              <option value="French">French</option>
              <option value="Spanish">Spanish</option>
              <option value="German">German</option>
              <option value="Japanese">Japanese</option>
            </select>
            <button className="toolbar-btn" onClick={() => setDarkMode(v => !v)} title="Toggle theme">
              {darkMode ? "☀️" : "🌙"}
            </button>
          </div>
        </header>

        {/* Docs Panel */}
        {docsPanel && (
          <div className="docs-panel">
            <div className="docs-panel-header">
              <strong>Uploaded Documents</strong>
              <button className="icon-btn" onClick={() => setDocsPanel(false)}>×</button>
            </div>
            {sessionDocs.length === 0 ? (
              <p className="docs-empty">No documents uploaded in this session yet.</p>
            ) : (
              <div className="docs-list">
                {sessionDocs.map(d => (
                  <div key={d.id} className="doc-item">
                    <div className="doc-info">
                      <span className="doc-name">📄 {d.name}</span>
                      <span className="doc-meta">{d.chunks} chunks · {d.pageCount ?? "?"} pages</span>
                    </div>
                    <button className="delete-btn" onClick={() => removeDoc(d.id)}>×</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Messages */}
        <section className="messages">
          <div className="messages-inner">
            {(active?.messages || []).map((m, i) => (
              <MessageBubble key={m.id || i} msg={m} />
            ))}
            {(loading && !active?.messages?.some(m => m.streaming)) && <TypingIndicator />}
            {uploading && (
              <div className="msg-row assistant">
                <div className="avatar">N</div>
                <div className="bubble bubble-ai upload-status">
                  <span className="upload-spinner" /> Processing PDF…
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>
        </section>

        {/* Composer */}
        <footer className="composer">
          {pendingFile && (
            <div className="pending-bar">
              <div className="pending-chip">
                <span>📄</span>
                <span className="pending-name">{pendingFile.name}</span>
                <button className="x-btn" onClick={() => setPendingFile(null)}>×</button>
              </div>
            </div>
          )}
          <div className="composer-row">
            <button className="attach-btn" onClick={() => fileRef.current?.click()} title="Attach PDF">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/>
              </svg>
            </button>
            <input ref={fileRef} type="file" accept="application/pdf" hidden onChange={onSelectFile} />
            <textarea
              ref={textareaRef}
              className="composer-input"
              value={input}
              onChange={onInput}
              onKeyDown={onKeyDown}
              placeholder="Message Niglen…"
              rows={1}
              disabled={loading}
            />
            <button
              className={`send-btn ${loading ? "loading" : ""}`}
              onClick={send}
              disabled={loading || (!input.trim() && !pendingFile)}
              title="Send"
            >
              {loading ? (
                <span className="send-spinner" />
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M2 21l21-9L2 3v7l15 2-15 2z"/>
                </svg>
              )}
            </button>
          </div>
          <div className="composer-hint">Enter to send · Shift+Enter for new line</div>
        </footer>
      </main>
    </div>
  );
}
