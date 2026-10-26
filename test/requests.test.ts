import { describe, expect, it } from 'vitest';
import { NotFoundError } from '../src/index';
import { apiError, client, json, mockFetch } from './helpers';

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

describe('test sends', () => {
  it('test(id) asks /send for the test audience; test(content) posts it with audience_id "test" and a key', async () => {
    const answer = { object: 'broadcast_test', to: ['ana@example.com'] };
    const { fetch, calls } = mockFetch(json(answer), json(answer));
    const meil = client(fetch);
    expect(await meil.broadcasts.test('b/1')).toEqual(answer);
    await meil.broadcasts.test({ from: 'n@example.org', subject: 'S', html: 'H' });
    expect(calls.map((c) => [c.method, c.url.replace('https://api.meil.ro', ''), c.body])).toEqual([
      ['POST', '/broadcasts/b%2F1/send', { audience_id: 'test' }],
      ['POST', '/broadcasts', { from: 'n@example.org', subject: 'S', html: 'H', audience_id: 'test' }],
    ]);
    expect(calls[0]!.headers['idempotency-key']).toBeUndefined();
    expect(calls[1]!.headers['idempotency-key']).toMatch(UUID);
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

describe('your own confirmation page', () => {
  const TOKEN = 'eyJ1IjoxLCJlIjoiYUBiLmNvbSJ9.4f1c0a9b';
  const PENDING = {
    object: 'confirmation',
    status: 'pending',
    email: 'a@b.com',
    audiences: [{ id: 'aud_1', name: 'Newsletter' }],
    confirmed_at: null,
    expires_at: '2026-03-08 09:00:00',
  };

  it('contacts.add passes confirm_page through as it is', async () => {
    const { fetch, calls } = mockFetch(json({}));
    await client(fetch).contacts.add({
      audience_ids: ['aud_1'],
      email: 'a@b.com',
      confirm: true,
      confirm_page: 'https://example.com/confirm',
    });
    expect(calls[0]!.body).toMatchObject({ confirm: true, confirm_page: 'https://example.com/confirm' });
  });

  it('getConfirmation reads the token from the path and changes nothing', async () => {
    const { fetch, calls } = mockFetch(json(PENDING));
    const answer = await client(fetch).contacts.getConfirmation(TOKEN);
    expect(calls[0]!.method).toBe('GET');
    expect(calls[0]!.url).toBe(`https://api.meil.ro/contacts/confirm/${TOKEN}`);
    expect(answer.status).toBe('pending');
  });

  it('confirm posts the token and the visitor IP, and leaves out an empty IP', async () => {
    const done = { ...PENDING, status: 'confirmed', confirmed_at: '2026-03-01 09:14:02', already_confirmed: false };
    const { fetch, calls } = mockFetch(json(done), json(done), json(done));
    const meil = client(fetch);
    const answer = await meil.contacts.confirm(TOKEN, { ip: '203.0.113.7' });
    await meil.contacts.confirm(TOKEN);
    await meil.contacts.confirm(TOKEN, { ip: '' });
    expect(calls.map((c) => [c.method, c.url.replace('https://api.meil.ro', ''), c.body])).toEqual([
      ['POST', '/contacts/confirm', { token: TOKEN, ip: '203.0.113.7' }],
      ['POST', '/contacts/confirm', { token: TOKEN }],
      ['POST', '/contacts/confirm', { token: TOKEN }],
    ]);
    expect(answer.status).toBe('confirmed');
    expect(answer.already_confirmed).toBe(false);
  });

  it('an expired link comes back as a status, not as an error', async () => {
    const { fetch } = mockFetch(json({ ...PENDING, status: 'expired', already_confirmed: false }));
    expect((await client(fetch).contacts.confirm(TOKEN)).status).toBe('expired');
  });

  it('a token that is not valid throws NotFoundError', async () => {
    const { fetch } = mockFetch(apiError(404, 'not_found'), apiError(404, 'not_found'));
    const meil = client(fetch);
    await expect(meil.contacts.getConfirmation('nope')).rejects.toBeInstanceOf(NotFoundError);
    await expect(meil.contacts.confirm('nope')).rejects.toBeInstanceOf(NotFoundError);
  });
});
