import { segment, type HttpClient, type RequestOptions } from '../http';
import type {
  CreateTemplateParams,
  Template,
  TemplateDeleted,
  TemplateList,
  TemplateSaved,
  UpdateTemplateParams,
} from '../types';

export class Templates {
  constructor(private readonly http: HttpClient) {}

  /** POST /templates. The answer includes its content check score. */
  async create(params: CreateTemplateParams, options?: RequestOptions): Promise<TemplateSaved> {
    const { data } = await this.http.request({ method: 'POST', path: '/templates', body: params, options });
    return data as TemplateSaved;
  }

  /** GET /templates: all of them, without their content. */
  async list(options?: RequestOptions): Promise<TemplateList> {
    const { data } = await this.http.request({ method: 'GET', path: '/templates', options });
    return data as TemplateList;
  }

  /** GET /templates/{id}. */
  async get(id: string, options?: RequestOptions): Promise<Template> {
    const { data } = await this.http.request({ method: 'GET', path: `/templates/${segment(id)}`, options });
    return data as Template;
  }

  /** PATCH /templates/{id}: only the fields sent change. */
  async update(id: string, params: UpdateTemplateParams, options?: RequestOptions): Promise<TemplateSaved> {
    const { data } = await this.http.request({
      method: 'PATCH',
      path: `/templates/${segment(id)}`,
      body: params,
      options,
    });
    return data as TemplateSaved;
  }

  /** DELETE /templates/{id}. */
  async delete(id: string, options?: RequestOptions): Promise<TemplateDeleted> {
    const { data } = await this.http.request({ method: 'DELETE', path: `/templates/${segment(id)}`, options });
    return data as TemplateDeleted;
  }
}
