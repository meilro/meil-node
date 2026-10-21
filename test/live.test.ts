/**
 * Against the real API: `MEIL_API_KEY=... MEIL_TEST_DOMAIN=yourdomain.ro npm run test:live`.
 *
 * Mails only Amazon SES's mailbox simulator, keeps 0.3 s between calls,
 * never sends a broadcast, and deletes everything it creates.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { ConflictError, Meil, NotFoundError, PermissionError, AuthenticationError, type FetchLike } from '../src/index';

const KEY = process.env.MEIL_API_KEY;
const DOMAIN = process.env.MEIL_TEST_DOMAIN;
const RUN = `${Date.now()}`;
const FROM = `meil-node-test <sdk-test@${DOMAIN}>`;
const sim = (tag: string) => `success+node-${tag}-${RUN}@simulator.amazonses.com`;

let last = 0;
const paced: FetchLike = async (url, init) => {
  const wait = last + 300 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();
  return fetch(url, init);
};

const meil = new Meil(KEY ?? 'unset', { fetch: paced });
const created = { audiences: [] as string[], templates: [] as string[], broadcasts: [] as string[], contacts: [] as string[] };

/** Runs `fn`, or skips (returning undefined) when this key's scope does not cover it. */
async function scoped<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof PermissionError && error.code === 'insufficient_permission') {
      console.warn('Skipped: the API key does not have permission for this part.');
      return undefined;
    }
    throw error;
  }
}

async function quietly(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (error) {
    if (!(error instanceof NotFoundError)) console.warn('Cleanup failed:', (error as Error).message);
  }
}

describe.skipIf(!KEY || !DOMAIN)('live API', { timeout: 60_000 }, () => {
  afterAll(async () => {
    for (const id of created.broadcasts) await quietly(() => meil.broadcasts.delete(id));
    for (const id of created.templates) await quietly(() => meil.templates.delete(id));
    for (const email of created.contacts) await quietly(() => meil.contacts.delete(email));
    for (const id of created.audiences) await quietly(() => meil.audiences.delete(id));
  });

  it('checks content', async () => {
    const check = await meil.content.check({ from: FROM, subject: 'BIG SALE!!!', html: '<p><a href="https://bit.ly/x">x</a></p>' });
    expect(check.object).toBe('content_check');
    expect(check.issues.map((i) => i.code)).toContain('link_shortener');
  });

  it('sends, replays an Idempotency-Key, and refuses it with another body', async () => {
    const key = `meil-node-live-${RUN}`;
    const params = { from: FROM, to: sim('send'), subject: 'meil-node live test', html: '<p>Hello from the SDK test.</p>' };
    const first = await meil.emails.send(params, { idempotencyKey: key });
    expect(first.id).toMatch(/^[0-9a-f-]{36}$/);
    const replay = await meil.emails.send(params, { idempotencyKey: key });
    expect(replay.id).toBe(first.id);
    await expect(meil.emails.send({ ...params, subject: 'other' }, { idempotencyKey: key })).rejects.toMatchObject({
      constructor: ConflictError,
      code: 'invalid_idempotent_request',
    });

    const email = await meil.emails.get(first.id);
    expect(email.to).toEqual([sim('send')]);
    expect(email.created_at).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);

    const page = await meil.emails.list({ limit: 1 });
    expect(page.data).toHaveLength(1);
    let seen = 0;
    for await (const _ of meil.emails.iterate({ limit: 1 })) if (++seen === 2) break;
    expect(seen).toBe(2);
  });

  it('sends a branded email with an attachment given as bytes', async () => {
    const sent = await meil.emails.send({
      from: FROM,
      to: sim('layout'),
      subject: 'meil-node layout test',
      heading: 'Test',
      body: 'An attachment is included.',
      button: { label: 'Open', url: `https://${DOMAIN}/` },
      attachments: [{ filename: 'note.txt', content: new TextEncoder().encode('hello') }],
    });
    const email = await meil.emails.get(sent.id);
    expect(email.attachments).toEqual([{ filename: 'note.txt', bytes: 5, type: expect.any(String) }]);
  });

  it('manages templates and sends one', async () => {
    await scoped(async () => {
      const tpl = await meil.templates.create({ name: `meil-node ${RUN}`, subject: 'Order {{order_id}}', html: '<p>Hi {{name|there}}, order {{order_id}}.</p>' });
      created.templates.push(tpl.id);
      expect(tpl.variables).toEqual(['order_id', 'name']);
      expect(typeof tpl.content_check.score).toBe('number');
      expect((await meil.templates.update(tpl.id, { subject: 'Your order {{order_id}}' })).subject).toBe('Your order {{order_id}}');
      expect((await meil.templates.get(tpl.id)).html).toContain('{{order_id}}');
      expect((await meil.templates.list()).data.map((t) => t.id)).toContain(tpl.id);
      const sent = await meil.emails.send({ from: FROM, to: sim('template'), template_id: tpl.id, variables: { order_id: 2451 } });
      expect((await meil.emails.get(sent.id)).subject).toBe('Your order 2451');
      expect((await meil.templates.delete(tpl.id)).deleted).toBe(true);
      created.templates.pop();
    });
  });

  it('manages audiences, contacts (with + in the address) and a draft broadcast', async () => {
    await scoped(async () => {
      const audience = await meil.audiences.create({ name: `meil-node ${RUN}`, domain: DOMAIN!, visibility: 'private' });
      created.audiences.push(audience.id);
      expect((await meil.audiences.list()).data.map((a) => a.id)).toContain(audience.id);

      const a = sim('contact-a');
      const b = sim('contact-b');
      created.contacts.push(a, b);
      const added = await meil.contacts.add({ audience_ids: [audience.id], email: a, first_name: 'Ana', properties: { city: 'Cluj', plan: 'pro' } });
      expect(added.audiences[0]!.subscribed).toBe(true);
      await meil.contacts.add({ audience_ids: [audience.id], email: b });
      const again = await meil.contacts.add({ audience_ids: [audience.id], email: a, properties: { city: 'Iasi' } });
      expect(again.kept_properties).toEqual(['city']);

      const contact = await meil.contacts.get(a);
      expect(contact.email).toBe(a);
      expect(contact.properties).toEqual({ city: 'Cluj', plan: 'pro' });
      const updated = await meil.contacts.update(a, { last_name: 'Pop', properties: { plan: null, city: 'Iasi' } });
      expect(updated.properties).toEqual({ city: 'Iasi' });
      const left = await meil.contacts.update(a, { audiences: { [audience.id]: false } });
      expect(left.audiences[0]).toMatchObject({ audience_id: audience.id, subscribed: false });
      expect((await meil.contacts.update(a, { audiences: { [audience.id]: true } })).audiences[0]!.subscribed).toBe(true);

      expect((await meil.audiences.get(audience.id)).contacts_count).toBe(2);
      const page = await meil.audiences.listContacts(audience.id, { limit: 1 });
      expect(page.has_more).toBe(true);
      const emails: string[] = [];
      for await (const c of meil.audiences.iterateContacts(audience.id, { limit: 1 })) emails.push(c.email);
      expect(emails.sort()).toEqual([a, b].sort());

      // A draft only: it is never sent.
      const draft = await meil.broadcasts.create({ audience_id: audience.id, from: FROM, subject: 'meil-node draft', html: '<p>Draft</p>' });
      expect(draft.status).toBe('draft');
      created.broadcasts.push(draft.id);
      expect((await meil.broadcasts.update(draft.id, { subject: 'meil-node draft 2', reply_to: null })).subject).toBe('meil-node draft 2');
      expect((await meil.broadcasts.get(draft.id)).status).toBe('draft');
      expect((await meil.broadcasts.list()).data.map((x) => x.id)).toContain(draft.id);
      try {
        const when = new Date(Date.now() + 7 * 86_400_000);
        expect((await meil.broadcasts.schedule(draft.id, when)).scheduled_at).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
      } catch (error) {
        // Scheduling is for paid plans.
        expect(error).toMatchObject({ code: 'plan_required' });
      }
      expect((await meil.broadcasts.unschedule(draft.id)).scheduled_at).toBeNull();
      expect((await meil.broadcasts.delete(draft.id)).deleted).toBe(true);
      created.broadcasts.pop();

      expect(await meil.contacts.remove(audience.id, b)).toMatchObject({ audience_id: audience.id, deleted: true });
      expect((await meil.contacts.delete(a)).deleted).toBe(true);
      expect((await meil.audiences.delete(audience.id)).deleted).toBe(true);
      created.audiences.pop();
    });
  });

  it('maps errors', async () => {
    await expect(meil.emails.get('00000000-0000-4000-8000-000000000000')).rejects.toBeInstanceOf(NotFoundError);
    const bad = new Meil('meil_' + '0'.repeat(48), { fetch: paced });
    await expect(bad.templates.list()).rejects.toBeInstanceOf(AuthenticationError);
  });
});
