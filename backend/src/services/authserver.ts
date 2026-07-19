import { DomainError } from "../errors/domain-error";
import { parseAuthLoginFields } from "../parsers/auth-login-page";
import { parseMaskedPhone } from "../parsers/auth-mfa-page";
import { encryptUpstreamPassword } from "../security/runtime-crypto";
import { UpstreamClient } from "../upstream/client";
import {
  AUTH_LOGIN_URL,
  AUTH_ORIGIN,
  AUTH_REAUTH_URL,
} from "../upstream/constants";
import type { UpstreamCookie } from "../upstream/cookie-jar";

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

function authHeaders(referer: URL, contentType?: string): Headers {
  const headers = new Headers({
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.7",
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
