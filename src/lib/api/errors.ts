import { camelize } from './case';

/**
 * A non-2xx API response. `fieldErrors` holds Laravel 422 messages keyed by camelCase field. `code` is the API's
 * machine-readable error code (`conflict`, `submission_closed`, …) and `reason` its optional detail
 * (`tutor_resting`, `file_quarantined`, `discussion_off`, …) when the body has them. `title` is the page title
 * of a `page_password_required` answer. `details` is the whole (camelCase) body for answers with more to say, e.g.
 * `403 lesson_locked { reason, unlocks_at, after }`.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly fieldErrors: Record<string, string> = {},
    readonly code: string | null = null,
    readonly reason: string | null = null,
    readonly title: string | null = null,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }

  static async from(res: Response): Promise<ApiError> {
    let message = res.statusText || `Request failed (${res.status})`;
    let fieldErrors: Record<string, string> = {};
    let code: string | null = null;
    let reason: string | null = null;
    let title: string | null = null;
    let details: Record<string, unknown> = {};
    try {
      const body = camelize<{ message?: string; errors?: Record<string, string[]>; code?: unknown; reason?: unknown; title?: unknown }>(
        await res.json(),
      );
      details = { ...body };
      if (body.message) message = body.message;
      if (body.errors) fieldErrors = Object.fromEntries(Object.entries(body.errors).map(([k, v]) => [k, v[0] ?? '']));
      if (typeof body.code === 'string') code = body.code;
      if (typeof body.reason === 'string') reason = body.reason;
      if (typeof body.title === 'string') title = body.title;
    } catch {
      // Non-JSON body (proxy error page etc.) — keep the status text.
    }
    return new ApiError(res.status, message, fieldErrors, code, reason, title, details);
  }

  get isValidation() {
    return this.status === 422;
  }
  get isUnauthenticated() {
    return this.status === 401;
  }
  get isConflict() {
    return this.status === 409;
  }
  get isRateLimited() {
    return this.status === 429;
  }
}
