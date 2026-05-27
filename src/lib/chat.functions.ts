import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { answerQuestion } from "./chat.server";

const messageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string().min(1).max(8000),
});

const inputSchema = z.object({
  question: z.string().min(1).max(4000),
  history: z.array(messageSchema).max(20).default([]),
});

export const chatWithDocuments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    return answerQuestion({
      userId,
      question: data.question,
      history: data.history,
    });
  });
