"use client";

import { useState, useRef, useEffect } from "react";
import { Send, Loader2, Database, Plus, MessageSquare } from "lucide-react";
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
  transient?: boolean;
}

interface ConversationItem {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

export default function ChatBox() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [isLoadingConversations, setIsLoadingConversations] = useState(false);
  const [isCreatingConversation, setIsCreatingConversation] = useState(false);
  const [isLoadingConversationMessages, setIsLoadingConversationMessages] = useState(false);
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

  const csrfHeader = () => {
    const token = getCsrfToken();
    return token ? { "x-csrf-token": token } : {};
  };

  const fetchConversations = async () => {
    setIsLoadingConversations(true);
    try {
      const response = await fetch("/api/conversations");
      if (response.status === 401) {
        setAuthStatus("unauthenticated");
        setCurrentUser(null);
        setConversations([]);
        setActiveConversationId(null);
        setMessages([]);
        return;
      }
      if (!response.ok) {
        throw new Error("Failed to load conversations");
      }
      const data = await response.json();
      setConversations(Array.isArray(data.conversations) ? data.conversations : []);
    } catch (error) {
      console.error(error);
    } finally {
      setIsLoadingConversations(false);
    }
  };

  const loadConversationMessages = async (conversationId: string) => {
    setIsLoadingConversationMessages(true);
    try {
      const response = await fetch(`/api/conversations/${conversationId}/messages`);
      if (response.status === 401) {
        setAuthStatus("unauthenticated");
        setCurrentUser(null);
        setConversations([]);
        setActiveConversationId(null);
        setMessages([]);
        return;
      }
      if (!response.ok) {
        throw new Error("Failed to load conversation messages");
      }
      const data = await response.json();
      const loadedMessages: Message[] = Array.isArray(data.messages)
        ? data.messages.map((msg: { role: "user" | "assistant"; content: string }) => ({
            role: msg.role,
            content: msg.content,
          }))
        : [];
      setMessages(loadedMessages);
      setActiveConversationId(conversationId);
    } catch (error) {
      console.error(error);
    } finally {
      setIsLoadingConversationMessages(false);
    }
  };

  useEffect(() => {
    if (authStatus !== "authenticated") {
      if (authStatus === "unauthenticated") {
        setConversations([]);
        setActiveConversationId(null);
        setMessages([
          {
            role: "assistant",
            content: "Sign in with Google to continue chatting.",
            transient: true,
          },
        ]);
      }
      return;
    }

    fetchConversations();
    setMessages([
      {
        role: "assistant",
        content: "Choose a conversation on the left or start a new one to begin.",
        transient: true,
      },
    ]);
  }, [authStatus]);

  const createConversation = async (titleSeed?: string) => {
    if (isCreatingConversation) return null;
    setIsCreatingConversation(true);
    try {
      const response = await fetch("/api/conversations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...csrfHeader(),
        },
        body: JSON.stringify({
          title: titleSeed?.trim() ? titleSeed.trim().slice(0, 80) : "New Conversation",
        }),
      });
      if (response.status === 401) {
        setAuthStatus("unauthenticated");
        setCurrentUser(null);
        return null;
      }
      if (!response.ok) {
        throw new Error("Failed to create conversation");
      }
      const data = await response.json();
      const created: ConversationItem | undefined = data.conversation;
      if (!created) return null;
      setConversations((prev) => [created, ...prev.filter((item) => item.id !== created.id)]);
      setActiveConversationId(created.id);
      setMessages([]);
      return created.id;
    } catch (error) {
      console.error(error);
      return null;
    } finally {
      setIsCreatingConversation(false);
    }
  };

  const handleSelectConversation = async (conversationId: string) => {
    if (conversationId === activeConversationId || isLoading) return;
    await loadConversationMessages(conversationId);
  };

  const saveMessage = async (conversationId: string, message: Pick<Message, "role" | "content">) => {
    const response = await fetch(`/api/conversations/${conversationId}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...csrfHeader(),
      },
      body: JSON.stringify(message),
    });
    if (response.status === 401) {
      setAuthStatus("unauthenticated");
      setCurrentUser(null);
      throw new Error("Unauthorized");
    }
    if (!response.ok) {
      throw new Error("Failed to persist message");
    }
  };

  const moveConversationToTop = (conversationId: string) => {
    setConversations((prev) => {
      const found = prev.find((item) => item.id === conversationId);
      if (!found) return prev;
      return [{ ...found, updatedAt: new Date().toISOString() }, ...prev.filter((item) => item.id !== conversationId)];
    });
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading || authStatus !== "authenticated") return;

    let conversationId = activeConversationId;
    const userContent = input.trim();
    const userMsg: Message = { role: "user", content: userContent };
    setInput("");
    setIsLoading(true);

    try {
      if (!conversationId) {
        conversationId = await createConversation(userContent);
        if (!conversationId) {
          throw new Error("Unable to create conversation");
        }
      }

      await saveMessage(conversationId, userMsg);
      setMessages((prev) => {
        const base = prev.filter((m) => !m.transient);
        return [...base, userMsg];
      });
      moveConversationToTop(conversationId);

      const modelMessages = [...messages.filter((m) => !m.transient), userMsg].map((msg) => ({
        role: msg.role,
        content: msg.content,
      }));

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...csrfHeader(),
        },
        body: JSON.stringify({ messages: modelMessages }),
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
      const assistantMsg: Message = {
        role: "assistant",
        content: data.content,
        sources: data.sources,
      };

      await saveMessage(conversationId, assistantMsg);
      setMessages((prev) => [...prev, assistantMsg]);
      moveConversationToTop(conversationId);
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
      setConversations([]);
      setActiveConversationId(null);
      setMessages([{ role: "assistant", content: "You have signed out. Sign in to continue chatting.", transient: true }]);
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

      <div className="chat-layout">
        <aside className="conversation-pane">
          <div className="conversation-pane-header">
            <div className="conversation-pane-title">
              <MessageSquare size={14} />
              Conversations
            </div>
            <button
              className="ghost-btn"
              onClick={() => void createConversation()}
              disabled={authStatus !== "authenticated" || isCreatingConversation || isLoading}
              title="Start new conversation"
            >
              <Plus size={14} />
              New
            </button>
          </div>
          <div className="conversation-list">
            {authStatus !== "authenticated" ? (
              <div className="conversation-empty">Sign in to view saved conversations.</div>
            ) : isLoadingConversations ? (
              <div className="conversation-empty">Loading conversations...</div>
            ) : conversations.length === 0 ? (
              <div className="conversation-empty">No saved conversations yet.</div>
            ) : (
              conversations.map((conversation) => (
                <button
                  key={conversation.id}
                  className={`conversation-item ${conversation.id === activeConversationId ? "active" : ""}`}
                  onClick={() => void handleSelectConversation(conversation.id)}
                  disabled={isLoading || isLoadingConversationMessages}
                  title={conversation.title || "Untitled conversation"}
                >
                  <span>{conversation.title || "Untitled conversation"}</span>
                </button>
              ))
            )}
          </div>
        </aside>

        <div className="chat-main">
          <div className="messages-list">
            {isLoadingConversationMessages ? (
              <div className="message ai loading">Loading conversation...</div>
            ) : messages.map((msg, i) => (
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
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "0.25rem" }}>
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

          <form className="input-area" onSubmit={(e) => { e.preventDefault(); void handleSend(); }}>
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
      </div>
    </div>
  );
}
