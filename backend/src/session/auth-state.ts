import { z } from "zod";

import type { StateKey } from "./encrypted-state";
import {
  openState,
  renewLoginState,
  resealStateClaims,
  sealState,
  type OpenStateResult,
  type SessionClaims,
} from "./encrypted-state";
import {
  isSchoolCookieDomain,
  type UpstreamCookie,
} from "../upstream/cookie-jar";

export const MFA_COOKIE_NAME = "__Secure-jwxt_mfa";
export const LOGIN_COOKIE_NAME = "__Secure-jwxt_session";

export const MFA_TTL_SECONDS = 10 * 60;
export const LOGIN_IDLE_TTL_SECONDS = 2 * 60 * 60;
export const LOGIN_ABSOLUTE_TTL_SECONDS = 8 * 60 * 60;

const upstreamCookieSchema = z
  .object({
    name: z.string().min(1).max(128),
    value: z.string().max(2_048),
    domain: z.string().refine(isSchoolCookieDomain),
    path: z.string().startsWith("/").max(256),
    hostOnly: z.boolean(),
    secure: z.boolean(),
    expiresAt: z.number().int().positive().optional(),
  })
  .strict();

export const mfaStatePayloadSchema = z
  .object({
    username: z.string().min(1).max(64),
    accountHash: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
    flowId: z.uuid(),
    maskedPhone: z.string().min(1).max(64),
    codeSent: z.boolean(),
    resendAllowedAt: z.number().int().nonnegative(),
    upstreamCookies: z.array(upstreamCookieSchema).max(16),
  })
  .strict();

export const loginStatePayloadSchema = z
  .object({
    accountHash: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
    upstreamCookies: z.array(upstreamCookieSchema).max(16),
  })
  .strict();

export type MfaStatePayload = z.infer<typeof mfaStatePayloadSchema>;
export type LoginStatePayload = z.infer<typeof loginStatePayloadSchema>;
type AuthStateCookie = z.output<typeof upstreamCookieSchema>;

export function sealMfaState(
  payload: MfaStatePayload,
  key: StateKey,
  now: number,
): Promise<string> {
  return sealState({
    purpose: "mfa",
    payload,
    now,
    idleTtlSeconds: MFA_TTL_SECONDS,
    absoluteTtlSeconds: MFA_TTL_SECONDS,
    key,
  });
}

export function openMfaState(
  token: string,
  key: StateKey,
  now: number,
): Promise<OpenStateResult<MfaStatePayload>> {
  return openState(token, "mfa", mfaStatePayloadSchema, key, now);
}

export function updateMfaState(
  claims: SessionClaims<MfaStatePayload>,
  payload: MfaStatePayload,
  key: StateKey,
): Promise<string> {
  return resealStateClaims({ ...claims, payload }, key);
}

export function sealLoginState(
  payload: LoginStatePayload,
  key: StateKey,
  now: number,
): Promise<string> {
  return sealState({
    purpose: "login",
    payload,
    now,
    idleTtlSeconds: LOGIN_IDLE_TTL_SECONDS,
    absoluteTtlSeconds: LOGIN_ABSOLUTE_TTL_SECONDS,
    key,
  });
}

export function openLoginState(
  token: string,
  key: StateKey,
  now: number,
): Promise<OpenStateResult<LoginStatePayload>> {
  return openState(token, "login", loginStatePayloadSchema, key, now);
}

export function renewAuthenticatedState(
  claims: SessionClaims<LoginStatePayload>,
  key: StateKey,
  now: number,
): Promise<string | undefined> {
  return renewLoginState(claims, LOGIN_IDLE_TTL_SECONDS, key, now);
}

export function asUpstreamCookies(cookies: unknown): AuthStateCookie[] {
  const parsed = upstreamCookieSchema.array().max(16).parse(cookies);
  return parsed.map((cookie) => {
    const base = {
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      hostOnly: cookie.hostOnly,
      secure: cookie.secure,
    } satisfies Omit<UpstreamCookie, "expiresAt">;
    return cookie.expiresAt === undefined
      ? base
      : { ...base, expiresAt: cookie.expiresAt };
  });
}
