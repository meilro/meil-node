/**
 * Readable names for the API's shapes. Everything here is derived from
 * src/generated/openapi.ts (regenerate it with `npm run generate`), adjusted
 * only where the SDK accepts more than raw JSON: attachments as bytes and
 * scheduled_at as a Date.
 *
 * Field names are the API's own, in snake_case. Timestamps in answers are UTC
 * strings formatted "YYYY-MM-DD HH:MM:SS" (not ISO 8601), returned as they come.
 */
import type { components, operations } from './generated/openapi';

type Schemas = components['schemas'];
type Body<Op extends keyof operations> = operations[Op] extends {
  requestBody: { content: { 'application/json': infer B } };
}
  ? B
  : never;
type Query<Op extends keyof operations> = operations[Op] extends { parameters: { query?: infer Q } }
  ? NonNullable<Q>
  : never;

// ---- Emails ----------------------------------------------------------------

/**
 * An attachment. `content` is the file's bytes (a Buffer, Uint8Array or
 * ArrayBuffer), which the SDK base64-encodes, or a string that is already base64.
 */
export interface Attachment {
  filename: string;
  content: string | Uint8Array | ArrayBuffer;
}

export type SendEmailParams = Omit<Body<'sendEmail'>, 'attachments'> & {
  /** At most 20 files, 7 MB in total. */
  attachments?: Attachment[];
};
export type SentEmail = Schemas['SentEmail'];
export type ListEmailsParams = Query<'listEmails'>;
export type EmailSummary = Schemas['EmailSummary'];
export type EmailList = Schemas['EmailList'];
export type Email = Schemas['Email'];
export type EmailEvent = Email['last_event'];

// ---- Audiences -------------------------------------------------------------

export type CreateAudienceParams = Body<'createAudience'>;
export type Audience = Schemas['Audience'];
export type AudienceList = Schemas['AudienceList'];
export type AudienceDetail = Schemas['AudienceDetail'];
export type AudienceDeleted = Schemas['AudienceDeleted'];

// ---- Contacts --------------------------------------------------------------

/** Custom fields of a contact, usable as {{placeholders}}. */
export type ContactProperties = Record<string, unknown>;

export type ListContactsParams = Query<'listContacts'>;
export type ContactList = Omit<Schemas['ContactList'], 'data'> & {
  data: (Omit<Schemas['ContactList']['data'][number], 'properties'> & { properties: ContactProperties })[];
};
export type ContactListItem = ContactList['data'][number];
export type AddContactParams = Omit<Body<'addContact'>, 'properties'> & { properties?: ContactProperties };
export type Contact = Omit<Schemas['Contact'], 'properties'> & { properties?: ContactProperties };
export type UpdateContactParams = Omit<Body<'updateContact'>, 'properties'> & {
  /** Keys to set; a key set to `null` is removed. */
  properties?: Record<string, unknown>;
};
export type ContactDetail = Omit<Schemas['ContactDetail'], 'properties'> & { properties: ContactProperties };
export type ContactDeleted = Schemas['ContactDeleted'];

/** Where a sign-up made with `confirm: true` stands, for your own confirmation page (`confirm_page`). */
export type Confirmation = Schemas['Confirmation'];
/** `pending` (waiting, the link works), `confirmed` (now or before) or `expired` (nothing left it can confirm). */
export type ConfirmationStatus = Confirmation['status'];
/** What `contacts.confirm()` answers: the confirmation, and whether it had been confirmed before this call. */
export type ConfirmationResult = Schemas['ConfirmationResult'];
export interface ConfirmContactParams {
  /** The visitor's IP address, saved in the contact's `confirmed_ip` as proof. Without it, `confirmed_ip` stays empty. */
  ip?: string;
}

// ---- Broadcasts ------------------------------------------------------------

export type CreateBroadcastParams = Omit<Body<'createBroadcast'>, 'scheduled_at'> & {
  /** When to send it (paid plans). A Date, or an ISO 8601 string with an offset or Z. */
  scheduled_at?: Date | string;
};
export type UpdateBroadcastParams = Body<'updateBroadcast'>;
export type BroadcastDraft = Schemas['BroadcastDraft'];
export type BroadcastQueued = Schemas['BroadcastQueued'];
export type BroadcastList = Schemas['BroadcastList'];
export type BroadcastListItem = BroadcastList['data'][number];
export type Broadcast = Schemas['Broadcast'];
export type BroadcastStatus = Broadcast['status'];
export type BroadcastDeleted = Schemas['BroadcastDeleted'];

/**
 * Not an API object: what the SDK returns when the API answers 202
 * `under_review`. The broadcast exists and is held until a person at meil.ro
 * has looked at it; it is not an error.
 */
export interface BroadcastUnderReview {
  object: 'broadcast';
  id: string;
  status: 'under_review';
  under_review: true;
  /** The API's explanation, for people. */
  message: string;
}

// ---- Templates -------------------------------------------------------------

export type CreateTemplateParams = Body<'createTemplate'>;
export type UpdateTemplateParams = Body<'updateTemplate'>;
export type Template = Schemas['Template'];
export type TemplateSaved = Schemas['TemplateSaved'];
export type TemplateList = Schemas['TemplateList'];
export type TemplateListItem = TemplateList['data'][number];
export type TemplateDeleted = Schemas['TemplateDeleted'];

// ---- Content check ---------------------------------------------------------

export type CheckContentParams = Body<'checkContent'>;
export type ContentCheck = Schemas['ContentCheck'];
export type ContentIssue = ContentCheck['issues'][number];

// ---- Errors ----------------------------------------------------------------

/** Every error name the API documents (`MeilError.code`). */
export type ErrorCode = Schemas['Error']['error']['name'];
