import type { HttpClient, RequestOptions } from '../http';
import type { CheckContentParams, ContentCheck } from '../types';

export class Content {
  constructor(private readonly http: HttpClient) {}

  /** POST /content/check: scores an email out of 100. Sends nothing. */
  async check(params: CheckContentParams, options?: RequestOptions): Promise<ContentCheck> {
    const { data } = await this.http.request({ method: 'POST', path: '/content/check', body: params, options });
    return data as ContentCheck;
  }
}
