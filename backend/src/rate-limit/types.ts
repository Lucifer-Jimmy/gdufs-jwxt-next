export type RateLimitAction =
  | "auth_login_account"
  | "auth_login_ip"
  | "mfa_send_account_short"
  | "mfa_send_account_daily"
  | "mfa_send_ip"
  | "mfa_verify_flow"
  | "grades_refresh_account";

export interface RateLimitRule {
  id: RateLimitAction;
  limit: number;
  windowSeconds: number;
  retentionSeconds: number;
}

export interface RateLimitCheck {
  subjectHash: string;
  rules: RateLimitRule[];
  now: number;
}

export type RateLimitDecision =
  | { allowed: true }
  | {
      allowed: false;
      retryAfterSeconds: number;
      limitedBy: RateLimitAction;
    };
