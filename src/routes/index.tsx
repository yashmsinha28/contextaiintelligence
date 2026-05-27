import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Upload, FileText, Send, LogOut, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";

export const Route = createFileRoute("/")({ component: Index });

type Msg = { role: "user" | "assistant"; content: string };

function Index() {
  const navigate = useNavigate();
  const { user, loading, signOut } = useAuth();
  const [files, setFiles] = useState<File[]>([]);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth" });
  }, [user, loading, navigate]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const addFiles = useCallback((list: FileList | File[]) => {
    const arr = Array.from(list).filter((f) =>
      ["application/pdf", "text/plain", "text/markdown"].includes(f.type) || f.name.endsWith(".md")
    );
    if (arr.length === 0) return toast.error("Only PDF, TXT, or MD files are supported.");
    setFiles((prev) => [...prev, ...arr]);
    toast.success(`${arr.length} file(s) added (upload wired in Phase 2)`);
  }, []);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    addFiles(e.dataTransfer.files);
  };

  const send = () => {
    if (!input.trim()) return;
    const userMsg: Msg = { role: "user", content: input };
    setMessages((m) => [...m, userMsg, {
      role: "assistant",
      content: "RAG pipeline coming in Phase 5 — I'll answer using your uploaded documents.",
    }]);
    setInput("");
  };

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b px-6 py-3 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">RAG Assistant</h1>
          <p className="text-xs text-muted-foreground">{user.email}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={signOut}>
          <LogOut className="h-4 w-4 mr-2" /> Sign out
        </Button>
      </header>

      <main className="flex-1 grid md:grid-cols-[320px_1fr] gap-4 p-4 max-w-7xl mx-auto w-full">
        {/* Upload panel */}
        <aside className="space-y-3">
          <Card
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => fileRef.current?.click()}
            className={`p-6 border-2 border-dashed cursor-pointer transition-colors text-center ${
              dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
            }`}
          >
            <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm font-medium">Drop files or click to upload</p>
            <p className="text-xs text-muted-foreground mt-1">PDF, TXT, MD</p>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept=".pdf,.txt,.md,application/pdf,text/plain"
              className="hidden"
              onChange={(e) => e.target.files && addFiles(e.target.files)}
            />
          </Card>
          <div className="space-y-1">
            {files.map((f, i) => (
              <div key={i} className="flex items-center gap-2 text-sm p-2 rounded-md bg-muted">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <span className="truncate flex-1">{f.name}</span>
                <span className="text-xs text-muted-foreground">{(f.size / 1024).toFixed(0)} KB</span>
              </div>
            ))}
          </div>
        </aside>

        {/* Chat panel */}
        <section className="flex flex-col border rounded-lg overflow-hidden">
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 min-h-[400px]">
            {messages.length === 0 ? (
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                Upload a document and start asking questions.
              </div>
            ) : (
              messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[80%] rounded-lg px-4 py-2 text-sm ${
                      m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"
                    }`}
                  >
                    {m.content}
                  </div>
                </div>
              ))
            )}
          </div>
          <form
            onSubmit={(e) => { e.preventDefault(); send(); }}
            className="border-t p-3 flex gap-2"
          >
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask a question about your documents..."
            />
            <Button type="submit" size="icon"><Send className="h-4 w-4" /></Button>
          </form>
        </section>
      </main>
    </div>
  );
}
