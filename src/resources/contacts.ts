import { segment, type HttpClient, type RequestOptions } from '../http';
import type {
  AddContactParams,
  Confirmation,
  ConfirmationResult,
  ConfirmContactParams,
  Contact,
  ContactDeleted,
  ContactDetail,
  UpdateContactParams,
} from '../types';

export class Contacts {
  constructor(private readonly http: HttpClient) {}

  /**
   * POST /contacts: adds someone to the audiences in `audience_ids` (a list,
   * also for one). An existing contact only gains the properties it lacks;
   * clashing values are kept and named in `kept_properties`. Never undoes an
   * unsubscribe. With `confirm: true` they wait until they press the button in
   * a confirmation email (`pending_confirmation`); someone who already
   * confirmed a list on the same domain is added straight away. With
   * `confirm_page` (your own page) the email's button opens that page instead
   * of meil.ro's, with `?token=…` added to its link, and it confirms with
   * `confirm()`.
   */
  async add(params: AddContactParams, options?: RequestOptions): Promise<Contact> {
    const { data } = await this.http.request({ method: 'POST', path: '/contacts', body: params, options });
    return data as Contact;
  }

  /**
   * GET /contacts/confirm/{token}: where a sign-up stands, for your own
   * confirmation page (`confirm_page`), with the `token` from its link. Changes nothing,
   * so call it as the page opens: show the button while `status` is `pending`,
   * say the link expired when it is `expired`. Throws `NotFoundError` for a
   * token that is not valid (cut short, changed, or another account's).
   */
  async getConfirmation(token: string, options?: RequestOptions): Promise<Confirmation> {
    const { data } = await this.http.request({ method: 'GET', path: `/contacts/confirm/${segment(token)}`, options });
    return data as Confirmation;
  }

  /**
   * POST /contacts/confirm: subscribes the person to every audience in the
   * link. Call it only when they press your page's button, never when the page
   * loads: mail filters open every link in an email to scan it, and a page that
   * confirms on opening would subscribe everyone. Pass the visitor's IP as
   * `ip`, saved as proof. Pressing twice is harmless (`already_confirmed`). An
   * expired link is not an error: `status` is `expired`.
   */
  async confirm(token: string, params: ConfirmContactParams = {}, options?: RequestOptions): Promise<ConfirmationResult> {
    const body: Record<string, string> = { token };
    if (params.ip !== undefined && params.ip !== '') {
      body.ip = params.ip;
    }
    const { data } = await this.http.request({ method: 'POST', path: '/contacts/confirm', body, options });
    return data as ConfirmationResult;
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
