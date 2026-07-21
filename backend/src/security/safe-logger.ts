import type { DomainErrorCode } from "../errors/domain-error";

export type LogStage =
  | "api"
  | "auth_login_page"
  | "auth_login_submit"
  | "auth_login_rate_limit_clear"
  | "auth_mfa_state_validate"
  | "auth_mfa_cookie_count"
  | "auth_mfa_cookie_domain"
  | "auth_mfa_cookie_field"
  | "auth_mfa_cookie_expiry"
  | "auth_mfa_state_seal"
  | "auth_mfa_cookie_serialize"
  | "auth_mfa_send"
  | "auth_mfa_verify"
  | "jwxt_sso"
  | "jwxt_ticket1_location_missing"
  | "jwxt_ticket1_location_invalid"
  | "jwxt_ticket1_protocol_rejected"
  | "jwxt_ticket1_host_rejected"
  | "jwxt_ticket1_path_rejected"
  | "jwxt_ticket1_parameter_missing"
  | "jwxt_personal_info"
  | "jwxt_grades"
  | "jwxt_grade_detail"
  | "rate_limit";

export type LogEvent = "request_failed" | "upstream_page_limit_reached";

export interface SafeLogEntry {
  event: LogEvent;
  requestId: string;
  stage: LogStage;
  errorCode?: DomainErrorCode;
  retryAfterSeconds?: number;
}

type LogSink = (serializedEntry: string) => void;

export function logError(
  entry: SafeLogEntry,
  sink: LogSink = console.error,
): void {
  sink(JSON.stringify(normalizeEntry(entry)));
}

export function serializeSafeLog(entry: SafeLogEntry): string {
  return JSON.stringify(normalizeEntry(entry));
}

function normalizeEntry(entry: SafeLogEntry): SafeLogEntry {
  if (!/^[A-Za-z0-9_-]{8,64}$/u.test(entry.requestId)) {
    throw new Error("Safe logs require a valid request ID");
  }
  if (
    entry.retryAfterSeconds !== undefined &&
    (!Number.isSafeInteger(entry.retryAfterSeconds) ||
      entry.retryAfterSeconds <= 0)
  ) {
    throw new Error("Safe logs require a positive integer retry delay");
  }

  return {
    event: entry.event,
    requestId: entry.requestId,
    stage: entry.stage,
    ...(entry.errorCode === undefined ? {} : { errorCode: entry.errorCode }),
    ...(entry.retryAfterSeconds === undefined
      ? {}
      : { retryAfterSeconds: entry.retryAfterSeconds }),
  };
}
