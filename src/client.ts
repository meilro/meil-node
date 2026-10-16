import { HttpClient, type ClientOptions } from './http';
import { Audiences } from './resources/audiences';
import { Broadcasts } from './resources/broadcasts';
import { Contacts } from './resources/contacts';
import { Content } from './resources/content';
import { Emails } from './resources/emails';
import { Templates } from './resources/templates';

/**
 * The meil.ro API client.
 *
 * ```ts
 * const meil = new Meil('meil_...');
 * await meil.emails.send({ from: 'Shop <hello@shop.ro>', to: 'ana@example.com', subject: 'Hi', html: '<p>Hi</p>' });
 * ```
 */
export class Meil {
  readonly emails: Emails;
  readonly audiences: Audiences;
  readonly contacts: Contacts;
  readonly broadcasts: Broadcasts;
  readonly templates: Templates;
  readonly content: Content;

  /** @param apiKey Defaults to the MEIL_API_KEY environment variable, where there is one. */
  constructor(apiKey?: string, options: ClientOptions = {}) {
    const http = new HttpClient(apiKey, options);
    this.emails = new Emails(http);
    this.audiences = new Audiences(http);
    this.contacts = new Contacts(http);
    this.broadcasts = new Broadcasts(http);
    this.templates = new Templates(http);
    this.content = new Content(http);
  }
}
