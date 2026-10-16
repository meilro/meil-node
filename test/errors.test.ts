import { describe, expect, it } from 'vitest';
import {
  AuthenticationError,
  ConflictError,
  MeilError,
  NotFoundError,
  PermissionError,
  RateLimitError,
  ServerError,
  ValidationError,
} from '../src/index';
import { apiError, client, json, mockFetch } from './helpers';

const noRetry = { maxRetries: 0 };

async function failure(reply: Response): Promise<MeilError> {
  const { fetch } = mockFetch(reply);
  try {
    await client(fetch, noRetry).emails.get('e1');
  } catch (error) {
    return error as MeilError;
  }
  throw new Error('expected a failure');
}

describe('error mapping', () => {
  it.each([
    [401, 'invalid_api_key', AuthenticationError],
    [403, 'insufficient_permission', PermissionError],
    [404, 'not_found', NotFoundError],
    [409, 'invalid_idempotent_request', ConflictError],
    [422, 'validation_error', ValidationError],
    [429, 'daily_quota_exceeded', RateLimitError],
    [500, 'internal_error', ServerError],
    [503, 'mail_disabled', ServerError],
  ] as const)('%i %s', async (status, name, Class) => {
    const error = await failure(apiError(status, name));
    expect(error).toBeInstanceOf(Class);
    expect(error).toBeInstanceOf(MeilError);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe(Class.name);
    expect(error.code).toBe(name);
    expect(error.status).toBe(status);
    expect(error.message).toBe(`Message for ${name}.`);
    expect(error.id).toBeUndefined();
  });

  it('uses the base class for other statuses (400 invalid_json, 413)', async () => {
    const error = await failure(apiError(400, 'invalid_json'));
    expect(error.constructor).toBe(MeilError);
    expect(error.code).toBe('invalid_json');
    expect(error.status).toBe(400);
  });

  it('treats a 429 invalid_api_key (too many failed attempts) as an authentication error', async () => {
    const error = await failure(apiError(429, 'invalid_api_key'));
    expect(error).toBeInstanceOf(AuthenticationError);
    expect(error.status).toBe(429);
  });

  it('carries the id of a rejected send', async () => {
    const error = await failure(apiError(422, 'send_rejected', { id: '7e3ff437' }));
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.code).toBe('send_rejected');
    expect(error.id).toBe('7e3ff437');
  });

  it('reads Retry-After on 429', async () => {
    const error = (await failure(apiError(429, 'rate_limit_exceeded', {}, { 'Retry-After': '10' }))) as RateLimitError;
    expect(error.retryAfter).toBe(10);
    expect(error.headers?.get('retry-after')).toBe('10');
  });

  it('survives an HTML error page from Cloudflare', async () => {
    const html = new Response('<!DOCTYPE html><title>502 Bad gateway</title>', { status: 502, headers: { 'Content-Type': 'text/html' } });
    const error = await failure(html);
    expect(error).toBeInstanceOf(ServerError);
    expect(error.status).toBe(502);
    expect(error.code).toBe('invalid_response');
    expect(error.message).toMatch(/HTTP 502/);
  });

  it('refuses a 200 that is not JSON', async () => {
    const error = await failure(new Response('<html>', { status: 200 }));
    expect(error.code).toBe('invalid_response');
  });
});

describe('202 under_review is a result, not an error', () => {
  const held = { message: 'The broadcast is held for review.', name: 'under_review' };

  it('from broadcasts.create, with the id from the answer', async () => {
    const { fetch } = mockFetch(json({ id: 'b9', error: held }, 202));
    const result = await client(fetch).broadcasts.create({ audience_id: 'a1', from: 'n@x.ro', subject: 'S', html: 'H', send: true });
    expect(result).toEqual({ object: 'broadcast', id: 'b9', status: 'under_review', under_review: true, message: held.message });
  });

  it('from broadcasts.send, with the id from the path', async () => {
    const { fetch } = mockFetch(json({ error: held }, 202));
    const result = await client(fetch).broadcasts.send('b5');
    expect(result.status).toBe('under_review');
    expect(result.id).toBe('b5');
  });

  it('a queued broadcast comes back as is', async () => {
    const queued = { object: 'broadcast', id: 'b5', status: 'queued', recipients: 842 };
    const { fetch } = mockFetch(json(queued));
    expect(await client(fetch).broadcasts.send('b5')).toEqual(queued);
  });
});
