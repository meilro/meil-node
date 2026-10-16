import { randomUuid, segment, type HttpClient, type IdempotentRequestOptions, type RequestOptions } from '../http';
import type { Attachment, Email, EmailList, EmailSummary, ListEmailsParams, SendEmailParams, SentEmail } from '../types';
import { paginate } from './paginate';

export class Emails {
  constructor(private readonly http: HttpClient) {}

  /**
   * POST /emails. Always sent with an Idempotency-Key (a random one unless you
   * pass `idempotencyKey`), so a retry never sends twice.
   */
  async send(params: SendEmailParams, options: IdempotentRequestOptions = {}): Promise<SentEmail> {
    const body = params.attachments ? { ...params, attachments: params.attachments.map(encodeAttachment) } : params;
    const { data } = await this.http.request({
      method: 'POST',
      path: '/emails',
      body,
      idempotencyKey: options.idempotencyKey ?? randomUuid(),
      options,
    });
    return data as SentEmail;
  }

  /** GET /emails: one page, newest first. */
  async list(params: ListEmailsParams = {}, options?: RequestOptions): Promise<EmailList> {
    const { data } = await this.http.request({ method: 'GET', path: '/emails', query: params, options });
    return data as EmailList;
  }

  /**
   * Every email from `params` on, fetching pages as needed:
   * `for await (const email of meil.emails.iterate()) { ... }`.
   */
  iterate(params: ListEmailsParams = {}, options?: RequestOptions): AsyncGenerator<EmailSummary, void, undefined> {
    return paginate((p) => this.list(p, options), params);
  }

  /** GET /emails/{id}. */
  async get(id: string, options?: RequestOptions): Promise<Email> {
    const { data } = await this.http.request({ method: 'GET', path: `/emails/${segment(id)}`, options });
    return data as Email;
  }
}

function encodeAttachment(attachment: Attachment): { filename: string; content: string } {
  const { content } = attachment;
  if (typeof content === 'string') return { ...attachment, content };
  const bytes = content instanceof Uint8Array ? content : new Uint8Array(content);
  return { ...attachment, content: base64(bytes) };
}

/** Base64 without Buffer, so it also runs on edge runtimes. */
function base64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
