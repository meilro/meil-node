# Changelog

## 0.1.0 (2026-10-14)

First release.

- A method for each of the API's 27 operations: emails, audiences, contacts, broadcasts, templates and the content check.
- Typed requests and answers, generated from the OpenAPI spec.
- Errors thrown as `MeilError` subclasses carrying `code`, `status`, `message` and `id`.
- Retries for rate limits, network errors and 502/503/504/520–524. `emails.send()` and `broadcasts.create()` always send an Idempotency-Key.
- A 202 `under_review` answer comes back as a result with `status: "under_review"`, not as an error.
- `emails.iterate()` and `audiences.iterateContacts()` page automatically.
- ESM and CommonJS builds. No runtime dependencies. Works in Node 18+ and in edge runtimes.
