import { describe, expect, it } from 'vitest';
import { client, json, mockFetch } from './helpers';

const page = (ids: string[], has_more: boolean) => json({ object: 'list', has_more, data: ids.map((id) => ({ id })) });

describe('pagination', () => {
  it('list returns one page', async () => {
    const { fetch, calls } = mockFetch(page(['e3', 'e2'], true));
    const result = await client(fetch).emails.list({ limit: 2 });
    expect(result.has_more).toBe(true);
    expect(result.data.map((e) => e.id)).toEqual(['e3', 'e2']);
    expect(calls).toHaveLength(1);
  });

  it('emails.iterate follows after= until has_more is false', async () => {
    const { fetch, calls } = mockFetch(page(['e5', 'e4'], true), page(['e3', 'e2'], true), page(['e1'], false));
    const ids: string[] = [];
    for await (const email of client(fetch).emails.iterate({ limit: 2 })) ids.push(email.id);
    expect(ids).toEqual(['e5', 'e4', 'e3', 'e2', 'e1']);
    expect(calls.map((c) => c.url.replace('https://api.meil.ro', ''))).toEqual([
      '/emails?limit=2',
      '/emails?limit=2&after=e4',
      '/emails?limit=2&after=e2',
    ]);
  });

  it('audiences.iterateContacts pages through an audience', async () => {
    const { fetch, calls } = mockFetch(page(['m3', 'm2'], true), page(['m1'], false));
    const ids: string[] = [];
    for await (const contact of client(fetch).audiences.iterateContacts('aud 1', { limit: 2 })) ids.push(contact.id);
    expect(ids).toEqual(['m3', 'm2', 'm1']);
    expect(calls[1]!.url).toBe('https://api.meil.ro/audiences/aud%201/contacts?limit=2&after=m2');
  });

  it('started with before=, walks toward newer items', async () => {
    const { fetch, calls } = mockFetch(page(['e7', 'e6'], true), page(['e8'], false));
    const ids: string[] = [];
    for await (const email of client(fetch).emails.iterate({ before: 'e5', limit: 2 })) ids.push(email.id);
    expect(ids).toEqual(['e7', 'e6', 'e8']);
    expect(calls[1]!.url).toBe('https://api.meil.ro/emails?before=e7&limit=2');
  });

  it('stops on an empty page', async () => {
    const { fetch, calls } = mockFetch(page([], true));
    const ids: string[] = [];
    for await (const email of client(fetch).emails.iterate()) ids.push(email.id);
    expect(ids).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it('fetches lazily: breaking early makes no further requests', async () => {
    const { fetch, calls } = mockFetch(page(['e3', 'e2'], true), page(['e1'], false));
    for await (const email of client(fetch).emails.iterate()) {
      if (email.id === 'e3') break;
    }
    expect(calls).toHaveLength(1);
  });
});
