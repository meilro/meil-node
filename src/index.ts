export { Meil } from './client';
export type { ClientOptions, FetchLike, IdempotentRequestOptions, RequestOptions } from './http';
export {
  AuthenticationError,
  ConflictError,
  ConnectionError,
  MeilError,
  NotFoundError,
  PermissionError,
  RateLimitError,
  ServerError,
  ValidationError,
} from './errors';
export type * from './types';
export { VERSION } from './version';
