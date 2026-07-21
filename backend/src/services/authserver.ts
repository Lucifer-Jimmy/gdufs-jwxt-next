import { DomainError } from "../errors/domain-error";
import { parseAuthLoginFields } from "../parsers/auth-login-page";
import { parseMaskedPhone } from "../parsers/auth-mfa-page";
import { encryptUpstreamPassword } from "../security/runtime-crypto";
import { UpstreamClient } from "../upstream/client";
import {
  AUTH_LOGIN_URL,
  AUTH_MFA_SEND_URL,
  AUTH_MFA_VERIFY_URL,
  AUTH_ORIGIN,
  AUTH_REAUTH_URL,
  JWXT_SSO_URL,
  isAllowedUpstreamUrl,
} from "../upstream/constants";
import type { UpstreamCookie } from "../upstream/cookie-jar";
import { z } from "zod";

export interface BeginMfaLoginResult {
  maskedPhone: string;
  upstreamCookies: UpstreamCookie[];
}

export async function beginMfaLogin(
  client: UpstreamClient,
  username: string,
  password: string,
  now: number,
): Promise<BeginMfaLoginResult> {
  const loginPage = await client.request(AUTH_LOGIN_URL, {
    headers: authHeaders(AUTH_LOGIN_URL),
  });
  const fields = await parseLoginFields(loginPage);
  const encryptedPassword = await encryptUpstreamPassword(
    password,
    fields.passwordEncryptSalt,
  );
  const body = new URLSearchParams({
    username,
    password: encryptedPassword,
    captcha: "",
    _eventId: "submit",
    cllt: "userNameLogin",
    dllt: "generalLogin",
    lt: "",
    execution: fields.execution,
  });
  const loginResponse = await client.requestManual(AUTH_LOGIN_URL, {
    method: "POST",
    headers: authHeaders(AUTH_LOGIN_URL, "application/x-www-form-urlencoded"),
    body,
  });
  validateMfaRedirect(loginResponse);

  const mfaPage = await client.request(AUTH_REAUTH_URL, {
    headers: authHeaders(AUTH_LOGIN_URL),
  });
  const maskedPhone = await parseMfaPhone(mfaPage);

  return { maskedPhone, upstreamCookies: client.jar.serialize(now) };
}

export interface MfaCodeResult {
  message: string;
  codeTimeSeconds: number;
}

export async function sendMfaCode(
  client: UpstreamClient,
  username: string,
): Promise<MfaCodeResult> {
  const body = new URLSearchParams({
    userName: username,
    authCodeTypeName: "reAuthDynamicCodeType",
  });
  const response = await client.request(AUTH_MFA_SEND_URL, {
    method: "POST",
    headers: authHeaders(AUTH_LOGIN_URL, "application/x-www-form-urlencoded"),
    body,
  });
  const result = await parseJson(response, mfaSendResultSchema);
  if (!isPythonJsonTruthy(result.res)) {
    throw new DomainError({
      code: "MFA_SEND_FAILED",
      message: "验证码发送失败，请稍后重试",
      status: 502,
    });
  }

  const codeTime = normalizeCodeTime(result.codeTime);
  return {
    message: normalizeOptionalText(result.returnMessage, 256) ?? "验证码已发送",
    codeTimeSeconds: Math.max(1, codeTime ?? 60),
  };
}

export async function verifyMfaCode(
  client: UpstreamClient,
  code: string,
): Promise<URL> {
  const body = new URLSearchParams({
    service: JWXT_SSO_URL.toString(),
    reAuthType: "3",
    isMultifactor: "true",
    password: "",
    dynamicCode: code,
    uuid: "",
    answer1: "",
    answer2: "",
    optCode: "",
    skipTmpReAuth: "false",
  });
  const response = await client.requestManual(AUTH_MFA_VERIFY_URL, {
    method: "POST",
    headers: authHeaders(AUTH_LOGIN_URL, "application/x-www-form-urlencoded"),
    body,
  });
  const result = await parseJson(response, mfaVerifyResultSchema);
  if (result.code !== "reAuth_success") {
    throw new DomainError({
      code: "INVALID_MFA_CODE",
      message: "验证码错误或已过期，请重新输入",
      status: 401,
    });
  }

  return getTicketToLogin(client);
}

export async function getTicketToLogin(client: UpstreamClient): Promise<URL> {
  const response = await client.requestManual(AUTH_LOGIN_URL, {
    headers: authHeaders(AUTH_LOGIN_URL),
  });
  const location = response.headers.get("Location");
  if (location === null) {
    throw ticketNotFound();
  }

  let ticketUrl: URL;
  try {
    ticketUrl = new URL(location, AUTH_LOGIN_URL);
  } catch {
    throw ticketNotFound();
  }

  if (
    !isAllowedUpstreamUrl(ticketUrl) ||
    ticketUrl.hostname !== JWXT_SSO_URL.hostname ||
    ticketUrl.pathname !== JWXT_SSO_URL.pathname ||
    !nonEmptyQueryValue(ticketUrl, "ticket")
  ) {
    throw ticketNotFound();
  }
  return ticketUrl;
}

function authHeaders(referer: URL, contentType?: string): Headers {
  const headers = new Headers({
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif," +
      "image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    Origin: AUTH_ORIGIN,
    Referer: referer.toString(),
  });
  if (contentType !== undefined) {
    headers.set("Content-Type", contentType);
  }
  return headers;
}

async function parseLoginFields(response: Response) {
  try {
    return await parseAuthLoginFields(response);
  } catch {
    throw upstreamChanged();
  }
}

async function parseMfaPhone(response: Response): Promise<string> {
  try {
    return await parseMaskedPhone(response);
  } catch {
    throw upstreamChanged();
  }
}

function validateMfaRedirect(response: Response): void {
  const location = response.headers.get("Location");
  if (location === null) {
    throw invalidCredentials();
  }

  let redirect: URL;
  try {
    redirect = new URL(location, AUTH_LOGIN_URL);
  } catch {
    throw invalidCredentials();
  }
  if (
    redirect.protocol !== "https:" ||
    redirect.hostname !== AUTH_LOGIN_URL.hostname ||
    redirect.pathname !== "/authserver/reAuthCheck/reAuthLoginView.do"
  ) {
    throw invalidCredentials();
  }
}

const mfaSendResultSchema = z.object({
  res: z.json(),
  mobile: z.unknown().optional(),
  returnMessage: z.unknown().optional(),
  codeTime: z.unknown().optional(),
});

const mfaVerifyResultSchema = z.object({
  code: z.string().max(64),
});

async function parseJson<T>(
  response: Response,
  schema: z.ZodType<T>,
): Promise<T> {
  try {
    return schema.parse(await response.json());
  } catch {
    throw upstreamChanged();
  }
}

function nonEmptyQueryValue(url: URL, name: string): boolean {
  const value = url.searchParams.get(name);
  return value !== null && value.length > 0;
}

function normalizeCodeTime(value: unknown): number | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  const seconds = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(seconds) && seconds >= 0 ? seconds : undefined;
}

function normalizeOptionalText(
  value: unknown,
  maxLength: number,
): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maxLength
    ? normalized
    : undefined;
}

// The production origin treats `res` with Python truthiness rather than as a
// boolean. Preserve that protocol semantic for JSON values without coercing
// optional response fields.
function isPythonJsonTruthy(value: z.infer<typeof z.json>): boolean {
  if (value === undefined || value === null || value === false) {
    return false;
  }
  if (value === true) {
    return true;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string" || Array.isArray(value)) {
    return value.length > 0;
  }
  return typeof value === "object" && Object.keys(value).length > 0;
}

function invalidCredentials(): DomainError {
  return new DomainError({
    code: "INVALID_CREDENTIALS",
    message: "账号或密码错误",
    status: 401,
  });
}

function upstreamChanged(): DomainError {
  return new DomainError({
    code: "UPSTREAM_CHANGED",
    message: "统一认证页面发生变化，暂时无法登录",
    status: 502,
  });
}

function ticketNotFound(): DomainError {
  return new DomainError({
    code: "TICKET_NOT_FOUND",
    message: "未能获取登录票据，请稍后重试",
    status: 502,
  });
}
