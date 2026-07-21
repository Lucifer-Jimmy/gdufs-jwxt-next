import { z } from "zod";

const boundedText = (maximum: number) => z.string().trim().min(1).max(maximum);
const nullableText = (maximum: number) => boundedText(maximum).nullable();

export const loginRequestSchema = z
  .object({
    username: boundedText(64),
    password: z.string().min(1).max(256),
  })
  .strict();

export const loginResponseSchema = z.object({
  maskedPhone: boundedText(64),
  mfaExpiresAt: z.iso.datetime({ offset: true }),
});

export const mfaStatusResponseSchema = z.object({
  maskedPhone: boundedText(64),
  codeSent: z.boolean(),
  retryAfterSeconds: z.number().int().nonnegative(),
  expiresAt: z.iso.datetime({ offset: true }),
});

export const mfaSendRequestSchema = z.object({}).strict();

export const mfaSendResponseSchema = z.object({
  message: boundedText(256),
  retryAfterSeconds: z.number().int().positive(),
});

export const mfaVerifyRequestSchema = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^\d{4,8}$/u),
  })
  .strict();

export const mfaVerifyResponseSchema = z.object({
  authenticated: z.literal(true),
});

export const logoutRequestSchema = z.object({}).strict();
export const gradesRefreshRequestSchema = z.object({}).strict();

export const logoutResponseSchema = z.object({
  loggedOut: z.literal(true),
});

export const personalInfoSchema = z.object({
  studentId: boundedText(32),
  name: boundedText(128),
  college: boundedText(128),
  major: boundedText(128),
});

export const gradeDetailKeySchema = z.object({
  studentKey: boundedText(128),
  teachingClassKey: boundedText(128),
  gradeRecordKey: boundedText(128),
  totalScore: boundedText(64),
});

export const gradeSchema = z.object({
  courseCode: boundedText(64),
  courseName: boundedText(256),
  semester: boundedText(64),
  credits: z.number().nonnegative(),
  score: boundedText(64),
  numericScore: z.number().min(0).max(100),
  gradePoint: z.number().nonnegative(),
  assessmentMethod: boundedText(128),
  courseAttribute: boundedText(128),
  courseCategory: nullableText(128),
  detailKey: gradeDetailKeySchema,
});

export const gradesResponseSchema = z.object({
  grades: z.array(gradeSchema).max(300),
  reachedPageLimit: z.boolean(),
});

export const gradesRefreshResponseSchema = gradesResponseSchema.extend({
  retryAfterSeconds: z.number().int().positive(),
});

export const gradeDetailRequestSchema = gradeDetailKeySchema.strict();

export const gradeDetailResponseSchema = z
  .record(z.string().min(1).max(128), z.json())
  .superRefine((value, context) => {
    if (Object.keys(value).length > 64) {
      context.addIssue({
        code: "custom",
        message: "Grade detail contains too many fields",
      });
    }
  });

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
export type Grade = z.infer<typeof gradeSchema>;
export type GradeDetailKey = z.infer<typeof gradeDetailKeySchema>;
export type GradeDetail = z.infer<typeof gradeDetailResponseSchema>;
export type PersonalInfo = z.infer<typeof personalInfoSchema>;
