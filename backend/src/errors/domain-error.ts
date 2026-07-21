export type DomainErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_CONTENT_TYPE"
  | "INVALID_ORIGIN"
  | "INVALID_CREDENTIALS"
  | "INVALID_MFA_CODE"
  | "MFA_NOT_SENT"
  | "MFA_SEND_FAILED"
  | "TICKET_NOT_FOUND"
  | "UPSTREAM_CHANGED"
  | "AUTHENTICATION_REQUIRED"
  | "SESSION_EXPIRED"
  | "SESSION_INVALID"
  | "RATE_LIMITED"
  | "UPSTREAM_FAILURE"
  | "UPSTREAM_TIMEOUT"
  | "INTERNAL_ERROR";

interface DomainErrorOptions {
  code: DomainErrorCode;
  message: string;
  status: 400 | 401 | 403 | 429 | 500 | 502 | 504;
  retryAfterSeconds?: number;
}

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly status: DomainErrorOptions["status"];
  readonly retryAfterSeconds: number | undefined;

  constructor(options: DomainErrorOptions) {
    super(options.message);
    this.name = "DomainError";
    this.code = options.code;
    this.status = options.status;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}
