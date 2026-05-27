import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { embedQuery } from "./ingest.server";

const CHAT_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const CHAT_MODEL = "google/gemini-2.5-flash";
const TOP_K = 5;

export type ChatMsg = { role: "user" | "assistant" | "system"; content: string };
export type ChatSource = { document_id: string; chunk_index: number; similarity: number };

export async function answerQuestion(opts: {
  userId: string;
  question: string;
  history: ChatMsg[];
}): Promise<{ answer: string; sources: ChatSource[] }> {
  const { userId, question, history } = opts;
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("LOVABLE_API_KEY is not configured");

  const queryEmbedding = await embedQuery(question);

  const { data: matches, error: matchErr } = await supabaseAdmin.rpc("match_document_chunks", {
    query_embedding: queryEmbedding as unknown as string,
    match_user_id: userId,
    match_count: TOP_K,
  });
  if (matchErr) throw new Error(matchErr.message);

  const chunks = (matches ?? []) as Array<{
    id: string;
    document_id: string;
    chunk_index: number;
    content: string;
    similarity: number;
  }>;

  const context = chunks
    .map((c, i) => `[Source ${i + 1}]\n${c.content}`)
    .join("\n\n---\n\n");

  const systemPrompt = `You are a helpful assistant that answers questions strictly using the provided context from the user's documents. If the answer is not contained in the context, say you don't know based on the provided documents. Cite sources inline as [Source N] when relevant.`;

  const userPrompt = chunks.length
    ? `Context:\n${context}\n\nQuestion: ${question}`
    : `No relevant context was found in the user's documents.\n\nQuestion: ${question}`;

  const trimmedHistory = history.slice(-6);

  const res = await fetch(CHAT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: CHAT_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        ...trimmedHistory,
        { role: "user", content: userPrompt },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Chat completion failed [${res.status}]: ${body}`);
  }

  const json = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  const answer = json.choices?.[0]?.message?.content ?? "";

  return {
    answer,
    sources: chunks.map((c) => ({
      document_id: c.document_id,
      chunk_index: c.chunk_index,
      similarity: c.similarity,
    })),
  };
}
