/**
 * Every failed call throws a MeilError, or one of its subclasses chosen by the
 * HTTP status. `code` is the API's stable error name (`error.name` in the JSON
 * answer, such as `"rate_limit_exceeded"`); `message` is English text for people.
 */
export class MeilError extends Error {
  /** The API's error name, e.g. `"invalid_api_key"`. Stable: branch on this. */
  readonly code: string;
  /** HTTP status, or `null` when no answer came back (network error, timeout). */
  readonly status: number | null;
  /** The object the error is about, when the API names one (`send_rejected`). */
  readonly id: string | undefined;
  /** Response headers, when there was a response. */
  readonly headers: Headers | undefined;

  constructor(
    message: string,
    init: { code: string; status: number | null; id?: string | undefined; headers?: Headers | undefined; cause?: unknown },
  ) {
    super(message, init.cause === undefined ? undefined : { cause: init.cause });
    this.name = new.target.name;
    this.code = init.code;
    this.status = init.status;
    this.id = init.id;
    this.headers = init.headers;
  }
}

/** 401: missing or invalid API key. */
export class AuthenticationError extends MeilError {}

/** 403: the key's scope, plan or domain does not allow this, or the account is suspended. */
export class PermissionError extends MeilError {}

/** 404: no such object, or one this key cannot see. */
export class NotFoundError extends MeilError {}

/** 409: idempotency conflicts, or a broadcast blocked by one under review. */
export class ConflictError extends MeilError {}

/** 422: the request was refused as invalid; also `send_rejected` (with `id`). */
export class ValidationError extends MeilError {}

/** 429: per-second rate limit, or a daily or monthly quota. */
export class RateLimitError extends MeilError {
  /** Seconds to wait before retrying, from `Retry-After`; `null` for quotas. */
  readonly retryAfter: number | null;

  constructor(
    message: string,
    init: ConstructorParameters<typeof MeilError>[1] & { retryAfter: number | null },
  ) {
    super(message, init);
    this.retryAfter = init.retryAfter;
  }
}

/** 5xx: the service had a problem; also `mail_disabled` (503). */
export class ServerError extends MeilError {}

/** No answer: network failure or timeout. `code` is `"connection_error"` or `"timeout"`. */
export class ConnectionError extends MeilError {}
