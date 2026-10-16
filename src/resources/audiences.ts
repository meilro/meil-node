import { segment, type HttpClient, type RequestOptions } from '../http';
import type {
  Audience,
  AudienceDeleted,
  AudienceDetail,
  AudienceList,
  ContactList,
  ContactListItem,
  CreateAudienceParams,
  ListContactsParams,
} from '../types';
import { paginate } from './paginate';

export class Audiences {
  constructor(private readonly http: HttpClient) {}

  /** POST /audiences. `domain` must be one of your sending domains. */
  async create(params: CreateAudienceParams, options?: RequestOptions): Promise<Audience> {
    const { data } = await this.http.request({ method: 'POST', path: '/audiences', body: params, options });
    return data as Audience;
  }

  /** GET /audiences: all of them at once. */
  async list(options?: RequestOptions): Promise<AudienceList> {
    const { data } = await this.http.request({ method: 'GET', path: '/audiences', options });
    return data as AudienceList;
  }

  /** GET /audiences/{id}, with `contacts_count`. */
  async get(id: string, options?: RequestOptions): Promise<AudienceDetail> {
    const { data } = await this.http.request({ method: 'GET', path: `/audiences/${segment(id)}`, options });
    return data as AudienceDetail;
  }

  /** DELETE /audiences/{id}. Contacts in other audiences stay there. */
  async delete(id: string, options?: RequestOptions): Promise<AudienceDeleted> {
    const { data } = await this.http.request({ method: 'DELETE', path: `/audiences/${segment(id)}`, options });
    return data as AudienceDeleted;
  }

  /** GET /audiences/{id}/contacts: one page, newest first. */
  async listContacts(id: string, params: ListContactsParams = {}, options?: RequestOptions): Promise<ContactList> {
    const { data } = await this.http.request({
      method: 'GET',
      path: `/audiences/${segment(id)}/contacts`,
      query: params,
      options,
    });
    return data as ContactList;
  }

  /**
   * Every contact of an audience, fetching pages as needed:
   * `for await (const contact of meil.audiences.iterateContacts(id)) { ... }`.
   */
  iterateContacts(
    id: string,
    params: ListContactsParams = {},
    options?: RequestOptions,
  ): AsyncGenerator<ContactListItem, void, undefined> {
    return paginate((p) => this.listContacts(id, p, options), params);
  }
}
