import { z } from "zod";

const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string(),
    retryAfterSeconds: z.number().int().positive().optional(),
  }),
});

export const loginResponseSchema = z.object({
  maskedPhone: z.string().min(1),
  mfaExpiresAt: z.iso.datetime({ offset: true }),
});

export const mfaStatusResponseSchema = z.object({
  maskedPhone: z.string().min(1),
  codeSent: z.boolean(),
  retryAfterSeconds: z.number().int().nonnegative(),
  expiresAt: z.iso.datetime({ offset: true }),
});

export const mfaSendResponseSchema = z.object({
  message: z.string().min(1),
  retryAfterSeconds: z.number().int().positive(),
});

export const mfaVerifyResponseSchema = z.object({
  authenticated: z.literal(true),
});

export const logoutResponseSchema = z.object({
  loggedOut: z.literal(true),
});

export const personalInfoSchema = z.object({
  studentId: z.string().min(1),
  name: z.string().min(1),
  college: z.string().min(1),
  major: z.string().min(1),
});

export const gradeDetailKeySchema = z.object({
  studentKey: z.string().min(1),
  teachingClassKey: z.string().min(1),
  gradeRecordKey: z.string().min(1),
  totalScore: z.string().min(1),
});

export const gradeSchema = z.object({
  courseCode: z.string().min(1),
  courseName: z.string().min(1),
  semester: z.string().min(1),
  credits: z.number().nonnegative(),
  score: z.string().min(1),
  numericScore: z.number().min(0).max(100),
  gradePoint: z.number().nonnegative(),
  assessmentMethod: z.string().min(1),
  courseAttribute: z.string().min(1),
  courseCategory: z.string().min(1).nullable(),
  detailKey: gradeDetailKeySchema,
});

export const gradesResponseSchema = z.object({
  grades: z.array(gradeSchema),
  reachedPageLimit: z.boolean(),
});

export const gradesRefreshResponseSchema = gradesResponseSchema.extend({
  retryAfterSeconds: z.number().int().positive(),
});

// 成绩详情是已确认的例外边界：后端原样透传上游单个 JSON 对象，
// 前端同样不假设固定字段集合，只做外层结构校验。
export const gradeDetailResponseSchema = z.record(z.string(), z.json());

export type PersonalInfo = z.infer<typeof personalInfoSchema>;
export type Grade = z.infer<typeof gradeSchema>;
export type GradeDetailKey = z.infer<typeof gradeDetailKeySchema>;
export type GradeDetail = z.infer<typeof gradeDetailResponseSchema>;
export type GradesResponse = z.infer<typeof gradesResponseSchema>;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly requestId: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// 后端对缺失、无效、过期的认证状态分别返回三个 401 错误码，
// 前端统一视为「需要重新登录」。
const AUTH_ERROR_CODES: ReadonlySet<string> = new Set([
  "AUTHENTICATION_REQUIRED",
  "SESSION_EXPIRED",
  "SESSION_INVALID",
]);

/** 不触发 TypeScript 收窄的普通布尔判断，适合在 JSX 否定分支中使用。 */
export function isAuthErrorCode(code: string): boolean {
  return AUTH_ERROR_CODES.has(code);
}

export function isAuthError(error: unknown): error is ApiError {
  return error instanceof ApiError && isAuthErrorCode(error.code);
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new ApiError(
      "服务暂时返回了无法识别的内容，请稍后重试",
      "INVALID_RESPONSE",
      response.headers.get("X-Request-Id") ?? "unknown",
    );
  }
}

async function request<T>(
  path: string,
  init: RequestInit,
  schema: z.ZodType<T>,
): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...init.headers },
  });
  const payload = await parseJson(response);

  if (!response.ok) {
    const error = apiErrorSchema.safeParse(payload);
    if (error.success) {
      throw new ApiError(
        error.data.error.message,
        error.data.error.code,
        error.data.error.requestId,
        error.data.error.retryAfterSeconds,
      );
    }
    throw new ApiError(
      "请求未能完成，请稍后重试",
      "UNKNOWN_ERROR",
      response.headers.get("X-Request-Id") ?? "unknown",
    );
  }

  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new ApiError(
      "服务响应格式已发生变化，请稍后重试",
      "INVALID_RESPONSE",
      response.headers.get("X-Request-Id") ?? "unknown",
    );
  }
  return result.data;
}

const EMPTY_BODY = JSON.stringify({});

export function login(username: string, password: string) {
  return request(
    "/api/v1/auth/login",
    { method: "POST", body: JSON.stringify({ username, password }) },
    loginResponseSchema,
  );
}

export function getMfaStatus() {
  return request(
    "/api/v1/auth/mfa",
    { method: "GET" },
    mfaStatusResponseSchema,
  );
}

export function sendMfaCode() {
  return request(
    "/api/v1/auth/mfa/send",
    { method: "POST", body: EMPTY_BODY },
    mfaSendResponseSchema,
  );
}

export function verifyMfaCode(code: string) {
  return request(
    "/api/v1/auth/mfa/verify",
    { method: "POST", body: JSON.stringify({ code }) },
    mfaVerifyResponseSchema,
  );
}

export function logout() {
  return request(
    "/api/v1/auth/logout",
    { method: "POST", body: EMPTY_BODY },
    logoutResponseSchema,
  );
}

export function getPersonalInfo() {
  return request("/api/v1/me", { method: "GET" }, personalInfoSchema);
}

export function getGrades() {
  return request("/api/v1/grades", { method: "GET" }, gradesResponseSchema);
}

export function refreshGrades() {
  return request(
    "/api/v1/grades/refresh",
    { method: "POST", body: EMPTY_BODY },
    gradesRefreshResponseSchema,
  );
}

export function getGradeDetail(key: GradeDetailKey) {
  return request(
    "/api/v1/grades/detail",
    { method: "POST", body: JSON.stringify(key) },
    gradeDetailResponseSchema,
  );
}
