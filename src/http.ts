import {
  AuthenticationError,
  ConflictError,
  ConnectionError,
  MeilError,
  NotFoundError,
  PermissionError,
  RateLimitError,
  ServerError,
  ValidationError,
} from './errors';
import { VERSION } from './version';

/** Any `fetch`-compatible function: the global one, undici's, a test double. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface ClientOptions {
  /** Defaults to `https://api.meil.ro`. Must be https. */
  baseUrl?: string;
  /** Milliseconds per attempt before giving up. Defaults to 30000. */
  timeout?: number;
  /** Retries after the first attempt, for errors that are safe to retry. Defaults to 2; 0 turns them off. */
  maxRetries?: number;
  /** Defaults to the global `fetch`. */
  fetch?: FetchLike;
}

/** Per-call overrides, accepted as the last argument of every method. */
export interface RequestOptions {
  timeout?: number;
  maxRetries?: number;
  signal?: AbortSignal;
}

/** For `emails.send()` and `broadcasts.create()`, the two calls that take an Idempotency-Key. */
export interface IdempotentRequestOptions extends RequestOptions {
  /**
   * 1 to 255 printable ASCII characters, no spaces, unique to this send (such
   * as `order-2451-confirmation`). When left out, the SDK makes a random one,
   * so its own retries can never send twice.
   */
  idempotencyKey?: string;
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export interface RequestArgs {
  method: Method;
  path: string;
  query?: Record<string, string | number | undefined> | undefined;
  body?: unknown;
  idempotencyKey?: string | undefined;
  options?: RequestOptions | undefined;
}

export interface RawResponse {
  status: number;
  data: unknown;
}

const DEFAULT_BASE_URL = 'https://api.meil.ro';
const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_MAX_RETRIES = 2;
/** A Retry-After longer than this is not waited out; the error is thrown instead. */
const MAX_RETRY_AFTER = 60;
/** 502, 503, 504 and Cloudflare's 520 to 524: the request may not have reached the API. */
const RETRY_STATUSES = new Set([502, 503, 504, 520, 521, 522, 523, 524]);

export class HttpClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: FetchLike;

  constructor(apiKey: string | undefined, options: ClientOptions = {}) {
    const key = apiKey ?? readEnv('MEIL_API_KEY');
    if (!key) {
      throw new Error('Missing API key. Pass it to new Meil(key) or set MEIL_API_KEY.');
    }
    const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    if (!/^https:\/\//i.test(baseUrl)) {
      throw new Error('baseUrl must start with https://; the API refuses plain http.');
    }
    const fetchImpl = options.fetch ?? (typeof fetch === 'function' ? fetch.bind(globalThis) : undefined);
    if (!fetchImpl) {
      throw new Error('No global fetch found. Use Node 18 or newer, or pass options.fetch.');
    }
    this.apiKey = key;
    this.baseUrl = baseUrl;
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT;
    this.maxRetries = Math.max(0, options.maxRetries ?? DEFAULT_MAX_RETRIES);
    this.fetchImpl = fetchImpl;
  }

  /** Sends a request with retries; returns the decoded 2xx body or throws a MeilError. */
  async request(args: RequestArgs): Promise<RawResponse> {
    const { method, idempotencyKey, options = {} } = args;
    const url = this.baseUrl + args.path + queryString(args.query);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: 'application/json',
      'User-Agent': `meil-node/${VERSION}`,
    };
    let body: string | undefined;
    if (args.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(args.body);
    }
    if (idempotencyKey !== undefined) {
      headers['Idempotency-Key'] = idempotencyKey;
    }

    // GET, PATCH and DELETE can be repeated; a POST only with an Idempotency-Key,
    // which makes the server answer a repeat with the first response.
    const repeatable = method !== 'POST' || idempotencyKey !== undefined;
    const maxRetries = Math.max(0, options.maxRetries ?? this.maxRetries);
    const timeout = options.timeout ?? this.timeout;

    for (let attempt = 0; ; attempt++) {
      const canRetry = repeatable && attempt < maxRetries;
      let response: Response;
      let text: string;
      try {
        ({ response, text } = await this.send(url, { method, headers, body }, timeout, options.signal));
      } catch (error) {
        if (options.signal?.aborted) {
          throw options.signal.reason ?? error;
        }
        const timedOut = error instanceof TimeoutSignal;
        if (canRetry) {
          await sleep(backoff(attempt));
          continue;
        }
        throw new ConnectionError(
          timedOut
            ? `No answer from meil.ro within ${timeout} ms.`
            : `Could not reach meil.ro: ${error instanceof Error ? error.message : String(error)}`,
          { code: timedOut ? 'timeout' : 'connection_error', status: null, cause: timedOut ? undefined : error },
        );
      }

      const data = parseJson(text);
      if (response.ok) {
        if (data === undefined) {
          throw new MeilError(`meil.ro answered HTTP ${response.status} with a body that is not JSON.`, {
            code: 'invalid_response',
            status: response.status,
            headers: response.headers,
          });
        }
        return { status: response.status, data };
      }

      const error = toError(response.status, data, response.headers);
      if (canRetry) {
        const wait = retryDelay(error, attempt);
        if (wait !== null) {
          await sleep(wait);
          continue;
        }
      }
      throw error;
    }
  }

  private async send(
    url: string,
    init: RequestInit,
    timeout: number,
    signal: AbortSignal | undefined,
  ): Promise<{ response: Response; text: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new TimeoutSignal()), timeout);
    const onAbort = () => controller.abort(signal?.reason);
    if (signal) {
      if (signal.aborted) controller.abort(signal.reason);
      else signal.addEventListener('abort', onAbort, { once: true });
    }
    try {
      const response = await this.fetchImpl(url, { ...init, signal: controller.signal });
      // The timeout covers reading the body too.
      const text = await response.text();
      return { response, text };
    } catch (error) {
      if (controller.signal.reason instanceof TimeoutSignal) throw controller.signal.reason;
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }
}

/** Marks an abort caused by our own timeout, as opposed to the caller's signal. */
class TimeoutSignal extends Error {
  constructor() {
    super('Request timed out.');
  }
}

/** How long to wait before retrying after this error, in ms, or null when it must not be retried. */
function retryDelay(error: MeilError, attempt: number): number | null {
  const status = error.status ?? 0;
  if (error instanceof RateLimitError) {
    // Only the per-second limits clear on their own. Quotas
    // (daily_quota_exceeded, monthly_quota_exceeded, previous_broadcast_pending)
    // carry no Retry-After and are thrown at once.
    const transient = error.code === 'rate_limit_exceeded' || (error.code === 'invalid_response' && error.retryAfter !== null);
    if (!transient || error.retryAfter === null || error.retryAfter > MAX_RETRY_AFTER) return null;
    return error.retryAfter * 1000;
  }
  if (status === 409 && error.code === 'concurrent_idempotent_requests') {
    // The first request with this key is still running: give it a moment.
    return Math.max(1000, backoff(attempt));
  }
  if (RETRY_STATUSES.has(status)) {
    const after = parseRetryAfter(error.headers?.get('retry-after') ?? null);
    if (after !== null && after > MAX_RETRY_AFTER) return null;
    return after !== null ? after * 1000 : backoff(attempt);
  }
  return null;
}

/** Exponential backoff with jitter: about 0.5 s, 1 s, 2 s, ... capped at 8 s. */
function backoff(attempt: number): number {
  const base = Math.min(8000, 500 * 2 ** attempt);
  return Math.round(base * (0.75 + Math.random() * 0.5));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toError(status: number, data: unknown, headers: Headers): MeilError {
  const body = isObject(data) ? data : undefined;
  const err = body && isObject(body.error) ? body.error : undefined;
  const code = typeof err?.name === 'string' ? err.name : 'invalid_response';
  const message =
    typeof err?.message === 'string'
      ? err.message
      : `meil.ro answered HTTP ${status}${data === undefined ? ' with a body that is not JSON' : ''}.`;
  const init = { code, status, headers, id: typeof body?.id === 'string' ? body.id : undefined };

  // A bad key is an authentication problem, even when it comes back as a 429
  // (too many failed attempts from one IP).
  if (status === 401 || code === 'invalid_api_key' || code === 'missing_api_key') {
    return new AuthenticationError(message, init);
  }
  switch (status) {
    case 403:
      return new PermissionError(message, init);
    case 404:
      return new NotFoundError(message, init);
    case 409:
      return new ConflictError(message, init);
    case 422:
      return new ValidationError(message, init);
    case 429:
      return new RateLimitError(message, { ...init, retryAfter: parseRetryAfter(headers.get('retry-after')) });
  }
  if (status >= 500) return new ServerError(message, init);
  return new MeilError(message, init);
}

/** Retry-After as seconds: either a number or an HTTP date. */
function parseRetryAfter(value: string | null): number | null {
  if (value === null || value.trim() === '') return null;
  if (/^\d+$/.test(value.trim())) return Number(value.trim());
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

function parseJson(text: string): unknown {
  if (text.trim() === '') return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function queryString(query: RequestArgs['query']): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) params.set(name, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

/** Encodes one path segment: an id or an email address (`+` becomes `%2B`). */
export function segment(value: string): string {
  return encodeURIComponent(value);
}

/** A random UUID v4, from Web Crypto when there is one. */
export function randomUuid(): string {
  const cryptoObj = (globalThis as { crypto?: Crypto }).crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') return cryptoObj.randomUUID();
  const bytes = new Uint8Array(16);
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    cryptoObj.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function readEnv(name: string): string | undefined {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env?.[name] || undefined;
}
