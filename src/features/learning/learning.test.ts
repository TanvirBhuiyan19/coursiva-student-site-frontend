import { signOutRedirect } from '../auth/api';
import { SSO_ERRORS, authFailure } from '../auth/failures';
import { isAnswered, quizAnswers, resultKind } from './quiz';
import { MAX_PER_COMMIT, ScormDataModel, scorm12Api, scorm2004Api } from './scorm/runtime';
import type { QuizQuestion, QuizResult } from './types';
import { shakaDrmConfig, watermarkPosition } from './video';

describe('SCORM 1.2 run-time API (window.API)', () => {
  const setup = (cmi: Record<string, string> = {}) => {
    const commits: { changes: Record<string, string>; finish: boolean }[] = [];
    const model = new ScormDataModel(
      '1.2',
      { 'cmi.core.student_name': 'Tate, Jordan', 'cmi.core.lesson_status': 'not attempted', ...cmi },
      (changes, finish) => commits.push({ changes, finish }),
    );
    return { api: scorm12Api(model), model, commits };
  };

  it('refuses calls before LMSInitialize and after LMSFinish', () => {
    const { api } = setup();
    expect(api.LMSGetValue('cmi.core.student_name')).toBe('');
    expect(api.LMSGetLastError()).toBe('301');
    expect(api.LMSInitialize('')).toBe('true');
    expect(api.LMSGetValue('cmi.core.student_name')).toBe('Tate, Jordan');
    expect(api.LMSFinish('')).toBe('true');
    expect(api.LMSSetValue('cmi.core.lesson_status', 'passed')).toBe('false');
    expect(api.LMSGetLastError()).toBe('101');
  });

  it('enforces read-only, write-only and unknown elements with the standard codes', () => {
    const { api } = setup();
    api.LMSInitialize('');
    expect(api.LMSSetValue('cmi.core.student_name', 'Someone else')).toBe('false');
    expect(api.LMSGetLastError()).toBe('403');
    expect(api.LMSGetErrorString('403')).toBe('Element is read only');
    expect(api.LMSSetValue('cmi.core.session_time', '0000:01:00.00')).toBe('true');
    expect(api.LMSGetValue('cmi.core.session_time')).toBe('');
    expect(api.LMSGetLastError()).toBe('404');
    expect(api.LMSGetValue('adl.nav.request')).toBe('');
    expect(api.LMSGetLastError()).toBe('201');
    expect(api.LMSSetValue('cmi.core._children', 'x')).toBe('false');
    expect(api.LMSGetLastError()).toBe('402');
    expect(api.LMSGetValue('cmi.core.score._children')).toBe('raw,min,max');
  });

  it('derives _count from stored interactions and objectives', () => {
    const { api } = setup({ 'cmi.objectives.0.id': 'a', 'cmi.objectives.1.id': 'b' });
    api.LMSInitialize('');
    expect(api.LMSGetValue('cmi.objectives._count')).toBe('2');
    api.LMSSetValue('cmi.interactions.0.id', 'q1');
    api.LMSSetValue('cmi.interactions.0.objectives.0.id', 'a');
    expect(api.LMSGetValue('cmi.interactions._count')).toBe('1');
    expect(api.LMSGetValue('cmi.interactions.0.objectives._count')).toBe('1');
    expect(api.LMSGetValue('cmi.core._count')).toBe('');
    expect(api.LMSGetLastError()).toBe('203');
  });

  it('commits only what changed, and LMSFinish commits with finish: true', () => {
    const { api, commits } = setup();
    api.LMSInitialize('');
    api.LMSSetValue('cmi.core.lesson_status', 'completed');
    api.LMSSetValue('cmi.core.score.raw', 85);
    expect(api.LMSCommit('')).toBe('true');
    expect(commits).toEqual([{ changes: { 'cmi.core.lesson_status': 'completed', 'cmi.core.score.raw': '85' }, finish: false }]);
    api.LMSCommit('');
    expect(commits).toHaveLength(1);
    api.LMSSetValue('cmi.core.session_time', '0000:02:30.00');
    api.LMSFinish('');
    expect(commits[1]).toEqual({ changes: { 'cmi.core.session_time': '0000:02:30.00' }, finish: true });
  });

  it('splits large commits into chunks the API accepts', () => {
    const { api, commits } = setup();
    api.LMSInitialize('');
    for (let i = 0; i < MAX_PER_COMMIT + 10; i++) api.LMSSetValue(`cmi.interactions.${i}.id`, `q${i}`);
    api.LMSFinish('');
    expect(commits.map((c) => [Object.keys(c.changes).length, c.finish])).toEqual([
      [MAX_PER_COMMIT, false],
      [10, true],
    ]);
  });
});

describe('SCORM 2004 run-time API (window.API_1484_11)', () => {
  it('uses the 2004 error codes and reports unset elements as not initialised', () => {
    const commits: Record<string, string>[] = [];
    const api = scorm2004Api(new ScormDataModel('2004', { 'cmi.learner_name': 'Jordan Tate' }, (c) => commits.push(c)));
    expect(api.Terminate('')).toBe('false');
    expect(api.GetLastError()).toBe('112');
    expect(api.Initialize('')).toBe('true');
    expect(api.Initialize('')).toBe('false');
    expect(api.GetLastError()).toBe('103');
    expect(api.GetValue('cmi._version')).toBe('1.0');
    expect(api.GetValue('cmi.location')).toBe('');
    expect(api.GetLastError()).toBe('403');
    expect(api.SetValue('cmi.learner_name', 'x')).toBe('false');
    expect(api.GetLastError()).toBe('404');
    expect(api.SetValue('cmi.completion_status', 'completed')).toBe('true');
    expect(api.Commit('')).toBe('true');
    expect(commits).toEqual([{ 'cmi.completion_status': 'completed' }]);
    expect(api.Terminate('')).toBe('true');
    expect(api.GetValue('cmi.completion_status')).toBe('');
    expect(api.GetLastError()).toBe('123');
  });
});

describe('video helpers', () => {
  it('maps Mux DRM licences onto Shaka key systems', () => {
    expect(shakaDrmConfig(null)).toBeNull();
    expect(
      shakaDrmConfig({
        widevineLicenseUrl: 'https://license.mux.com/w',
        playreadyLicenseUrl: 'https://license.mux.com/p',
        fairplayLicenseUrl: 'https://license.mux.com/f',
        fairplayCertificateUrl: 'https://license.mux.com/c',
      }),
    ).toEqual({
      servers: {
        'com.widevine.alpha': 'https://license.mux.com/w',
        'com.microsoft.playready': 'https://license.mux.com/p',
        'com.apple.fps': 'https://license.mux.com/f',
      },
      advanced: { 'com.apple.fps': { serverCertificateUri: 'https://license.mux.com/c' } },
    });
    expect(
      shakaDrmConfig({ widevineLicenseUrl: 'w', playreadyLicenseUrl: null, fairplayLicenseUrl: null, fairplayCertificateUrl: null }),
    ).toEqual({ servers: { 'com.widevine.alpha': 'w' } });
  });
  it('starts the watermark at seed % positions and steps through them', () => {
    const positions = ['top-left', 'top-right', 'center', 'bottom-left', 'bottom-right'] as const;
    expect(watermarkPosition([...positions], 412, 0)).toBe('center');
    expect(watermarkPosition([...positions], 412, 1)).toBe('bottom-left');
    expect(watermarkPosition([...positions], 412, 3)).toBe('top-left');
    expect(watermarkPosition([], 3, 0)).toBe('center');
  });
});

describe('quiz helpers', () => {
  const q = (type: QuizQuestion['type'], extra: Partial<QuizQuestion> = {}): QuizQuestion => ({
    id: type,
    type,
    prompt: '',
    points: 1,
    media: null,
    options: [],
    multiple: type === 'multi_select',
    blankCount: 0,
    prompts: [],
    matches: [],
    ...extra,
  });
  it('knows when each question type is answered', () => {
    expect(isAnswered(q('single_choice'), { questionId: 'x', optionId: 'o1' })).toBe(true);
    expect(isAnswered(q('multi_select'), { questionId: 'x', optionIds: [] })).toBe(false);
    expect(isAnswered(q('free_text'), { questionId: 'x', text: '  ' })).toBe(false);
    expect(isAnswered(q('fill_blanks', { blankCount: 2 }), { questionId: 'x', blanks: ['a', ''] })).toBe(false);
    expect(isAnswered(q('matching', { prompts: ['a', 'b'] }), { questionId: 'x', matches: ['1', '2'] })).toBe(true);
    expect(quizAnswers([q('free_text')], {})).toEqual([{ questionId: 'free_text' }]);
  });
  it('reads a result held for review as pending, never as failed', () => {
    const base: QuizResult = {
      scorePercent: null,
      passed: null,
      correct: 1,
      total: 3,
      pendingPoints: 2,
      submittedAt: null,
      reviewStatus: 'pending',
      provisionalPercent: 100,
      feedback: null,
      reviewedAt: null,
    };
    expect(resultKind(base)).toBe('pending');
    expect(resultKind({ ...base, reviewStatus: 'reviewed', passed: false, scorePercent: 50 })).toBe('failed');
    expect(resultKind({ ...base, reviewStatus: null })).toBe('submitted');
  });
});

describe('sign-in failures', () => {
  it('reads the OAuth reason and the SAML error from the redirect', () => {
    expect(authFailure(new URLSearchParams('error=oauth&reason=denied'))).toEqual({ kind: 'oauth', reason: 'denied' });
    expect(authFailure(new URLSearchParams('sso_error=expired'))).toEqual({ kind: 'sso', reason: 'expired' });
    expect(authFailure(new URLSearchParams('next=/learning'))).toBeNull();
    expect(authFailure(new URLSearchParams('sso_error=logout_incomplete'))).toEqual({ kind: 'sso', reason: 'logout_incomplete' });
    expect(SSO_ERRORS).toContain('logout_incomplete');
  });
  it('follows the IdP single-logout URL after a SAML sign-out, else the sign-in page', () => {
    const idp = 'https://acme.okta.com/app/exk1/slo/saml?SAMLRequest=abc&SigAlg=x&Signature=y';
    expect(signOutRedirect({ redirectUrl: idp })).toBe(idp);
    expect(signOutRedirect(undefined)).toBeNull();
    expect(signOutRedirect({ redirectUrl: 'javascript:alert(1)' })).toBeNull();
    expect(signOutRedirect({ redirectUrl: '//evil.example' })).toBeNull();
  });
});
