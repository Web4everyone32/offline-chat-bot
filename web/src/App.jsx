import { useEffect, useMemo, useRef, useState } from "react";
import "./styles.css";

const API = "http://localhost:8080";
const LS_KEY = "Niglen_chats_v1";

function nowTitle() {
  return "New chat";
}

function safeJsonParse(s, fallback) {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

export default function App() {
  const [language, setLanguage] = useState("auto");

  // conversations: [{ id, title, backendId, messages: [{role, content, fileName?}] }]
  const [conversations, setConversations] = useState([]);
  const [activeId, setActiveId] = useState(null);

  const [input, setInput] = useState("");
  const [pendingFile, setPendingFile] = useState(null);
  const [loading, setLoading] = useState(false);

  const fileRef = useRef(null);
  const endRef = useRef(null);

  // Load chats from localStorage
  useEffect(() => {
    const saved = safeJsonParse(localStorage.getItem(LS_KEY), []);
    if (Array.isArray(saved) && saved.length) {
      setConversations(saved);
      setActiveId(saved[0].id);
    } else {
      // create first chat
      (async () => {
        const c = await createConversation();
        setConversations([c]);
        setActiveId(c.id);
      })();
    }
  }, []);

  // Persist chats
  useEffect(() => {
    if (conversations.length) {
      localStorage.setItem(LS_KEY, JSON.stringify(conversations));
    }
  }, [conversations]);

  // Scroll to bottom on update
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeId, conversations, loading]);

  const active = useMemo(
    () => conversations.find((c) => c.id === activeId),
    [conversations, activeId]
  );

  async function createConversation() {
    const resp = await fetch(`${API}/session`, { method: "POST" });
    const data = await resp.json();

    const id = crypto.randomUUID();
    return {
      id,
      title: nowTitle(),
      backendId: data.conversationId,
      messages: [
        {
          role: "assistant",
          content: "Hi! Upload a PDF (optional) and ask me anything."
        }
      ]
    };
  }

  async function newChat() {
    const c = await createConversation();
    setConversations((prev) => [c, ...prev]);
    setActiveId(c.id);
    setInput("");
    setPendingFile(null);
  }

  function renameIfFirstUserMessage(conv, userText) {
    if (!conv) return conv;
    if (conv.title !== "New chat") return conv;
    const t = (userText || "").trim();
    if (!t) return conv;
    return { ...conv, title: t.slice(0, 28) + (t.length > 28 ? "…" : "") };
  }

  function updateActiveConversation(updater) {
    setConversations((prev) =>
      prev.map((c) => (c.id === activeId ? updater(c) : c))
    );
  }

  function onSelectFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setPendingFile(f);
    // reset input so selecting same file again triggers change
    e.target.value = "";
  }

  async function send() {
    if (!active || loading) return;
    const text = input.trim();

    if (!text && !pendingFile) return;

    setLoading(true);

    // 1) Show user message immediately (and show file chip if attached)
    const userText = text || (pendingFile ? "📄 Please use the attached document." : "");
    updateActiveConversation((conv) => {
      const conv2 = renameIfFirstUserMessage(conv, userText);
      return {
        ...conv2,
        messages: [
          ...conv2.messages,
          {
            role: "user",
            content: userText,
            fileName: pendingFile?.name || null
          }
        ]
      };
    });

    setInput("");

    // 2) Upload PDF ONLY on send
    if (pendingFile) {
      const form = new FormData();
      form.append("file", pendingFile);
      form.append("conversationId", active.backendId);

      try {
        const up = await fetch(`${API}/upload`, { method: "POST", body: form });
        if (!up.ok) {
          updateActiveConversation((conv) => ({
            ...conv,
            messages: [
              ...conv.messages,
              {
                role: "assistant",
                content:
                  "I couldn’t read that PDF (upload failed). Please try another PDF or re-upload."
              }
            ]
          }));
          setPendingFile(null);
          setLoading(false);
          return;
        }
      } catch {
        updateActiveConversation((conv) => ({
          ...conv,
          messages: [
            ...conv.messages,
            {
              role: "assistant",
              content:
                "Upload failed (network/server). Please ensure the server is running and try again."
            }
          ]
        }));
        setPendingFile(null);
        setLoading(false);
        return;
      }
    }

    // 3) Ask chat endpoint
    try {
      const r = await fetch(`${API}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: active.backendId,
          message: userText,
          language
        })
      });
      const d = await r.json();

      updateActiveConversation((conv) => ({
        ...conv,
        messages: [...conv.messages, { role: "assistant", content: d.reply || "…" }]
      }));
    } catch {
      updateActiveConversation((conv) => ({
        ...conv,
        messages: [
          ...conv.messages,
          { role: "assistant", content: "Server error. Please try again." }
        ]
      }));
    } finally {
      setPendingFile(null);
      setLoading(false);
    }
  }

  function onKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  function downloadFile(name) {
    // This is only a UI affordance. The actual PDF is on the user's machine.
    // We re-use the pendingFile when present; for already-sent file chips, we can't re-open the original blob.
    if (pendingFile && pendingFile.name === name) {
      const url = URL.createObjectURL(pendingFile);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
      return;
    }
    alert("File download is available before sending. After sending, re-upload the PDF to download again.");
  }

  return (
    <div className="page">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="brandRow">
          <div className="brand">Niglen</div>
          <button className="newChatBtn" onClick={newChat}>
            + New chat
          </button>
        </div>

        <div className="chatList">
          {conversations.map((c) => (
            <button
              key={c.id}
              className={`chatItem ${c.id === activeId ? "active" : ""}`}
              onClick={() => {
                setActiveId(c.id);
                setInput("");
                setPendingFile(null);
              }}
              title={c.title}
            >
              <div className="chatItemTitle">{c.title}</div>
            </button>
          ))}
        </div>

        <div className="sidebarFooter">
          <div className="hint">
            Offline • Local AI • PDF Chat
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="main">
        {/* Top bar */}
        <header className="topbar">
          <div className="topbarLeft">
            <div className="title">{active?.title || "Chat"}</div>
          </div>

          <div className="topbarRight">
            <select
              className="langSelect"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              title="Reply language"
            >
              <option value="auto">Auto</option>
              <option value="English">English</option>
              <option value="Tamil">Tamil</option>
              <option value="Hindi">Hindi</option>
              <option value="Malayalam">Malayalam</option>
            </select>
          </div>
        </header>

        {/* Messages */}
        <section className="messages">
          <div className="messagesInner">
            {(active?.messages || []).map((m, idx) => (
              <div key={idx} className={`msgRow ${m.role}`}>
                <div className="msgBubble">
                  {m.fileName && (
                    <button
                      className="fileChip"
                      onClick={() => downloadFile(m.fileName)}
                      title="Download (available before send)"
                      type="button"
                    >
                      📄 {m.fileName}
                    </button>
                  )}
                  <div className="msgText">{m.content}</div>
                </div>
              </div>
            ))}

            {loading && (
              <div className="msgRow assistant">
                <div className="msgBubble">
                  <div className="typingDots">
                    <span></span><span></span><span></span>
                  </div>
                </div>
              </div>
            )}

            <div ref={endRef} />
          </div>
        </section>

        {/* Composer */}
        <footer className="composer">
          {pendingFile && (
            <div className="pendingBar">
              <div className="pendingChip" title={pendingFile.name}>
                📄 {pendingFile.name}
                <button
                  className="xBtn"
                  onClick={() => setPendingFile(null)}
                  type="button"
                  aria-label="Remove attachment"
                >
                  ✕
                </button>
              </div>
              <button
                className="pendingDownload"
                type="button"
                onClick={() => downloadFile(pendingFile.name)}
              >
                Download
              </button>
            </div>
          )}

          <div className="composerRow">
            <button
              className="iconBtn"
              onClick={() => fileRef.current?.click()}
              type="button"
              title="Attach PDF"
            >
              +
            </button>

            <input
              ref={fileRef}
              type="file"
              accept="application/pdf"
              hidden
              onChange={onSelectFile}
            />

            <textarea
              className="composerInput"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Message Niglen…"
              rows={1}
            />

            <button
              className="sendBtn"
              onClick={send}
              disabled={loading}
              type="button"
              title="Send"
            >
              Send
            </button>
          </div>

          <div className="composerHint">
            Enter to send • Shift+Enter for new line • PDF uploads only when you send
          </div>
        </footer>
      </main>
    </div>
  );
}
