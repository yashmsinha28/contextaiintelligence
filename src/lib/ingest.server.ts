import { extractText, getDocumentProxy } from "unpdf";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const EMBED_MODEL = "openai/text-embedding-3-small"; // 1536 dims
const EMBED_URL = "https://ai.gateway.lovable.dev/v1/embeddings";
const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 200;
const EMBED_BATCH = 16;

export type ProcessResult = { chunks: number };

async function extractDocumentText(
  bytes: Uint8Array,
  mimeType: string,
  fileName: string,
): Promise<string> {
  const isPdf = mimeType === "application/pdf" || fileName.toLowerCase().endsWith(".pdf");
  if (isPdf) {
    const pdf = await getDocumentProxy(bytes);
    const { text } = await extractText(pdf, { mergePages: true });
    return Array.isArray(text) ? text.join("\n") : text;
  }
  // txt / md / fallback
  return new TextDecoder("utf-8").decode(bytes);
}

function chunkText(text: string): string[] {
  const clean = text.replace(/\r\n/g, "\n").replace(/\u0000/g, "").trim();
  if (!clean) return [];
  const chunks: string[] = [];
  let i = 0;
  while (i < clean.length) {
    const end = Math.min(i + CHUNK_SIZE, clean.length);
    let slice = clean.slice(i, end);
    // try to break on a paragraph or sentence boundary near the end
    if (end < clean.length) {
      const breakAt = Math.max(
        slice.lastIndexOf("\n\n"),
        slice.lastIndexOf("\n"),
        slice.lastIndexOf(". "),
      );
      if (breakAt > CHUNK_SIZE * 0.5) {
        slice = slice.slice(0, breakAt + 1);
      }
    }
    const trimmed = slice.trim();
    if (trimmed.length > 0) chunks.push(trimmed);
    if (end >= clean.length) break;
    i += Math.max(1, slice.length - CHUNK_OVERLAP);
  }
  return chunks;
}

async function embedBatch(inputs: string[]): Promise<number[][]> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("LOVABLE_API_KEY is not configured");
  const res = await fetch(EMBED_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: EMBED_MODEL, input: inputs }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Embedding failed [${res.status}]: ${body}`);
  }
  const json = (await res.json()) as { data: Array<{ embedding: number[]; index: number }> };
  // ensure order
  return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

export async function embedQuery(text: string): Promise<number[]> {
  const [vec] = await embedBatch([text]);
  return vec;
}

export async function processDocument(opts: {
  documentId: string;
  userId: string;
}): Promise<ProcessResult> {
  const { documentId, userId } = opts;

  const { data: doc, error: docErr } = await supabaseAdmin
    .from("documents")
    .select("id, user_id, file_name, mime_type, storage_path")
    .eq("id", documentId)
    .single();
  if (docErr || !doc) throw new Error(docErr?.message ?? "Document not found");
  if (doc.user_id !== userId) throw new Error("Forbidden");

  await supabaseAdmin
    .from("documents")
    .update({ status: "processing", error: null })
    .eq("id", documentId);

  try {
    const { data: file, error: dlErr } = await supabaseAdmin.storage
      .from("documents")
      .download(doc.storage_path);
    if (dlErr || !file) throw new Error(dlErr?.message ?? "Could not download file");

    const buf = new Uint8Array(await file.arrayBuffer());
    const text = await extractDocumentText(buf, doc.mime_type, doc.file_name);
    const chunks = chunkText(text);
    if (chunks.length === 0) throw new Error("No extractable text in document");

    // Wipe any previous chunks for this document (idempotent re-ingest)
    await supabaseAdmin.from("document_chunks").delete().eq("document_id", documentId);

    for (let start = 0; start < chunks.length; start += EMBED_BATCH) {
      const batch = chunks.slice(start, start + EMBED_BATCH);
      const vectors = await embedBatch(batch);
      const rows = batch.map((content, i) => ({
        document_id: documentId,
        user_id: userId,
        chunk_index: start + i,
        content,
        embedding: vectors[i] as unknown as string, // pgvector accepts number[] via supabase-js
        token_estimate: Math.ceil(content.length / 4),
      }));
      const { error: insErr } = await supabaseAdmin.from("document_chunks").insert(rows);
      if (insErr) throw new Error(insErr.message);
    }

    await supabaseAdmin
      .from("documents")
      .update({ status: "ready", error: null })
      .eq("id", documentId);

    return { chunks: chunks.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabaseAdmin
      .from("documents")
      .update({ status: "error", error: message })
      .eq("id", documentId);
    throw err;
  }
}
