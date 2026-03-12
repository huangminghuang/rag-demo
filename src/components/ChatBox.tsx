"use client";

import { useState, useRef, useEffect } from "react";
import { Send, Loader2, Database } from "lucide-react";
import ReactMarkdown from "react-markdown";

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
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMsg: Message = { role: "user", content: input };
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setIsLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [...messages, userMsg] }),
      });

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
    if (isIngesting) return;
    setIsIngesting(true);
    try {
      const response = await fetch("/api/ingest", { method: "POST" });
      const data = await response.json();
      alert(`Ingestion started: ${data.message}\nConfig: ${JSON.stringify(data.config)}`);
    } catch (error) {
      console.error(error);
      alert("Failed to start ingestion");
    } finally {
      setIsIngesting(false);
    }
  };

  return (
    <div className="chat-container">
      <div className="ingest-panel">
        <span>Vite Docs RAG Demo (Gemini 3.1 Flash)</span>
        <button onClick={handleIngest} disabled={isIngesting} style={{ padding: '0.25rem 0.75rem', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
          {isIngesting ? <Loader2 size={12} className="animate-spin" /> : <Database size={12} />}
          {isIngesting ? "Ingesting..." : "Run Initial Ingest"}
        </button>
      </div>

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
          placeholder="Ask a question about Vite docs..."
          disabled={isLoading}
        />
        <button type="submit" disabled={isLoading || !input.trim()}>
          {isLoading ? <Loader2 className="animate-spin" /> : <Send size={20} />}
        </button>
      </form>
    </div>
  );
}
