# @meilro/sdk

The official Node.js and TypeScript client for the [meil.ro](https://meil.ro) API: transactional email and newsletters.

- Node 18 or newer, plus Bun, Deno, Cloudflare Workers and Vercel Edge. It uses the global `fetch` and has no dependencies.
- Ships as ESM and CommonJS, with types.
- Safe retries: sends always carry an `Idempotency-Key`, so a retry never sends twice.

```sh
npm install @meilro/sdk
```

```ts
import { Meil } from '@meilro/sdk';

const meil = new Meil('meil_...'); // or set MEIL_API_KEY and call new Meil()
```

CommonJS works too: `const { Meil } = require('@meilro/sdk');`.

Field names are the API's own (`reply_to`, `template_id`, `audience_id`), so the [API docs](https://meil.ro/docs) and this package read the same.

## Sending email

```ts
const { id } = await meil.emails.send({
  from: 'Magazinul Tău <comenzi@example.com>',
  to: 'ana@example.com', // a string, "a@example.org, b@example.net", or an array; at most 50 recipients with cc and bcc
  subject: 'Comanda 2451 a fost expediată',
  html: '<p>Salut Ana, comanda ta e pe drum.</p>',
});
```

With a saved template and its placeholders:

```ts
await meil.emails.send({
  from: 'Magazinul Tău <comenzi@example.com>',
  to: 'ana@example.com',
  template_id: 'tpl_id',
  variables: { name: 'Ana', order_id: 2451 },
});
```

With attachments. Pass the file's bytes (a `Buffer`, `Uint8Array` or `ArrayBuffer`) and the SDK base64-encodes them. A `string` is sent as is, so it must already be base64. You can attach up to 20 files, 7 MB in total.

```ts
import { readFile } from 'node:fs/promises';

await meil.emails.send({
  from: 'Magazinul Tău <facturi@example.com>',
  to: 'ana@example.com',
  subject: 'Factura pentru comanda 2451',
  heading: 'Mulțumim pentru comandă', // no html: built in your domain's branding
  body: 'Factura este atașată.',
  button: { label: 'Vezi comanda', url: 'https://example.com/comenzi/2451' },
  attachments: [{ filename: 'factura-2451.pdf', content: await readFile('factura-2451.pdf') }],
});
```

The answer is `{ id }`. It can also have `unsubscribe_url`, and `suppressed` when some recipients on your suppression list were skipped.

## Idempotency keys

`emails.send()` and `broadcasts.create()` always send an `Idempotency-Key`. If you give none, the SDK makes a random UUID for the call, which makes its own retries safe. To make your own retries safe too (a queue job that runs twice, say), pass a key that is unique to the send:

```ts
await meil.emails.send(params, { idempotencyKey: `order-${order.id}-confirmation` });
```

For 24 hours, the same key with the same body returns the first answer and sends nothing new. The same key with a different body throws a `ConflictError` with code `invalid_idempotent_request`.

## Errors

Failed calls throw. Every error is a `MeilError` with:

- `code`: the API's stable error name, such as `"rate_limit_exceeded"`;
- `status`: the HTTP status;
- `message`: English text for people;
- `id`: when there is one.

```ts
import { MeilError, RateLimitError, ValidationError } from '@meilro/sdk';

try {
  await meil.emails.send(params);
} catch (error) {
  if (error instanceof ValidationError && error.code === 'send_rejected') {
    console.log('Refused by the mail provider; logged as', error.id);
  } else if (error instanceof RateLimitError) {
    console.log('Quota reached:', error.code); // daily_quota_exceeded, monthly_quota_exceeded, ...
  } else if (error instanceof MeilError) {
    console.log(error.status, error.code, error.message);
  } else {
    throw error;
  }
}
```

| Class | When |
| --- | --- |
| `AuthenticationError` | 401, a missing or invalid key |
| `PermissionError` | 403: key scope, plan, suspended account, `recipient_suppressed` |
| `NotFoundError` | 404, also for objects of a domain your key is not locked to |
| `ConflictError` | 409: idempotency conflicts |
| `ValidationError` | 422, including `send_rejected` |
| `RateLimitError` | 429, with `retryAfter` in seconds when the API sends one |
| `ServerError` | 5xx, including Cloudflare error pages (code `invalid_response`) |
| `ConnectionError` | no answer: code `connection_error` or `timeout`, status `null` |

### Retries

By default the SDK retries up to 2 times. Set `maxRetries` to change that; 0 turns retries off.

It retries:

- 429 `rate_limit_exceeded`, after the `Retry-After` the API sends;
- 409 `concurrent_idempotent_requests`;
- network errors and timeouts;
- 502, 503, 504, and Cloudflare's 520 to 524, with exponential backoff.

Quotas (`daily_quota_exceeded`, `monthly_quota_exceeded`, `previous_broadcast_pending`) are never retried. GET, PATCH and DELETE calls are retried. A POST is retried only when it carries an `Idempotency-Key`, which means only `emails.send()` and `broadcasts.create()`.

```ts
const meil = new Meil('meil_...', { maxRetries: 2, timeout: 30_000, baseUrl: 'https://api.meil.ro' });
await meil.emails.get(id, { timeout: 5_000, maxRetries: 0 }); // per call; also takes an AbortSignal as `signal`
```

## Broadcasts

```ts
const result = await meil.broadcasts.create(
  {
    audience_id: 'aud_id',
    from: 'Magazinul Tău <noutati@example.com>',
    subject: 'Noutăți în martie',
    html: '<h1>Salut {{first_name|acolo}}</h1> … <a href="{{unsubscribe_url}}">Dezabonare</a>',
    send: true, // or scheduled_at: new Date('2026-11-01T09:00:00+02:00') on paid plans; or neither for a draft
  },
  { idempotencyKey: 'newsletter-2026-03' },
);

if (result.status === 'under_review') {
  // HTTP 202: the broadcast exists and waits for a person at meil.ro to look at it.
  // Not an error. Check on it later with meil.broadcasts.get(result.id).
  console.log('Held for review:', result.id, result.message);
} else if (result.status === 'draft') {
  console.log('Draft saved:', result.id);
} else {
  console.log(`${result.status}: ${result.recipients} recipients`);
}
```

`meil.broadcasts.send(id)` sends a draft. It can also return the `under_review` result.

Other broadcast methods: `get`, `list`, `update`, `delete`, `schedule(id, date)` and `unschedule`.

## Contacts

```ts
const contact = await meil.contacts.add({
  audience_ids: ['aud_id'], // one or more
  email: 'ana+news@example.com',
  first_name: 'Ana',
  properties: { city: 'Cluj' },
});
// contact.audiences has one entry per audience, each with `subscribed`.
// An existing contact keeps its own values; clashes are listed in contact.kept_properties.

await meil.contacts.update('ana+news@example.com', { properties: { city: 'Iași', old_field: null } }); // null removes
await meil.contacts.remove('aud_id', 'ana+news@example.com'); // off one audience
await meil.contacts.delete('ana+news@example.com'); // everywhere, with its data
```

### Confirmed sign-ups

With `confirm: true` the person gets one email from the audience's domain and is subscribed only after pressing its button. Until then they get nothing (`pending_confirmation: true`), and a sign-up nobody confirms is deleted after 7 days. On the click, the contact gets `confirmed_at` and `confirmed_ip`. Someone who has confirmed once is added to new lists straight away.

```ts
const signup = await meil.contacts.add({
  audience_ids: ['aud_news', 'aud_offers'],
  email: 'ana@example.com',
  confirm: true,
  confirmed_url: 'https://example.com/thanks', // optional: where they land after confirming
  language: 'ro', // optional: the email's language, 'ro' or 'en'
});
signup.confirmation_sent; // false when nothing was waiting, or after 3 emails to the same address in an hour
```

### Your own preference page

Read the person's lists with `get`, save their choices with `update`:

```ts
const { audiences } = await meil.contacts.get('ana@example.com');
// [{ audience_id, subscribed, pending_confirmation, subscribed_at, unsubscribed_at }, ...]

await meil.contacts.update('ana@example.com', { audiences: { aud_news: true, aud_offers: false } });
```

`false` counts as the person's own unsubscribe. An address that bounced or reported spam stays blocked. To leave meil's unsubscribe link out of your campaigns, tick "I have my own unsubscribe page" on the domain's branding page; the one-click unsubscribe header stays.

The SDK URL-encodes the email addresses in paths for you.

## Paging

`emails.list()` and `audiences.listContacts()` return one page: `{ object: 'list', has_more, data }`. To get everything, iterate. Pages are fetched as you go:

```ts
for await (const contact of meil.audiences.iterateContacts('aud_id', { limit: 1000 })) {
  console.log(contact.email, contact.unsubscribed);
}

for await (const email of meil.emails.iterate()) {
  if (email.last_event === 'bounced') console.log(email.to);
}
```

The other lists (`audiences.list()`, `broadcasts.list()`, `templates.list()`) return everything at once.

## All methods

| Resource | Methods |
| --- | --- |
| `emails` | `send`, `list`, `iterate`, `get` |
| `audiences` | `create`, `list`, `get`, `delete`, `listContacts`, `iterateContacts` |
| `contacts` | `add`, `get`, `update`, `delete`, `remove` |
| `broadcasts` | `create`, `list`, `get`, `update`, `delete`, `send`, `schedule`, `unschedule` |
| `templates` | `create`, `list`, `get`, `update`, `delete` |
| `content` | `check` |

A key's scope decides what it may call. `email_access` keys get emails and the content check; `broadcast_access` keys get everything except audiences and contacts. The SDK does not check scopes: the API answers with a `PermissionError` (`insufficient_permission`).

## Timestamps

Timestamps in answers (`created_at`, `scheduled_at`, `sent_at`, ...) are **UTC** strings formatted `"YYYY-MM-DD HH:MM:SS"`, returned as the API sends them. To parse one: `new Date(created_at.replace(' ', 'T') + 'Z')`.

## Types

Every request and answer has a named type: `SendEmailParams`, `SentEmail`, `Email`, `ContactDetail`, `Broadcast`, `BroadcastUnderReview`, `ErrorCode`, and so on. They are generated from [openapi.json](https://meil.ro/openapi.json). To refresh them, run `npm run generate`.

## Development

```sh
npm install
npm test           # mocked fetch, no network
npm run typecheck
npm run build      # dist/: ESM, CommonJS and .d.ts
MEIL_API_KEY=... MEIL_TEST_DOMAIN=example.com npm run test:live   # real API; mails only the SES simulator
```

## License

MIT
