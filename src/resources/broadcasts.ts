import {
  randomUuid,
  segment,
  type HttpClient,
  type IdempotentRequestOptions,
  type RawResponse,
  type RequestOptions,
} from '../http';
import type {
  Broadcast,
  BroadcastDeleted,
  BroadcastDraft,
  BroadcastList,
  BroadcastQueued,
  BroadcastUnderReview,
  CreateBroadcastParams,
  UpdateBroadcastParams,
} from '../types';

export class Broadcasts {
  constructor(private readonly http: HttpClient) {}

  /**
   * POST /broadcasts: a draft; with `send: true` it goes out at once, with
   * `scheduled_at` it waits. When it is held for review (HTTP 202) the result
   * has `status: "under_review"`; that is not an error. Always sent with an
   * Idempotency-Key (a random one unless you pass `idempotencyKey`).
   */
  async create(
    params: CreateBroadcastParams,
    options: IdempotentRequestOptions = {},
  ): Promise<BroadcastDraft | BroadcastQueued | BroadcastUnderReview> {
    const { scheduled_at, ...rest } = params;
    const body = scheduled_at === undefined ? rest : { ...rest, scheduled_at: isoTime(scheduled_at) };
    const response = await this.http.request({
      method: 'POST',
      path: '/broadcasts',
      body,
      idempotencyKey: options.idempotencyKey ?? randomUuid(),
      options,
    });
    return underReview(response) ?? (response.data as BroadcastDraft | BroadcastQueued);
  }

  /** GET /broadcasts: all of them at once. */
  async list(options?: RequestOptions): Promise<BroadcastList> {
    const { data } = await this.http.request({ method: 'GET', path: '/broadcasts', options });
    return data as BroadcastList;
  }

  /** GET /broadcasts/{id}, with recipient counts. */
  async get(id: string, options?: RequestOptions): Promise<Broadcast> {
    const { data } = await this.http.request({ method: 'GET', path: `/broadcasts/${segment(id)}`, options });
    return data as Broadcast;
  }

  /** PATCH /broadcasts/{id}: a draft that has not started sending. */
  async update(id: string, params: UpdateBroadcastParams, options?: RequestOptions): Promise<Broadcast> {
    const { data } = await this.http.request({
      method: 'PATCH',
      path: `/broadcasts/${segment(id)}`,
      body: params,
      options,
    });
    return data as Broadcast;
  }

  /** DELETE /broadcasts/{id}: a draft, scheduled or not. */
  async delete(id: string, options?: RequestOptions): Promise<BroadcastDeleted> {
    const { data } = await this.http.request({ method: 'DELETE', path: `/broadcasts/${segment(id)}`, options });
    return data as BroadcastDeleted;
  }

  /**
   * POST /broadcasts/{id}/send: sends a draft. Held for review (HTTP 202), the
   * result has `status: "under_review"`. Not retried automatically: the
   * endpoint takes no Idempotency-Key.
   */
  async send(id: string, options?: RequestOptions): Promise<BroadcastQueued | BroadcastUnderReview> {
    const response = await this.http.request({ method: 'POST', path: `/broadcasts/${segment(id)}/send`, options });
    return underReview(response, id) ?? (response.data as BroadcastQueued);
  }

  /** POST /broadcasts/{id}/schedule (paid plans). A Date, or an ISO 8601 string with an offset or Z. */
  async schedule(id: string, scheduledAt: Date | string, options?: RequestOptions): Promise<BroadcastDraft> {
    const { data } = await this.http.request({
      method: 'POST',
      path: `/broadcasts/${segment(id)}/schedule`,
      body: { scheduled_at: isoTime(scheduledAt) },
      options,
    });
    return data as BroadcastDraft;
  }

  /** POST /broadcasts/{id}/unschedule: back to an unscheduled draft. */
  async unschedule(id: string, options?: RequestOptions): Promise<BroadcastDraft> {
    const { data } = await this.http.request({
      method: 'POST',
      path: `/broadcasts/${segment(id)}/unschedule`,
      options,
    });
    return data as BroadcastDraft;
  }
}

/** The 202 `under_review` answer as a result, or null for any other answer. */
function underReview(response: RawResponse, fallbackId?: string): BroadcastUnderReview | null {
  if (response.status !== 202) return null;
  const body = response.data as { id?: unknown; error?: { name?: unknown; message?: unknown } };
  if (body?.error?.name !== 'under_review') return null;
  return {
    object: 'broadcast',
    id: typeof body.id === 'string' ? body.id : (fallbackId ?? ''),
    status: 'under_review',
    under_review: true,
    message: typeof body.error.message === 'string' ? body.error.message : 'The broadcast is held for review.',
  };
}

function isoTime(value: Date | string): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new TypeError('scheduled_at is an invalid Date.');
    return value.toISOString();
  }
  return value;
}
