import { Meil, type ClientOptions } from '../src/index';

export const KEY = 'meil_' + '0'.repeat(48);

export interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

type Reply = Response | Error | (() => Response | Error);

/** A fetch double: answers with `replies` in order and records every call. */
export function mockFetch(...replies: Reply[]) {
  const calls: Call[] = [];
  const fetch = async (url: string, init: RequestInit): Promise<Response> => {
    calls.push({
      url,
      method: init.method ?? 'GET',
      headers: Object.fromEntries(new Headers(init.headers).entries()),
      body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body,
    });
    const next = replies.shift();
    if (next === undefined) throw new Error(`Unexpected request: ${init.method} ${url}`);
    const reply = typeof next === 'function' ? next() : next;
    if (reply instanceof Error) throw reply;
    return reply;
  };
  return { fetch, calls };
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

export function apiError(status: number, name: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  return json({ ...extra, error: { message: `Message for ${name}.`, name } }, status, headers);
}

export function client(fetch: ReturnType<typeof mockFetch>['fetch'], options: ClientOptions = {}) {
  return new Meil(KEY, { fetch, ...options });
}
