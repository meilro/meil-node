import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Meil, VERSION } from '../src/index';
import { client, json, KEY, mockFetch } from './helpers';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('client', () => {
  it('sends the key, JSON headers and a User-Agent', async () => {
    const { fetch, calls } = mockFetch(json({ object: 'list', data: [] }));
    await client(fetch).audiences.list();
    expect(calls[0]!.url).toBe('https://api.meil.ro/audiences');
    expect(calls[0]!.headers).toMatchObject({
      authorization: `Bearer ${KEY}`,
      accept: 'application/json',
      'user-agent': `meil-node/${VERSION}`,
    });
    expect(calls[0]!.headers['content-type']).toBeUndefined();
  });

  it('takes the key from MEIL_API_KEY', async () => {
    vi.stubEnv('MEIL_API_KEY', 'meil_fromenv');
    const { fetch, calls } = mockFetch(json({ object: 'list', data: [] }));
    await new Meil(undefined, { fetch }).templates.list();
    expect(calls[0]!.headers.authorization).toBe('Bearer meil_fromenv');
  });

  it('refuses to start without a key', () => {
    vi.stubEnv('MEIL_API_KEY', '');
    expect(() => new Meil()).toThrow(/Missing API key/);
  });

  it('uses the global fetch by default', async () => {
    const { fetch, calls } = mockFetch(json({ object: 'list', data: [] }));
    vi.stubGlobal('fetch', fetch);
    await new Meil(KEY).broadcasts.list();
    expect(calls).toHaveLength(1);
  });

  it('accepts another https base URL and refuses http', async () => {
    const { fetch, calls } = mockFetch(json({ id: 'e1' }));
    await client(fetch, { baseUrl: 'https://meil.ro/api/' }).emails.get('e1');
    expect(calls[0]!.url).toBe('https://meil.ro/api/emails/e1');
    expect(() => new Meil(KEY, { baseUrl: 'http://api.meil.ro' })).toThrow(/https/);
  });

  it('keeps VERSION in step with package.json', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
    expect(VERSION).toBe(pkg.version);
  });
});

describe('every operation', () => {
  const day = new Date('2030-01-02T03:04:05Z');
  // [operationId, call, method, path, body]
  const cases: [string, (m: Meil) => Promise<unknown>, string, string, unknown][] = [
    ['sendEmail', (m) => m.emails.send({ from: 'a@x.ro', to: 'b@y.ro', subject: 'S', html: 'H' }), 'POST', '/emails', { from: 'a@x.ro', to: 'b@y.ro', subject: 'S', html: 'H' }],
    ['listEmails', (m) => m.emails.list({ limit: 5, after: 'e9' }), 'GET', '/emails?limit=5&after=e9', undefined],
    ['getEmail', (m) => m.emails.get('e1'), 'GET', '/emails/e1', undefined],
    ['createAudience', (m) => m.audiences.create({ name: 'N', domain: 'x.ro' }), 'POST', '/audiences', { name: 'N', domain: 'x.ro' }],
    ['listAudiences', (m) => m.audiences.list(), 'GET', '/audiences', undefined],
    ['getAudience', (m) => m.audiences.get('a1'), 'GET', '/audiences/a1', undefined],
    ['deleteAudience', (m) => m.audiences.delete('a1'), 'DELETE', '/audiences/a1', undefined],
    ['listContacts', (m) => m.audiences.listContacts('a1', { limit: 1000 }), 'GET', '/audiences/a1/contacts?limit=1000', undefined],
    ['addContact', (m) => m.contacts.add({ audience_id: 'a1', email: 'c@y.ro', properties: { city: 'Cluj' } }), 'POST', '/contacts', { audience_id: 'a1', email: 'c@y.ro', properties: { city: 'Cluj' } }],
    ['getContact', (m) => m.contacts.get('c@y.ro'), 'GET', '/contacts/c%40y.ro', undefined],
    ['updateContact', (m) => m.contacts.update('c@y.ro', { properties: { old: null } }), 'PATCH', '/contacts/c%40y.ro', { properties: { old: null } }],
    ['deleteContact', (m) => m.contacts.delete('c@y.ro'), 'DELETE', '/contacts/c%40y.ro', undefined],
    ['removeContact', (m) => m.contacts.remove('a1', 'c@y.ro'), 'DELETE', '/audiences/a1/contacts/c%40y.ro', undefined],
    ['createBroadcast', (m) => m.broadcasts.create({ audience_id: 'a1', from: 'n@x.ro', subject: 'S', html: 'H', scheduled_at: day }), 'POST', '/broadcasts', { audience_id: 'a1', from: 'n@x.ro', subject: 'S', html: 'H', scheduled_at: '2030-01-02T03:04:05.000Z' }],
    ['listBroadcasts', (m) => m.broadcasts.list(), 'GET', '/broadcasts', undefined],
    ['getBroadcast', (m) => m.broadcasts.get('b1'), 'GET', '/broadcasts/b1', undefined],
    ['updateBroadcast', (m) => m.broadcasts.update('b1', { reply_to: null }), 'PATCH', '/broadcasts/b1', { reply_to: null }],
    ['deleteBroadcast', (m) => m.broadcasts.delete('b1'), 'DELETE', '/broadcasts/b1', undefined],
    ['sendBroadcast', (m) => m.broadcasts.send('b1'), 'POST', '/broadcasts/b1/send', undefined],
    ['scheduleBroadcast', (m) => m.broadcasts.schedule('b1', day), 'POST', '/broadcasts/b1/schedule', { scheduled_at: '2030-01-02T03:04:05.000Z' }],
    ['unscheduleBroadcast', (m) => m.broadcasts.unschedule('b1'), 'POST', '/broadcasts/b1/unschedule', undefined],
    ['createTemplate', (m) => m.templates.create({ name: 'T', html: 'H' }), 'POST', '/templates', { name: 'T', html: 'H' }],
    ['listTemplates', (m) => m.templates.list(), 'GET', '/templates', undefined],
    ['getTemplate', (m) => m.templates.get('t1'), 'GET', '/templates/t1', undefined],
    ['updateTemplate', (m) => m.templates.update('t1', { subject: 'S2' }), 'PATCH', '/templates/t1', { subject: 'S2' }],
    ['deleteTemplate', (m) => m.templates.delete('t1'), 'DELETE', '/templates/t1', undefined],
    ['checkContent', (m) => m.content.check({ html: '<p>Hi</p>' }), 'POST', '/content/check', { html: '<p>Hi</p>' }],
  ];

  it('covers all 27', () => {
    expect(new Set(cases.map((c) => c[0])).size).toBe(27);
  });

  it.each(cases)('%s', async (_op, call, method, path, body) => {
    const answer = { object: 'x', id: 'id1', data: [], has_more: false };
    const { fetch, calls } = mockFetch(json(answer));
    await expect(call(client(fetch))).resolves.toEqual(answer);
    expect(calls[0]!.method).toBe(method);
    expect(calls[0]!.url).toBe('https://api.meil.ro' + path);
    expect(calls[0]!.body).toEqual(body);
    if (body !== undefined) expect(calls[0]!.headers['content-type']).toBe('application/json');
  });
});
