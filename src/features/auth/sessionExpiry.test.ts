import { ApiError } from '@/lib/api/errors';
import { expiredSignInHref, sessionExpiry } from './sessionExpiry';

const unauth = new ApiError(401, 'Unauthenticated.');
const base = { search: '', prefix: '', signedIn: true, mutation: false };

describe('sessionExpiry', () => {
  it('sends a private page to sign-in with the page as next and the expired reason', () => {
    expect(sessionExpiry(unauth, { ...base, pathname: '/account/billing', search: '?tab=1' })).toEqual({
      redirect: '/sign-in?next=%2Faccount%2Fbilling%3Ftab%3D1&reason=session_expired',
    });
  });

  it('keeps the visitor language and passes a locale-less next', () => {
    expect(sessionExpiry(unauth, { ...base, prefix: '/es', pathname: '/es/learning' })).toEqual({
      redirect: '/es/sign-in?next=%2Flearning&reason=session_expired',
    });
  });

  it('only refreshes the session for a read on a public page, and redirects when a signed-in learner acted', () => {
    expect(sessionExpiry(unauth, { ...base, pathname: '/community' })).toEqual({ refresh: true });
    expect(sessionExpiry(unauth, { ...base, pathname: '/community', mutation: true })).toEqual({
      redirect: '/sign-in?next=%2Fcommunity&reason=session_expired',
    });
    expect(sessionExpiry(unauth, { ...base, pathname: '/community', signedIn: false, mutation: true })).toBeNull();
  });

  it('ignores other errors, the sign-in pages and the staff preview', () => {
    expect(sessionExpiry(new ApiError(403, 'No'), { ...base, pathname: '/account' })).toBeNull();
    expect(sessionExpiry(new Error('network'), { ...base, pathname: '/account' })).toBeNull();
    expect(sessionExpiry(unauth, { ...base, pathname: '/sign-in' })).toBeNull();
    expect(sessionExpiry(unauth, { ...base, pathname: '/preview/tok' })).toBeNull();
  });

  it('builds the sign-in link', () => {
    expect(expiredSignInHref('', '/orders/ord_1')).toBe('/sign-in?next=%2Forders%2Ford_1&reason=session_expired');
  });
});
