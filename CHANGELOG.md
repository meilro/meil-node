# Changelog

## 0.2.0 (2026-10-21)

Breaking:

- `contacts.add()` takes `audience_ids` (a list, also for one audience) instead of `audience_id`, and answers with `audiences`: one entry per audience, each with its own `subscribed`.

New:

- `contacts.add()` with `confirm: true`: the person is subscribed only after confirming from an email. Optional `confirmed_url`, `language`, `from` and `reply_to`.
- `contacts.update()` with `audiences` (`{ [audienceId]: true | false }`), for a preference page on your own site.
- Every audience of a contact shows `pending_confirmation`, `subscribed_at` and `unsubscribed_at`. Listed contacts show `pending_confirmation`.
- `preview_text` on emails, broadcasts and templates, and the `no_preview_text` content check.
- Templates have a `domain`: set it when creating or changing one (optional, the key's domain by default). A key sees only its own domains' templates.
- `domain` is optional when creating an audience: the key's domain by default.

## 0.1.0 (2026-10-14)

First release.

- A method for each of the API's 27 operations: emails, audiences, contacts, broadcasts, templates and the content check.
- Typed requests and answers, generated from the OpenAPI spec.
- Errors thrown as `MeilError` subclasses carrying `code`, `status`, `message` and `id`.
- Retries for rate limits, network errors and 502/503/504/520–524. `emails.send()` and `broadcasts.create()` always send an Idempotency-Key.
- A 202 `under_review` answer comes back as a result with `status: "under_review"`, not as an error.
- `emails.iterate()` and `audiences.iterateContacts()` page automatically.
- ESM and CommonJS builds. No runtime dependencies. Works in Node 18+ and in edge runtimes.
