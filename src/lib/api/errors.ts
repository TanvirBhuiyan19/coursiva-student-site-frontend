import { camelize } from './case';

/** A non-2xx API response. `fieldErrors` holds Laravel 422 messages keyed by camelCase field. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly fieldErrors: Record<string, string> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }

  static async from(res: Response): Promise<ApiError> {
    let message = res.statusText || `Request failed (${res.status})`;
    let fieldErrors: Record<string, string> = {};
    try {
      const body = camelize<{ message?: string; errors?: Record<string, string[]> }>(await res.json());
      if (body.message) message = body.message;
      if (body.errors) fieldErrors = Object.fromEntries(Object.entries(body.errors).map(([k, v]) => [k, v[0] ?? '']));
    } catch {
      // Non-JSON body (proxy error page etc.) — keep the status text.
    }
    return new ApiError(res.status, message, fieldErrors);
  }

  get isValidation() {
    return this.status === 422;
  }
  get isUnauthenticated() {
    return this.status === 401;
  }
}
