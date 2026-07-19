import type { RateLimitAction, RateLimitRule } from "./types";

const MINUTE = 60;
const HOUR = 60 * MINUTE;

export const RATE_LIMIT_RULES = {
  authLoginAccount: rule("auth_login_account", 5, 10 * MINUTE),
  authLoginIp: rule("auth_login_ip", 30, 10 * MINUTE),
  mfaSendAccountShort: rule("mfa_send_account_short", 3, 10 * MINUTE),
  mfaSendAccountDaily: rule("mfa_send_account_daily", 10, 24 * HOUR),
  mfaSendIp: rule("mfa_send_ip", 20, 10 * MINUTE),
  mfaVerifyFlow: rule("mfa_verify_flow", 5, 10 * MINUTE),
  gradesRefreshAccount: rule("grades_refresh_account", 1, 30),
} as const satisfies Record<string, RateLimitRule>;

export const RATE_LIMIT_POLICIES = {
  authLogin: {
    account: [RATE_LIMIT_RULES.authLoginAccount],
    ip: [RATE_LIMIT_RULES.authLoginIp],
  },
  mfaSend: {
    account: [
      RATE_LIMIT_RULES.mfaSendAccountShort,
      RATE_LIMIT_RULES.mfaSendAccountDaily,
    ],
    ip: [RATE_LIMIT_RULES.mfaSendIp],
  },
  mfaVerifyFailure: {
    flow: [RATE_LIMIT_RULES.mfaVerifyFlow],
  },
  gradesRefresh: {
    account: [RATE_LIMIT_RULES.gradesRefreshAccount],
  },
} as const;

function rule(
  id: RateLimitAction,
  limit: number,
  windowSeconds: number,
): RateLimitRule {
  return { id, limit, windowSeconds, retentionSeconds: windowSeconds };
}
