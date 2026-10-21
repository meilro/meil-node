import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictError, ConnectionError, RateLimitError, ServerError, ValidationError } from '../src/index';
import { apiError, client, json, mockFetch } from './helpers';

const SEND = { from: 'a@x.ro', to: 'b@y.ro', subject: 'S', html: 'H' };

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(Math, 'random').mockReturnValue(0.5); // jitter factor 1.0
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Runs `promise` to the end while fake time passes, returning when each request was made. */
async function settle<T>(promise: Promise<T>) {
  const outcome = promise.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
  await vi.runAllTimersAsync();
  return outcome;
}

function timedFetch(...replies: Parameters<typeof mockFetch>) {
  const mock = mockFetch(...replies);
  const times: number[] = [];
  const fetch: typeof mock.fetch = async (url, init) => {
    times.push(Date.now());
    return mock.fetch(url, init);
  };
  return { fetch, calls: mock.calls, times };
}

describe('retries', () => {
  it('waits out Retry-After on 429 rate_limit_exceeded', async () => {
    const { fetch, calls, times } = timedFetch(
      apiError(429, 'rate_limit_exceeded', {}, { 'Retry-After': '1' }),
      apiError(429, 'rate_limit_exceeded', {}, { 'Retry-After': '10' }),
      json({ id: 'e1' }),
    );
    const out = await settle(client(fetch).emails.send(SEND));
    expect(out).toEqual({ value: { id: 'e1' } });
    expect(calls).toHaveLength(3);
    expect(times[1]! - times[0]!).toBe(1000);
    expect(times[2]! - times[1]!).toBe(10_000);
  });

  it.each(['daily_quota_exceeded', 'monthly_quota_exceeded', 'previous_broadcast_pending'])(
    'never retries 429 %s',
    async (name) => {
      const { fetch, calls, times } = timedFetch(apiError(429, name));
      const out = await settle(client(fetch).emails.send(SEND));
      expect((out as { error: RateLimitError }).error).toBeInstanceOf(RateLimitError);
      expect((out as { error: RateLimitError }).error.code).toBe(name);
      expect((out as { error: RateLimitError }).error.retryAfter).toBeNull();
      expect(calls).toHaveLength(1);
    },
  );

  it('retries 502, 503, 504 and 520-524 with exponential backoff', async () => {
    const { fetch, calls, times } = timedFetch(apiError(503, 'mail_disabled'), new Response('<html>', { status: 522 }), json({ id: 'b1' }));
    const out = await settle(client(fetch).broadcasts.get('b1'));
    expect(out).toEqual({ value: { id: 'b1' } });
    expect(times[1]! - times[0]!).toBe(500);
    expect(times[2]! - times[1]!).toBe(1000);
  });

  it('gives up after maxRetries and throws the last error', async () => {
    const { fetch, calls, times } = timedFetch(
      new Response('bad gateway', { status: 502 }),
      new Response('bad gateway', { status: 502 }),
      new Response('bad gateway', { status: 502 }),
    );
    const out = (await settle(client(fetch).audiences.list())) as { error: ServerError };
    expect(out.error).toBeInstanceOf(ServerError);
    expect(out.error.status).toBe(502);
    expect(out.error.code).toBe('invalid_response');
    expect(calls).toHaveLength(3);
  });

  it('honours maxRetries: 0, per client and per call', async () => {
    const a = timedFetch(new Response('', { status: 503 }));
    await settle(client(a.fetch, { maxRetries: 0 }).audiences.list());
    expect(a.calls).toHaveLength(1);

    const b = timedFetch(new Response('', { status: 503 }));
    await settle(client(b.fetch).audiences.list({ maxRetries: 0 }));
    expect(b.calls).toHaveLength(1);
  });

  it('does not retry 500 or 4xx', async () => {
    const { fetch, calls, times } = timedFetch(apiError(500, 'internal_error'));
    const out = (await settle(client(fetch).templates.list())) as { error: ServerError };
    expect(out.error).toBeInstanceOf(ServerError);
    expect(calls).toHaveLength(1);
  });

  it('retries network errors on GET, DELETE and PATCH', async () => {
    const { fetch, calls, times } = timedFetch(new TypeError('fetch failed'), json({ deleted: true }));
    const out = await settle(client(fetch).templates.delete('t1'));
    expect(out).toEqual({ value: { deleted: true } });
    expect(calls).toHaveLength(2);
  });

  it('throws ConnectionError once retries are spent', async () => {
    const { fetch, calls, times } = timedFetch(new TypeError('a'), new TypeError('b'), new TypeError('c'));
    const out = (await settle(client(fetch).emails.get('e1'))) as { error: ConnectionError };
    expect(out.error).toBeInstanceOf(ConnectionError);
    expect(out.error.code).toBe('connection_error');
    expect(out.error.status).toBeNull();
  });

  it('never retries a POST without an Idempotency-Key', async () => {
    for (const reply of [new TypeError('fetch failed'), new Response('', { status: 503 }), apiError(429, 'rate_limit_exceeded', {}, { 'Retry-After': '1' })]) {
      const { fetch, calls, times } = timedFetch(reply);
      const out = (await settle(client(fetch).contacts.add({ audience_ids: ['a1'], email: 'c@y.ro' }))) as { error: Error };
      expect(out.error).toBeInstanceOf(Error);
      expect(calls).toHaveLength(1);
      expect(calls[0]!.headers['idempotency-key']).toBeUndefined();
    }
  });

  it('retries a send after a network error with the same Idempotency-Key', async () => {
    const { fetch, calls, times } = timedFetch(new TypeError('socket hang up'), json({ id: 'e1' }));
    const out = await settle(client(fetch).emails.send(SEND));
    expect(out).toEqual({ value: { id: 'e1' } });
    expect(calls).toHaveLength(2);
    expect(calls[0]!.headers['idempotency-key']).toBeTruthy();
    expect(calls[1]!.headers['idempotency-key']).toBe(calls[0]!.headers['idempotency-key']);
    expect(calls[1]!.body).toEqual(calls[0]!.body);
  });

  it('retries 409 concurrent_idempotent_requests after a short wait', async () => {
    const { fetch, calls, times } = timedFetch(apiError(409, 'concurrent_idempotent_requests'), json({ id: 'e1' }, 200, { 'Idempotent-Replayed': 'true' }));
    const out = await settle(client(fetch).emails.send(SEND, { idempotencyKey: 'order-1' }));
    expect(out).toEqual({ value: { id: 'e1' } });
    expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(1000);
  });

  it('does not retry 409 invalid_idempotent_request', async () => {
    const { fetch, calls, times } = timedFetch(apiError(409, 'invalid_idempotent_request'));
    const out = (await settle(client(fetch).emails.send(SEND, { idempotencyKey: 'order-1' }))) as { error: ConflictError };
    expect(out.error).toBeInstanceOf(ConflictError);
    expect(out.error.code).toBe('invalid_idempotent_request');
    expect(calls).toHaveLength(1);
  });

  it('does not retry a 422 send_rejected', async () => {
    const { fetch, calls, times } = timedFetch(apiError(422, 'send_rejected', { id: 'e7' }));
    const out = (await settle(client(fetch).emails.send(SEND))) as { error: ValidationError };
    expect(out.error).toBeInstanceOf(ValidationError);
    expect(out.error.id).toBe('e7');
    expect(calls).toHaveLength(1);
  });

  it('times out each attempt and retries', async () => {
    const calls: string[] = [];
    const hanging = (url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        calls.push(url);
        init.signal!.addEventListener('abort', () => reject(init.signal!.reason));
      });
    const out = (await settle(client(hanging, { timeout: 2000, maxRetries: 1 }).emails.get('e1'))) as { error: ConnectionError };
    expect(out.error).toBeInstanceOf(ConnectionError);
    expect(out.error.code).toBe('timeout');
    expect(calls).toHaveLength(2);
  });

  it("stops at once when the caller's signal aborts", async () => {
    const controller = new AbortController();
    const fetch = (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal!.addEventListener('abort', () => reject(init.signal!.reason));
        controller.abort(new Error('cancelled by caller'));
      });
    const out = (await settle(client(fetch).emails.get('e1', { signal: controller.signal }))) as { error: Error };
    expect(out.error.message).toBe('cancelled by caller');
  });
});
