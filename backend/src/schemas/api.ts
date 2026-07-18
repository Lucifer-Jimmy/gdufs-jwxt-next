import { z } from "zod";

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
});

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string(),
    retryAfterSeconds: z.number().int().positive().optional(),
  }),
});

export type ApiError = z.infer<typeof apiErrorSchema>;
