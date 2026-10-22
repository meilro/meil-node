import { describe, expect, it } from 'vitest';
import { client, json, mockFetch } from './helpers';

const SEND = { from: 'a@example.org', to: ['b@example.net', 'c@example.net'], subject: 'S', html: 'H' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('idempotency keys', () => {
  it('emails.send makes a random UUID per call', async () => {
    const { fetch, calls } = mockFetch(json({ id: 'e1' }), json({ id: 'e2' }));
    const meil = client(fetch);
    await meil.emails.send(SEND);
    await meil.emails.send(SEND);
    expect(calls[0]!.headers['idempotency-key']).toMatch(UUID);
    expect(calls[1]!.headers['idempotency-key']).toMatch(UUID);
    expect(calls[0]!.headers['idempotency-key']).not.toBe(calls[1]!.headers['idempotency-key']);
  });

  it("sends the caller's own key", async () => {
    const { fetch, calls } = mockFetch(json({ id: 'e1' }), json({ id: 'b1', object: 'broadcast', status: 'draft', scheduled_at: null }));
    const meil = client(fetch);
    await meil.emails.send(SEND, { idempotencyKey: 'order-2451-confirmation' });
    await meil.broadcasts.create({ audience_id: 'a1', from: 'n@example.org', subject: 'S', html: 'H' }, { idempotencyKey: 'march-newsletter' });
    expect(calls[0]!.headers['idempotency-key']).toBe('order-2451-confirmation');
    expect(calls[1]!.headers['idempotency-key']).toBe('march-newsletter');
  });

  it('broadcasts.create makes one too; other POSTs send none', async () => {
    const { fetch, calls } = mockFetch(json({}), json({}), json({}), json({}));
    const meil = client(fetch);
    await meil.broadcasts.create({ audience_id: 'a1', from: 'n@example.org', subject: 'S', html: 'H' });
    await meil.broadcasts.send('b1');
    await meil.templates.create({ name: 'T', html: 'H' });
    await meil.content.check({ html: 'H' });
    expect(calls[0]!.headers['idempotency-key']).toMatch(UUID);
    expect(calls.slice(1).map((c) => c.headers['idempotency-key'])).toEqual([undefined, undefined, undefined]);
  });

  it('returns a replayed answer like any other', async () => {
    const { fetch } = mockFetch(json({ id: 'e1' }, 200, { 'Idempotent-Replayed': 'true' }));
    expect(await client(fetch).emails.send(SEND, { idempotencyKey: 'k' })).toEqual({ id: 'e1' });
  });
});

describe('URL encoding', () => {
  it('encodes emails in paths, + as %2B', async () => {
    const { fetch, calls } = mockFetch(json({}), json({}), json({}), json({}));
    const meil = client(fetch);
    await meil.contacts.get('ana+news@example.com');
    await meil.contacts.update('ana+news@example.com', { first_name: 'Ana' });
    await meil.contacts.delete('a b/c?d#e@example.com');
    await meil.contacts.remove('aud/1', 'ana+news@example.com');
    expect(calls.map((c) => c.url.replace('https://api.meil.ro', ''))).toEqual([
      '/contacts/ana%2Bnews%40example.com',
      '/contacts/ana%2Bnews%40example.com',
      '/contacts/a%20b%2Fc%3Fd%23e%40example.com',
      '/audiences/aud%2F1/contacts/ana%2Bnews%40example.com',
    ]);
  });

  it('encodes ids and query cursors', async () => {
    const { fetch, calls } = mockFetch(json({}), json({}));
    const meil = client(fetch);
    await meil.emails.get('../x');
    await meil.emails.list({ before: 'a&b=c' });
    expect(calls[0]!.url).toBe('https://api.meil.ro/emails/..%2Fx');
    expect(calls[1]!.url).toBe('https://api.meil.ro/emails?before=a%26b%3Dc');
  });
});

describe('request bodies', () => {
  it('base64-encodes attachment bytes and passes base64 strings through', async () => {
    const { fetch, calls } = mockFetch(json({ id: 'e1' }));
    const pdf = new TextEncoder().encode('%PDF-1.4\n');
    await client(fetch).emails.send({
      ...SEND,
      attachments: [
        { filename: 'a.pdf', content: pdf },
        { filename: 'b.txt', content: 'aGVsbG8=' },
        { filename: 'c.bin', content: new Uint8Array([0, 255, 128]).buffer },
      ],
    });
    expect((calls[0]!.body as { attachments: unknown }).attachments).toEqual([
      { filename: 'a.pdf', content: 'JVBERi0xLjQK' },
      { filename: 'b.txt', content: 'aGVsbG8=' },
      { filename: 'c.bin', content: 'AP+A' },
    ]);
  });

  it('base64-encodes large attachments', async () => {
    const { fetch, calls } = mockFetch(json({ id: 'e1' }));
    const big = new Uint8Array(200_000).map((_, i) => i % 256);
    await client(fetch).emails.send({ ...SEND, attachments: [{ filename: 'big.bin', content: big }] });
    const sent = (calls[0]!.body as { attachments: { content: string }[] }).attachments[0]!.content;
    expect(Uint8Array.from(atob(sent), (c) => c.charCodeAt(0))).toEqual(big);
  });

  it('sends scheduled_at strings as given', async () => {
    const { fetch, calls } = mockFetch(json({}), json({}));
    const meil = client(fetch);
    await meil.broadcasts.schedule('b1', '2030-03-01T09:00:00+02:00');
    await meil.broadcasts.create({ audience_id: 'a1', from: 'n@example.org', subject: 'S', html: 'H', scheduled_at: '2030-03-01T09:00:00Z' });
    expect(calls[0]!.body).toEqual({ scheduled_at: '2030-03-01T09:00:00+02:00' });
    expect((calls[1]!.body as { scheduled_at: string }).scheduled_at).toBe('2030-03-01T09:00:00Z');
  });

  it('does not change the caller\'s params', async () => {
    const { fetch } = mockFetch(json({ id: 'e1' }));
    const params = { ...SEND, attachments: [{ filename: 'a.txt', content: new Uint8Array([104, 105]) }] };
    await client(fetch).emails.send(params);
    expect(params.attachments[0]!.content).toBeInstanceOf(Uint8Array);
  });
});
