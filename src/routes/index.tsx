import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Upload, FileText, Send, LogOut, Loader2, Trash2, CheckCircle2, AlertCircle } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
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
const MAX_BYTES = 20 * 1024 * 1024; // 20 MB

function Index() {
  const navigate = useNavigate();
  const { user, loading, signOut } = useAuth();
  const [docs, setDocs] = useState<Doc[]>([]);
  const [uploading, setUploading] = useState(false);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [thinking, setThinking] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const chat = useServerFn(chatWithDocuments);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth" });
  }, [user, loading, navigate]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const fetchDocs = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from("documents")
      .select("id, file_name, size_bytes, status, storage_path, created_at")
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    else setDocs(data ?? []);
    setLoadingDocs(false);
  }, [user]);

  useEffect(() => {
    if (user) fetchDocs();
  }, [user, fetchDocs]);

  const ingest = useServerFn(ingestDocument);

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
      // Kick off ingestion in parallel (don't block UI)
      for (const id of ids) {
        ingest({ data: { documentId: id } })
          .then((r) => toast.success(`Indexed ${r.chunks} chunks`))
          .catch((e: unknown) => toast.error(e instanceof Error ? e.message : "Ingestion failed"))
          .finally(() => fetchDocs());
      }
    },
    [user, fetchDocs, ingest] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const removeDoc = async (doc: Doc) => {
    const { error: sErr } = await supabase.storage.from("documents").remove([doc.storage_path]);
    if (sErr) return toast.error(sErr.message);
    const { error: dErr } = await supabase.from("documents").delete().eq("id", doc.id);
    if (dErr) return toast.error(dErr.message);
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
        <aside className="space-y-3">
          <Card
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => fileRef.current?.click()}
            className={`p-6 border-2 border-dashed cursor-pointer transition-colors text-center ${
              dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
            }`}
          >
            {uploading ? (
              <Loader2 className="h-8 w-8 mx-auto text-muted-foreground mb-2 animate-spin" />
            ) : (
              <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
            )}
            <p className="text-sm font-medium">
              {uploading ? "Uploading…" : "Drop files or click to upload"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">PDF, TXT, MD · up to 20 MB</p>
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
            {loadingDocs ? (
              <p className="text-xs text-muted-foreground px-2">Loading…</p>
            ) : docs.length === 0 ? (
              <p className="text-xs text-muted-foreground px-2">No documents yet.</p>
            ) : (
              docs.map((d) => (
                <div
                  key={d.id}
                  className="flex items-center gap-2 text-sm p-2 rounded-md bg-muted group"
                >
                  <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="truncate">{d.file_name}</div>
                    <div className="text-xs text-muted-foreground flex items-center gap-1">
                      {d.status === "processing" || d.status === "uploaded" ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : d.status === "ready" ? (
                        <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                      ) : d.status === "error" ? (
                        <AlertCircle className="h-3 w-3 text-destructive" />
                      ) : null}
                      {(d.size_bytes / 1024).toFixed(0)} KB · {d.status}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 opacity-0 group-hover:opacity-100"
                    onClick={() => removeDoc(d)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))
            )}
          </div>
        </aside>

        <section className="flex flex-col border rounded-lg overflow-hidden">
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 min-h-[400px]">
            {messages.length === 0 ? (
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                Upload a document and start asking questions.
              </div>
            ) : (
              <>
                {messages.map((m, i) => (
                  <div
                    key={i}
                    className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[80%] rounded-lg px-4 py-2 text-sm whitespace-pre-wrap ${
                        m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"
                      }`}
                    >
                      {m.content}
                    </div>
                  </div>
                ))}
                {thinking && (
                  <div className="flex justify-start">
                    <div className="bg-muted rounded-lg px-4 py-2 text-sm flex items-center gap-2">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Thinking…
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
            className="border-t p-3 flex gap-2"
          >
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask a question about your documents..."
              disabled={thinking}
            />
            <Button type="submit" size="icon" disabled={thinking || !input.trim()}>
              {thinking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </form>
        </section>
      </main>
    </div>
  );
}
