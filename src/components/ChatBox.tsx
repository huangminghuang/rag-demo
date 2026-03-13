"use client";

import { useState, useRef, useEffect } from "react";
import { Send, Loader2, Database } from "lucide-react";
import ReactMarkdown from "react-markdown";

interface AuthUser {
  id: string;
  email: string;
  name: string;
  picture?: string;
  role: "user" | "admin";
}

interface Message {
  role: "user" | "assistant";
  content: string;
  sources?: { number?: number; title: string; url: string }[];
}

export default function ChatBox() {
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: "Hello! I can answer questions about Vite documentation. How can I help you today?" }
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isIngesting, setIsIngesting] = useState(false);
  const [authStatus, setAuthStatus] = useState<"loading" | "authenticated" | "unauthenticated">("loading");
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const getCsrfToken = (): string | null => {
    if (typeof document === "undefined") return null;
    const token = document.cookie
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith("csrf_token="))
      ?.split("=")[1];
    return token ? decodeURIComponent(token) : null;
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    const loadCurrentUser = async () => {
      try {
        const response = await fetch("/api/auth/me");
        if (!response.ok) {
          setCurrentUser(null);
          setAuthStatus("unauthenticated");
          return;
        }
        const data = await response.json();
        setCurrentUser(data.user);
        setAuthStatus("authenticated");
      } catch (error) {
        console.error(error);
        setCurrentUser(null);
        setAuthStatus("unauthenticated");
      }
    };

    loadCurrentUser();
  }, []);

  const handleSend = async () => {
    if (!input.trim() || isLoading || authStatus !== "authenticated") return;

    const userMsg: Message = { role: "user", content: input };
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setIsLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": getCsrfToken() || "",
        },
        body: JSON.stringify({ messages: [...messages, userMsg] }),
      });

      if (response.status === 401) {
        setAuthStatus("unauthenticated");
        setCurrentUser(null);
        setMessages(prev => [...prev, {
          role: "assistant",
          content: "Please sign in with Google to continue chatting.",
        }]);
        return;
      }

      if (!response.ok) throw new Error("Failed to fetch chat response");

      const data = await response.json();
      setMessages(prev => [...prev, { 
        role: "assistant", 
        content: data.content,
        sources: data.sources 
      }]);
    } catch (error) {
      console.error(error);
      setMessages(prev => [...prev, { role: "assistant", content: "Sorry, I encountered an error. Please try again." }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleIngest = async () => {
    if (isIngesting || authStatus !== "authenticated") return;
    setIsIngesting(true);
    try {
      const csrfToken = getCsrfToken();
      const response = await fetch("/api/ingest", {
        method: "POST",
        headers: csrfToken ? { "x-csrf-token": csrfToken } : undefined,
      });
      if (response.status === 401) {
        setAuthStatus("unauthenticated");
        setCurrentUser(null);
        alert("Please sign in to run ingestion.");
        return;
      }
      if (response.status === 403) {
        alert("Only admin users can run ingestion.");
        return;
      }
      const data = await response.json();
      alert(`Ingestion started: ${data.message}\nConfig: ${JSON.stringify(data.config)}`);
    } catch (error) {
      console.error(error);
      alert("Failed to start ingestion");
    } finally {
      setIsIngesting(false);
    }
  };

  const handleSignIn = () => {
    window.location.href = "/api/auth/signin/google";
  };

  const handleSignOut = async () => {
    if (isSigningOut) return;
    setIsSigningOut(true);
    try {
      const csrfToken = getCsrfToken();
      await fetch("/api/auth/signout", {
        method: "POST",
        headers: csrfToken ? { "x-csrf-token": csrfToken } : undefined,
      });
      setCurrentUser(null);
      setAuthStatus("unauthenticated");
      setMessages([{ role: "assistant", content: "You have signed out. Sign in to continue chatting." }]);
    } catch (error) {
      console.error(error);
    } finally {
      setIsSigningOut(false);
    }
  };

  return (
    <div className="chat-container">
      <div className="ingest-panel">
        <div>
          <div>Vite Docs RAG Demo (Gemini 3.1 Flash)</div>
          <div className="auth-caption">
            {authStatus === "loading"
              ? "Checking sign-in status..."
              : currentUser
                ? `Signed in as ${currentUser.name} (${currentUser.role})`
                : "Not signed in"}
          </div>
        </div>
        <div className="auth-actions">
          {currentUser ? (
            <>
              <button
                onClick={handleIngest}
                disabled={isIngesting || currentUser.role !== "admin"}
                className="ingest-btn"
                title={currentUser.role !== "admin" ? "Admin role required" : "Run ingestion"}
              >
                {isIngesting ? <Loader2 size={12} className="animate-spin" /> : <Database size={12} />}
                {isIngesting ? "Ingesting..." : "Run Ingest"}
              </button>
              <button onClick={handleSignOut} disabled={isSigningOut} className="ghost-btn">
                {isSigningOut ? "Signing out..." : "Sign Out"}
              </button>
            </>
          ) : (
            <button onClick={handleSignIn} className="ghost-btn">
              Sign in with Google
            </button>
          )}
        </div>
      </div>

      {authStatus === "unauthenticated" && (
        <div className="auth-banner">
          Sign in with Google to use chat and retrieval features.
        </div>
      )}

      <div className="messages-list">
        {messages.map((msg, i) => (
          <div key={i} className={`message ${msg.role === "user" ? "user" : "ai"}`}>
            {msg.role === "assistant" ? (
              <div className="markdown-content">
                <ReactMarkdown>{msg.content}</ReactMarkdown>
              </div>
            ) : (
              msg.content
            )}
            {msg.sources && msg.sources.length > 0 && (
              <div className="sources">
                <strong>Sources:</strong>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.25rem' }}>
                  {msg.sources.map((src, j) => (
                    <a key={j} href={src.url} target="_blank" rel="noopener noreferrer" className="source-link">
                      [{src.number ?? j + 1}] {src.title || "Documentation"}
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
        {isLoading && (
          <div className="message ai loading">
            Assistant is thinking...
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <form className="input-area" onSubmit={(e) => { e.preventDefault(); handleSend(); }}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={currentUser ? "Ask a question about Vite docs..." : "Sign in to start chatting"}
          disabled={isLoading || authStatus !== "authenticated"}
        />
        <button type="submit" disabled={isLoading || !input.trim() || authStatus !== "authenticated"}>
          {isLoading ? <Loader2 className="animate-spin" /> : <Send size={20} />}
        </button>
      </form>
    </div>
  );
}
