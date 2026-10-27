import { z } from "zod";

// Keep validation independent of the workspace model and its demo reducers.
export const attentionCommand = z.object({
  type: z.literal("review_attention"),
  kind: z.enum(["reply", "failed", "lead", "website", "facebook"]),
  id: z.uuid(),
});
