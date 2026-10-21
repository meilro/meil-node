import { segment, type HttpClient, type RequestOptions } from '../http';
import type { AddContactParams, Contact, ContactDeleted, ContactDetail, UpdateContactParams } from '../types';

export class Contacts {
  constructor(private readonly http: HttpClient) {}

  /**
   * POST /contacts: adds someone to the audiences in `audience_ids` (a list,
   * also for one). An existing contact only gains the properties it lacks;
   * clashing values are kept and named in `kept_properties`. Never undoes an
   * unsubscribe. With `confirm: true` they wait until they press the button in
   * a confirmation email (`pending_confirmation`); someone who confirmed before
   * is added straight away.
   */
  async add(params: AddContactParams, options?: RequestOptions): Promise<Contact> {
    const { data } = await this.http.request({ method: 'POST', path: '/contacts', body: params, options });
    return data as Contact;
  }

  /** GET /contacts/{email}, with the audiences it is in. */
  async get(email: string, options?: RequestOptions): Promise<ContactDetail> {
    const { data } = await this.http.request({ method: 'GET', path: `/contacts/${segment(email)}`, options });
    return data as ContactDetail;
  }

  /**
   * PATCH /contacts/{email}. Only what you send changes; a property set to
   * `null` is removed. `audiences` ({ [audienceId]: true | false }) puts them on
   * or takes them off lists, for a preference page on your own site.
   */
  async update(email: string, params: UpdateContactParams, options?: RequestOptions): Promise<ContactDetail> {
    const { data } = await this.http.request({
      method: 'PATCH',
      path: `/contacts/${segment(email)}`,
      body: params,
      options,
    });
    return data as ContactDetail;
  }

  /** DELETE /contacts/{email}: from every audience, with its name and properties. */
  async delete(email: string, options?: RequestOptions): Promise<ContactDeleted> {
    const { data } = await this.http.request({ method: 'DELETE', path: `/contacts/${segment(email)}`, options });
    return data as ContactDeleted;
  }

  /** DELETE /audiences/{audienceId}/contacts/{email}: takes a contact off one audience. */
  async remove(audienceId: string, email: string, options?: RequestOptions): Promise<ContactDeleted> {
    const { data } = await this.http.request({
      method: 'DELETE',
      path: `/audiences/${segment(audienceId)}/contacts/${segment(email)}`,
      options,
    });
    return data as ContactDeleted;
  }
}
