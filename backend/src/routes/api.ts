import { Hono } from "hono";
import type { Context } from "hono";

import { loadSecurityConfig } from "../config/security-config";
import { DomainError } from "../errors/domain-error";
import {
  beginMfaLogin,
  sendMfaCode,
  verifyMfaCode,
} from "../services/authserver";
import {
  fetchCookiesByTicket,
  getAllGrades,
  getGradeDetail,
  getPersonalInfo,
} from "../services/jwxt";
import {
  gradeDetailRequestSchema,
  gradesRefreshRequestSchema,
  loginRequestSchema,
  logoutRequestSchema,
  mfaSendRequestSchema,
  mfaVerifyRequestSchema,
} from "../schemas/api";
import {
  clearRateLimitActions,
  consumeRateLimit,
  enforceRateLimits,
} from "../rate-limit/rate-limiter";
import { deriveRateLimitSubject } from "../rate-limit/subject";
import { RATE_LIMIT_POLICIES } from "../rate-limit/rules";
import {
  asUpstreamCookies,
  LOGIN_COOKIE_NAME,
  LOGIN_IDLE_TTL_SECONDS,
  MFA_COOKIE_NAME,
  MFA_TTL_SECONDS,
  openLoginState,
  openMfaState,
  renewAuthenticatedState,
  sealLoginState,
  sealMfaState,
  updateMfaState,
} from "../session/auth-state";
import {
  clearStateCookie,
  readCookie,
  serializeStateCookie,
} from "../session/cookie-budget";
import {
  requireJsonContentType,
  requireSameOrigin,
} from "../security/request-guards";
import { logError } from "../security/safe-logger";
import { UpstreamClient } from "../upstream/client";
import {
  isSchoolCookieDomain,
  UpstreamCookieJar,
} from "../upstream/cookie-jar";

interface ApiVariables {
  requestId: string;
}

type ApiContext = Context<{
  Bindings: Bindings;
  Variables: ApiVariables;
}>;

const UPSTREAM_TIMEOUT_MS = 10_000;

export const api = new Hono<{
  Bindings: Bindings;
  Variables: ApiVariables;
}>();

api.get("/v1/health", (context) => context.json({ status: "ok" as const }));

api.post(
  "/v1/auth/login",
  requireJsonContentType,
  requireSameOrigin,
  async (context) => {
    const input = await parseJson(context, loginRequestSchema);
    const now = unixNow();
    const config = loadSecurityConfig(context.env);
    const ip = requestIp(context);

    appendCookie(context, clearStateCookie(MFA_COOKIE_NAME));

    await enforceRateLimits({
      namespace: context.env.RATE_LIMIT_SHARD,
      hmacKey: config.rateLimitHmacKey,
      dimensions: [
        {
          kind: "account",
          subject: input.username,
          rules: RATE_LIMIT_POLICIES.authLogin.account,
        },
        {
          kind: "ip",
          subject: ip,
          rules: RATE_LIMIT_POLICIES.authLogin.ip,
        },
      ],
      now,
    });

    const authClient = new UpstreamClient({
      timeoutMs: UPSTREAM_TIMEOUT_MS,
      now: () => now,
    });
    const result = await beginMfaLogin(
      authClient,
      input.username,
      input.password,
      now,
    );
    const accountHash = await accountHashFor(
      input.username,
      config.rateLimitHmacKey,
    );
    await diagnoseLoginStage(
      context,
      "auth_login_rate_limit_clear",
      async () =>
        clearRateLimitActions({
          namespace: context.env.RATE_LIMIT_SHARD,
          hmacKey: config.rateLimitHmacKey,
          dimension: { kind: "account", subject: input.username },
          actions: ["auth_login_account"],
        }),
    );
    const upstreamCookies = diagnoseLoginStageSync(
      context,
      "auth_mfa_state_validate",
      () => {
        diagnoseUpstreamCookieShape(context, result.upstreamCookies);
        return asUpstreamCookies(result.upstreamCookies);
      },
    );
    const mfaToken = await diagnoseLoginStage(
      context,
      "auth_mfa_state_seal",
      async () =>
        sealMfaState(
          {
            username: input.username,
            accountHash,
            flowId: crypto.randomUUID(),
            maskedPhone: result.maskedPhone,
            codeSent: false,
            resendAllowedAt: 0,
            upstreamCookies,
          },
          config.sessionKey,
          now,
        ),
    );

    appendCookie(context, clearStateCookie(LOGIN_COOKIE_NAME));
    const mfaCookie = diagnoseLoginStageSync(
      context,
      "auth_mfa_cookie_serialize",
      () => serializeStateCookie(MFA_COOKIE_NAME, mfaToken, MFA_TTL_SECONDS),
    );
    appendCookie(context, mfaCookie);
    return context.json({
      maskedPhone: result.maskedPhone,
      mfaExpiresAt: isoTime(now + MFA_TTL_SECONDS),
    });
  },
);

api.get("/v1/auth/mfa", async (context) => {
  const { claims } = await requireMfaState(context);
  const now = unixNow();
  return context.json({
    maskedPhone: claims.payload.maskedPhone,
    codeSent: claims.payload.codeSent,
    retryAfterSeconds: Math.max(0, claims.payload.resendAllowedAt - now),
    expiresAt: isoTime(claims.expiresAt),
  });
});

api.post(
  "/v1/auth/mfa/send",
  requireJsonContentType,
  requireSameOrigin,
  async (context) => {
    await parseJson(context, mfaSendRequestSchema);
    const { claims, config } = await requireMfaState(context);
    const now = unixNow();
    const retryAfter = claims.payload.resendAllowedAt - now;
    if (retryAfter > 0) {
      throw new DomainError({
        code: "RATE_LIMITED",
        message: "验证码仍在有效期内，请稍后再试",
        status: 429,
        retryAfterSeconds: retryAfter,
      });
    }

    await enforceRateLimits({
      namespace: context.env.RATE_LIMIT_SHARD,
      hmacKey: config.rateLimitHmacKey,
      dimensions: [
        {
          kind: "account",
          subject: claims.payload.username,
          rules: RATE_LIMIT_POLICIES.mfaSend.account,
        },
        {
          kind: "ip",
          subject: requestIp(context),
          rules: RATE_LIMIT_POLICIES.mfaSend.ip,
        },
      ],
      now,
    });

    const authClient = new UpstreamClient({
      timeoutMs: UPSTREAM_TIMEOUT_MS,
      now: () => now,
      jar: new UpstreamCookieJar(claims.payload.upstreamCookies),
    });
    const result = await sendMfaCode(authClient, claims.payload.username);
    const updatedToken = await updateMfaState(
      claims,
      {
        ...claims.payload,
        codeSent: true,
        resendAllowedAt: now + result.codeTimeSeconds,
        upstreamCookies: asUpstreamCookies(authClient.jar.serialize(now)),
      },
      config.sessionKey,
    );

    appendCookie(
      context,
      serializeStateCookie(
        MFA_COOKIE_NAME,
        updatedToken,
        Math.max(1, claims.expiresAt - now),
      ),
    );
    return context.json({
      message: result.message,
      retryAfterSeconds: result.codeTimeSeconds,
    });
  },
);

api.post(
  "/v1/auth/mfa/verify",
  requireJsonContentType,
  requireSameOrigin,
  async (context) => {
    const input = await parseJson(context, mfaVerifyRequestSchema);
    const { claims, config } = await requireMfaState(context);
    if (!claims.payload.codeSent) {
      throw new DomainError({
        code: "MFA_NOT_SENT",
        message: "请先获取验证码",
        status: 400,
      });
    }

    const now = unixNow();
    const authClient = new UpstreamClient({
      timeoutMs: UPSTREAM_TIMEOUT_MS,
      now: () => now,
      jar: new UpstreamCookieJar(claims.payload.upstreamCookies),
    });

    const decision = await consumeRateLimit({
      namespace: context.env.RATE_LIMIT_SHARD,
      hmacKey: config.rateLimitHmacKey,
      dimension: {
        kind: "flow",
        subject: claims.payload.flowId,
        rules: RATE_LIMIT_POLICIES.mfaVerifyFailure.flow,
      },
      now,
      returnExhaustedAfterConsume: true,
    });
    if (!decision.allowed) {
      appendCookie(context, clearStateCookie(MFA_COOKIE_NAME));
      throw new DomainError({
        code: "RATE_LIMITED",
        message: "验证码尝试次数过多，请重新登录",
        status: 429,
        retryAfterSeconds: decision.retryAfterSeconds,
      });
    }

    let ticketUrl: URL;
    try {
      ticketUrl = await verifyMfaCode(authClient, input.code);
    } catch (error) {
      if (
        !(error instanceof DomainError) ||
        error.code !== "INVALID_MFA_CODE"
      ) {
        throw error;
      }
      if (decision.exhaustedAfterConsume === true) {
        appendCookie(context, clearStateCookie(MFA_COOKIE_NAME));
      }
      throw error;
    }

    const jwxtCookies = await fetchCookiesByTicket(
      ticketUrl,
      UPSTREAM_TIMEOUT_MS,
      now,
      undefined,
      (stage) =>
        logError({
          event: "request_failed",
          requestId: context.get("requestId"),
          stage,
          errorCode: "TICKET_NOT_FOUND",
        }),
    );
    await getPersonalInfo(jwxtCookies, UPSTREAM_TIMEOUT_MS, now);
    const loginToken = await sealLoginState(
      {
        accountHash: claims.payload.accountHash,
        upstreamCookies: asUpstreamCookies(jwxtCookies),
      },
      config.sessionKey,
      now,
    );

    appendCookie(context, clearStateCookie(MFA_COOKIE_NAME));
    appendCookie(
      context,
      serializeStateCookie(
        LOGIN_COOKIE_NAME,
        loginToken,
        LOGIN_IDLE_TTL_SECONDS,
      ),
    );
    return context.json({ authenticated: true as const });
  },
);

api.post(
  "/v1/auth/logout",
  requireJsonContentType,
  requireSameOrigin,
  async (context) => {
    await parseJson(context, logoutRequestSchema);
    appendCookie(context, clearStateCookie(MFA_COOKIE_NAME));
    appendCookie(context, clearStateCookie(LOGIN_COOKIE_NAME));
    return context.json({ loggedOut: true as const });
  },
);

api.get("/v1/me", async (context) => {
  const { claims, config } = await requireLoginState(context);
  const now = unixNow();
  const personalInfo = await callAuthenticatedUpstream(
    context,
    claims,
    config,
    now,
    () =>
      getPersonalInfo(
        claims.payload.upstreamCookies,
        UPSTREAM_TIMEOUT_MS,
        now,
      ),
  );
  return context.json(personalInfo);
});

api.get("/v1/grades", async (context) => {
  const { claims, config } = await requireLoginState(context);
  const now = unixNow();
  const result = await callAuthenticatedUpstream(
    context,
    claims,
    config,
    now,
    () =>
      getAllGrades(
        claims.payload.upstreamCookies,
        UPSTREAM_TIMEOUT_MS,
        now,
      ),
  );
  logGradePageLimit(context, result.reachedPageLimit);
  return context.json(result);
});

api.post(
  "/v1/grades/refresh",
  requireJsonContentType,
  requireSameOrigin,
  async (context) => {
    await parseJson(context, gradesRefreshRequestSchema);
    const { claims, config } = await requireLoginState(context);
    const now = unixNow();

    await enforceRateLimits({
      namespace: context.env.RATE_LIMIT_SHARD,
      hmacKey: config.rateLimitHmacKey,
      dimensions: [
        {
          kind: "account",
          subject: claims.payload.accountHash,
          rules: RATE_LIMIT_POLICIES.gradesRefresh.account,
        },
      ],
      now,
    });

    const result = await callAuthenticatedUpstream(
      context,
      claims,
      config,
      now,
      () =>
        getAllGrades(
          claims.payload.upstreamCookies,
          UPSTREAM_TIMEOUT_MS,
          now,
        ),
    );
    logGradePageLimit(context, result.reachedPageLimit);
    return context.json({
      ...result,
      retryAfterSeconds:
        RATE_LIMIT_POLICIES.gradesRefresh.account[0].windowSeconds,
    });
  },
);

api.post(
  "/v1/grades/detail",
  requireJsonContentType,
  requireSameOrigin,
  async (context) => {
    const input = await parseJson(context, gradeDetailRequestSchema);
    const { claims, config } = await requireLoginState(context);
    const now = unixNow();
    const detail = await callAuthenticatedUpstream(
      context,
      claims,
      config,
      now,
      () =>
        getGradeDetail(
          claims.payload.upstreamCookies,
          input,
          UPSTREAM_TIMEOUT_MS,
          now,
        ),
    );
    return context.json(detail);
  },
);

api.notFound((context) =>
  context.json(
    {
      error: {
        code: "API_ROUTE_NOT_FOUND",
        message: "请求的 API 不存在",
        requestId: context.get("requestId"),
      },
    },
    404,
  ),
);

type LoginClaims = Extract<
  Awaited<ReturnType<typeof openLoginState>>,
  { status: "valid" }
>["claims"];

async function callAuthenticatedUpstream<T>(
  context: ApiContext,
  claims: LoginClaims,
  config: ReturnType<typeof loadSecurityConfig>,
  now: number,
  operation: () => Promise<T>,
): Promise<T> {
  let result: T;
  try {
    result = await operation();
  } catch (error) {
    if (
      error instanceof DomainError &&
      (error.code === "SESSION_EXPIRED" ||
        error.code === "AUTHENTICATION_REQUIRED")
    ) {
      appendCookie(context, clearStateCookie(LOGIN_COOKIE_NAME));
    }
    throw error;
  }

  const renewedToken = await renewAuthenticatedState(
    claims,
    config.sessionKey,
    now,
  );
  if (renewedToken !== undefined) {
    appendCookie(
      context,
      serializeStateCookie(
        LOGIN_COOKIE_NAME,
        renewedToken,
        Math.max(
          1,
          Math.min(LOGIN_IDLE_TTL_SECONDS, claims.absoluteExpiresAt - now),
        ),
      ),
    );
  }
  return result;
}

function logGradePageLimit(context: ApiContext, reached: boolean): void {
  if (!reached) {
    return;
  }
  logError({
    event: "upstream_page_limit_reached",
    requestId: context.get("requestId"),
    stage: "jwxt_grades",
  });
}

async function diagnoseLoginStage<T>(
  context: ApiContext,
  stage:
    | "auth_login_rate_limit_clear"
    | "auth_mfa_state_seal",
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    logLoginStageFailure(context, stage, error);
    throw error;
  }
}

function diagnoseLoginStageSync<T>(
  context: ApiContext,
  stage: "auth_mfa_state_validate" | "auth_mfa_cookie_serialize",
  operation: () => T,
): T {
  try {
    return operation();
  } catch (error) {
    logLoginStageFailure(context, stage, error);
    throw error;
  }
}

function logLoginStageFailure(
  context: ApiContext,
  stage:
    | "auth_login_rate_limit_clear"
    | "auth_mfa_state_validate"
    | "auth_mfa_state_seal"
    | "auth_mfa_cookie_serialize",
  error: unknown,
): void {
  logError({
    event: "request_failed",
    requestId: context.get("requestId"),
    stage,
    errorCode: error instanceof DomainError ? error.code : "INTERNAL_ERROR",
  });
}

function diagnoseUpstreamCookieShape(
  context: ApiContext,
  cookies: readonly unknown[],
): void {
  let stage:
    | "auth_mfa_cookie_count"
    | "auth_mfa_cookie_domain"
    | "auth_mfa_cookie_field"
    | "auth_mfa_cookie_expiry"
    | undefined;

  if (cookies.length > 16) {
    stage = "auth_mfa_cookie_count";
  } else {
    for (const value of cookies) {
      if (typeof value !== "object" || value === null) {
        stage = "auth_mfa_cookie_field";
        break;
      }
      const cookie = value as Record<string, unknown>;
      if (
        typeof cookie.domain !== "string" ||
        !isSchoolCookieDomain(cookie.domain)
      ) {
        stage = "auth_mfa_cookie_domain";
        break;
      }
      if (
        typeof cookie.name !== "string" ||
        cookie.name.length < 1 ||
        cookie.name.length > 128 ||
        typeof cookie.value !== "string" ||
        cookie.value.length > 2_048 ||
        typeof cookie.path !== "string" ||
        !cookie.path.startsWith("/") ||
        cookie.path.length > 256 ||
        typeof cookie.hostOnly !== "boolean" ||
        typeof cookie.secure !== "boolean"
      ) {
        stage = "auth_mfa_cookie_field";
        break;
      }
      if (
        cookie.expiresAt !== undefined &&
        (typeof cookie.expiresAt !== "number" ||
          !Number.isSafeInteger(cookie.expiresAt) ||
          cookie.expiresAt <= 0)
      ) {
        stage = "auth_mfa_cookie_expiry";
        break;
      }
    }
  }

  if (stage !== undefined) {
    logError({
      event: "request_failed",
      requestId: context.get("requestId"),
      stage,
      errorCode: "INTERNAL_ERROR",
    });
  }
}

async function requireMfaState(context: ApiContext): Promise<{
  claims: Extract<
    Awaited<ReturnType<typeof openMfaState>>,
    { status: "valid" }
  >["claims"];
  config: ReturnType<typeof loadSecurityConfig>;
}> {
  const config = loadSecurityConfig(context.env);
  const token = readCookie(context.req.raw, MFA_COOKIE_NAME);
  if (token === undefined) {
    throw authenticationStateError(context, MFA_COOKIE_NAME, "missing");
  }
  const opened = await openMfaState(token, config.sessionKey, unixNow());
  if (opened.status !== "valid") {
    throw authenticationStateError(context, MFA_COOKIE_NAME, opened.status);
  }
  return { claims: opened.claims, config };
}

async function requireLoginState(context: ApiContext): Promise<{
  claims: Extract<
    Awaited<ReturnType<typeof openLoginState>>,
    { status: "valid" }
  >["claims"];
  config: ReturnType<typeof loadSecurityConfig>;
}> {
  const config = loadSecurityConfig(context.env);
  const token = readCookie(context.req.raw, LOGIN_COOKIE_NAME);
  if (token === undefined) {
    throw authenticationStateError(context, LOGIN_COOKIE_NAME, "missing");
  }
  const opened = await openLoginState(token, config.sessionKey, unixNow());
  if (opened.status !== "valid") {
    throw authenticationStateError(context, LOGIN_COOKIE_NAME, opened.status);
  }
  return { claims: opened.claims, config };
}

function authenticationStateError(
  context: ApiContext,
  cookieName: string,
  status: "missing" | "invalid" | "expired",
): DomainError {
  appendCookie(context, clearStateCookie(cookieName));
  if (status === "expired") {
    return new DomainError({
      code: "SESSION_EXPIRED",
      message: "认证会话已过期，请重新登录",
      status: 401,
    });
  }
  if (status === "invalid") {
    return new DomainError({
      code: "SESSION_INVALID",
      message: "认证状态无效，请重新登录",
      status: 401,
    });
  }
  return new DomainError({
    code: "AUTHENTICATION_REQUIRED",
    message: "请先登录",
    status: 401,
  });
}

async function parseJson<T>(
  context: ApiContext,
  schema: {
    safeParse(input: unknown): { success: true; data: T } | { success: false };
  },
): Promise<T> {
  let body: unknown;
  try {
    body = await context.req.json();
  } catch {
    throw invalidRequest();
  }
  const result = schema.safeParse(body);
  if (!result.success) {
    throw invalidRequest();
  }
  return result.data;
}

function requestIp(context: ApiContext): string {
  return context.req.header("CF-Connecting-IP")?.trim() || "unknown";
}

async function accountHashFor(
  username: string,
  hmacKey: Uint8Array<ArrayBuffer>,
): Promise<string> {
  const { hash } = await deriveRateLimitSubject("account", username, hmacKey);
  return hash;
}

function appendCookie(context: ApiContext, value: string): void {
  context.header("Set-Cookie", value, { append: true });
}

function unixNow(): number {
  return Math.floor(Date.now() / 1_000);
}

function isoTime(seconds: number): string {
  return new Date(seconds * 1_000).toISOString();
}

function invalidRequest(): DomainError {
  return new DomainError({
    code: "INVALID_REQUEST",
    message: "请求参数无效",
    status: 400,
  });
}
