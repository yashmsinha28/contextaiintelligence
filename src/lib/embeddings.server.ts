const EMBED_MODEL = "openai/text-embedding-3-small"; // 1536 dims
const EMBED_URL = "https://ai.gateway.lovable.dev/v1/embeddings";

export async function embedBatch(inputs: string[]): Promise<number[][]> {
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
    console.error(`[embeddings] status=${res.status} body=${body}`);
    throw new Error("Embedding service is temporarily unavailable");
  }
  const json = (await res.json()) as { data: Array<{ embedding: number[]; index: number }> };
  return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

export async function embedQuery(text: string): Promise<number[]> {
  const [vec] = await embedBatch([text]);
  return vec;
}