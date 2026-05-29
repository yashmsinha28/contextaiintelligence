import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Upload,
  FileText,
  Send,
  LogOut,
  Loader2,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  Plus,
  Paperclip,
  Settings,
  PanelLeftClose,
  PanelLeft,
  CloudUpload,
} from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { ingestDocument } from "@/lib/ingest.functions";
import { chatWithDocuments } from "@/lib/chat.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/")({ component: Index });

type Msg = { role: "user" | "assistant"; content: string };
type Doc = {
  id: string;
  file_name: string;
  size_bytes: number;
  status: string;
  storage_path: string;
  created_at: string;
};

const ACCEPTED = ["application/pdf", "text/plain", "text/markdown"];
const MAX_BYTES = 20 * 1024 * 1024;

function Index() {
  const navigate = useNavigate();
  const { user, loading, signOut } = useAuth();
  const [docs, setDocs] = useState<Doc[]>([]);
  const [uploading, setUploading] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const attachRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const chat = useServerFn(chatWithDocuments);
  const ingest = useServerFn(ingestDocument);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth" });
  }, [user, loading, navigate]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, thinking]);

  const fetchDocs = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from("documents")
      .select("id, file_name, size_bytes, status, storage_path, created_at")
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    else setDocs(data ?? []);
  }, [user]);

  useEffect(() => {
    if (user) fetchDocs();
  }, [user, fetchDocs]);

  const uploadOne = async (file: File): Promise<string | null> => {
    if (!user) return null;
    if (!ACCEPTED.includes(file.type) && !file.name.endsWith(".md")) {
      toast.error(`${file.name}: unsupported type`);
      return null;
    }
    if (file.size > MAX_BYTES) {
      toast.error(`${file.name}: exceeds 20 MB`);
      return null;
    }
    const path = `${user.id}/${crypto.randomUUID()}-${file.name}`;
    const { error: upErr } = await supabase.storage
      .from("documents")
      .upload(path, file, { contentType: file.type || "application/octet-stream" });
    if (upErr) {
      toast.error(`${file.name}: ${upErr.message}`);
      return null;
    }
    const { data: row, error: dbErr } = await supabase
      .from("documents")
      .insert({
        user_id: user.id,
        file_name: file.name,
        mime_type: file.type || "application/octet-stream",
        size_bytes: file.size,
        storage_path: path,
        status: "uploaded",
      })
      .select("id")
      .single();
    if (dbErr || !row) {
      await supabase.storage.from("documents").remove([path]);
      toast.error(`${file.name}: ${dbErr?.message ?? "insert failed"}`);
      return null;
    }
    toast.success(`Uploaded ${file.name}`);
    return row.id as string;
  };

  const addFiles = useCallback(
    async (list: FileList | File[]) => {
      const arr = Array.from(list);
      if (arr.length === 0) return;
      setUploading(true);
      const ids: string[] = [];
      for (const f of arr) {
        const id = await uploadOne(f);
        if (id) ids.push(id);
      }
      setUploading(false);
      fetchDocs();
      if (ids.length > 0 && !activeDocId) setActiveDocId(ids[0]);
      for (const id of ids) {
        ingest({ data: { documentId: id } })
          .then((r) => toast.success(`Indexed ${r.chunks} chunks`))
          .catch((e: unknown) => toast.error(e instanceof Error ? e.message : "Ingestion failed"))
          .finally(() => fetchDocs());
      }
    },
    [user, fetchDocs, ingest, activeDocId] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const removeDoc = async (doc: Doc) => {
    await supabase.storage.from("documents").remove([doc.storage_path]);
    const { error } = await supabase.from("documents").delete().eq("id", doc.id);
    if (error) return toast.error(error.message);
    if (activeDocId === doc.id) setActiveDocId(null);
    toast.success("Removed");
    fetchDocs();
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    addFiles(e.dataTransfer.files);
  };

  const send = async () => {
    const question = input.trim();
    if (!question || thinking) return;
    const userMsg: Msg = { role: "user", content: question };
    const history = messages.slice(-6);
    setMessages((m) => [...m, userMsg]);
    setInput("");
    setThinking(true);
    try {
      const res = await chat({ data: { question, history } });
      setMessages((m) => [...m, { role: "assistant", content: res.answer || "(no answer)" }]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Chat failed";
      toast.error(msg);
      setMessages((m) => [...m, { role: "assistant", content: `Error: ${msg}` }]);
    } finally {
      setThinking(false);
    }
  };

  const newChat = () => {
    setMessages([]);
    setActiveDocId(null);
  };

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const hasReady = docs.some((d) => d.status === "ready");
  const showChat = messages.length > 0 || activeDocId !== null;

  return (
    <div className="h-screen w-full flex bg-[var(--gradient-subtle)] text-foreground overflow-hidden">
      {/* Sidebar */}
      <aside
        className={`${
          sidebarOpen ? "w-72" : "w-0 md:w-16"
        } shrink-0 transition-all duration-300 border-r border-sidebar-border bg-sidebar/80 backdrop-blur-xl flex flex-col overflow-hidden`}
      >
        <div className="h-14 flex items-center gap-2 px-3 border-b border-sidebar-border shrink-0">
          <div className="rounded-lg bg-[var(--gradient-hero)] p-1.5 text-primary-foreground shrink-0">
            <Sparkles className="h-4 w-4" />
          </div>
          {sidebarOpen && (
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate">Context AI</p>
              <p className="text-[10px] text-muted-foreground truncate">Cloud Document Intelligence</p>
            </div>
          )}
        </div>

        <div className="p-3">
          <Button
            onClick={newChat}
            className={`w-full justify-start gap-2 rounded-xl ${!sidebarOpen && "md:px-0 md:justify-center"}`}
            variant="outline"
          >
            <Plus className="h-4 w-4 shrink-0" />
            {sidebarOpen && <span>New Chat</span>}
          </Button>
        </div>

        {sidebarOpen && (
          <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
            Recent documents
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
          {docs.length === 0 && sidebarOpen && (
            <p className="text-xs text-muted-foreground px-2 py-4 text-center">No documents yet.</p>
          )}
          {docs.map((d) => {
            const active = activeDocId === d.id;
            return (
              <div
                key={d.id}
                onClick={() => {
                  setActiveDocId(d.id);
                }}
                className={`group flex items-center gap-2 px-2 py-2 rounded-lg cursor-pointer transition-colors ${
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "hover:bg-sidebar-accent/60 text-sidebar-foreground/80"
                }`}
                title={d.file_name}
              >
                <FileText className="h-4 w-4 shrink-0 text-primary/80" />
                {sidebarOpen && (
                  <>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium truncate">{d.file_name}</div>
                      <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                        {d.status === "ready" ? (
                          <CheckCircle2 className="h-2.5 w-2.5 text-emerald-400" />
                        ) : d.status === "error" ? (
                          <AlertCircle className="h-2.5 w-2.5 text-destructive" />
                        ) : (
                          <Loader2 className="h-2.5 w-2.5 animate-spin" />
                        )}
                        {d.status}
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeDoc(d);
                      }}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>

        <div className="border-t border-sidebar-border p-3 flex items-center gap-2">
          <div className="h-8 w-8 rounded-full bg-[var(--gradient-hero)] flex items-center justify-center text-xs font-semibold text-primary-foreground shrink-0">
            {user.email?.[0]?.toUpperCase() ?? "U"}
          </div>
          {sidebarOpen && (
            <>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{user.email}</p>
                <p className="text-[10px] text-muted-foreground">Signed in</p>
              </div>
              <button
                onClick={signOut}
                className="p-1.5 rounded-md hover:bg-sidebar-accent text-muted-foreground hover:text-foreground transition"
                title="Sign out"
              >
                <LogOut className="h-4 w-4" />
              </button>
              <button
                className="p-1.5 rounded-md hover:bg-sidebar-accent text-muted-foreground hover:text-foreground transition"
                title="Settings"
              >
                <Settings className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 shrink-0 border-b border-border bg-background/40 backdrop-blur-xl flex items-center px-4 gap-3">
          <button
            onClick={() => setSidebarOpen((o) => !o)}
            className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition"
          >
            {sidebarOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeft className="h-4 w-4" />}
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-medium truncate">
              {showChat
                ? docs.find((d) => d.id === activeDocId)?.file_name ?? "New Chat"
                : "Welcome back"}
            </h1>
          </div>
          {hasReady && (
            <div className="hidden sm:flex items-center gap-1.5 text-[11px] text-muted-foreground px-2.5 py-1 rounded-full border border-border bg-card/60">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              {docs.filter((d) => d.status === "ready").length} indexed
            </div>
          )}
        </header>

        {!showChat ? (
          /* Empty state — upload zone */
          <div className="flex-1 overflow-y-auto flex items-center justify-center p-6">
            <div className="w-full max-w-xl">
              <div className="text-center mb-6">
                <h2 className="text-2xl md:text-3xl font-semibold tracking-tight">
                  Context-Aware Document Intelligence
                </h2>
                <p className="text-sm text-muted-foreground mt-2">
                  Upload a secure document to start querying with AI.
                </p>
              </div>

              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
                onClick={() => fileRef.current?.click()}
                className={`rounded-2xl border-2 border-dashed cursor-pointer transition-all p-10 md:p-14 text-center backdrop-blur-md ${
                  dragOver
                    ? "border-primary bg-primary/5 scale-[1.01]"
                    : "border-border hover:border-primary/50 bg-card/40"
                }`}
              >
                {uploading ? (
                  <Loader2 className="h-12 w-12 mx-auto text-primary mb-4 animate-spin" />
                ) : (
                  <div className="mx-auto mb-4 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--gradient-hero)] text-primary-foreground shadow-[var(--shadow-elegant)]">
                    <CloudUpload className="h-8 w-8" />
                  </div>
                )}
                <p className="text-base font-medium">
                  {uploading ? "Uploading…" : "Drop a file or click to upload"}
                </p>
                <p className="text-xs text-muted-foreground mt-1.5">
                  PDF, TXT, MD · encrypted at rest · up to 20 MB
                </p>
                <input
                  ref={fileRef}
                  type="file"
                  multiple
                  accept=".pdf,.txt,.md,application/pdf,text/plain"
                  className="hidden"
                  onChange={(e) => e.target.files && addFiles(e.target.files)}
                />
              </div>

              {hasReady && (
                <div className="mt-4 text-center">
                  <button
                    onClick={() => setActiveDocId(docs.find((d) => d.status === "ready")?.id ?? null)}
                    className="text-xs text-primary hover:underline"
                  >
                    Or continue chatting with an existing document →
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Chat view */
          <>
            <div ref={scrollRef} className="flex-1 overflow-y-auto">
              <div className="max-w-3xl mx-auto w-full px-4 md:px-6 py-6 space-y-6">
                {messages.length === 0 ? (
                  <div className="text-center py-16">
                    <div className="mx-auto mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--gradient-hero)] text-primary-foreground">
                      <Sparkles className="h-5 w-5" />
                    </div>
                    <p className="font-medium">Ask anything about your documents</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      Try: "Summarize this" or "What are the key takeaways?"
                    </p>
                  </div>
                ) : (
                  messages.map((m, i) =>
                    m.role === "user" ? (
                      <div key={i} className="flex justify-end">
                        <div className="max-w-[85%] rounded-2xl rounded-br-md px-4 py-2.5 text-sm whitespace-pre-wrap bg-primary/15 border border-primary/25 text-foreground">
                          {m.content}
                        </div>
                      </div>
                    ) : (
                      <div key={i} className="flex gap-3">
                        <div className="h-7 w-7 shrink-0 rounded-lg bg-[var(--gradient-hero)] flex items-center justify-center text-primary-foreground">
                          <Sparkles className="h-3.5 w-3.5" />
                        </div>
                        <div className="flex-1 text-sm leading-relaxed whitespace-pre-wrap pt-0.5">
                          {m.content}
                        </div>
                      </div>
                    )
                  )
                )}
                {thinking && (
                  <div className="flex gap-3">
                    <div className="h-7 w-7 shrink-0 rounded-lg bg-[var(--gradient-hero)] flex items-center justify-center text-primary-foreground">
                      <Sparkles className="h-3.5 w-3.5" />
                    </div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground pt-1">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Thinking…
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Sticky input */}
            <div className="shrink-0 border-t border-border bg-background/60 backdrop-blur-xl">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  send();
                }}
                className="max-w-3xl mx-auto w-full px-4 md:px-6 py-3"
              >
                <div className="flex items-end gap-2 rounded-2xl border border-border bg-card/60 backdrop-blur p-2 shadow-[var(--shadow-elegant)] focus-within:border-primary/60 transition">
                  <button
                    type="button"
                    onClick={() => attachRef.current?.click()}
                    className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition"
                    title="Attach file"
                  >
                    <Paperclip className="h-4 w-4" />
                  </button>
                  <input
                    ref={attachRef}
                    type="file"
                    multiple
                    accept=".pdf,.txt,.md,application/pdf,text/plain"
                    className="hidden"
                    onChange={(e) => e.target.files && addFiles(e.target.files)}
                  />
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        send();
                      }
                    }}
                    placeholder="Ask anything about your documents…"
                    rows={1}
                    disabled={thinking}
                    className="flex-1 resize-none bg-transparent outline-none text-sm py-2 px-1 placeholder:text-muted-foreground max-h-40"
                  />
                  <Button
                    type="submit"
                    size="icon"
                    disabled={thinking || !input.trim()}
                    className="rounded-xl shrink-0"
                  >
                    {thinking ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground text-center mt-1.5">
                  Answers are grounded in your uploaded documents.
                </p>
              </form>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
