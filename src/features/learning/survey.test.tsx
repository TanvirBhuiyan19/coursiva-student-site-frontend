// @vitest-environment jsdom
// Survey lessons in the player (docs/api/learning.md → Survey lessons): one input per question type, client checks
// that mirror the API, the API's 422 mapped onto questions by index, the answers summary after sending, editing when
// re-submitting is on, and a 409 (answered elsewhere) showing the stored answers.
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../../messages/en.json';
import { ApiError } from '@/lib/api/errors';
import { learningKeys } from './api';
import SurveyPanel from './components/SurveyPanel';
import { draftFromResponse, surveyInput, validateSurvey } from './survey';
import type { Lesson, PlayerCourse, SurveyBlock, SurveyField } from './types';

const post = vi.fn();
const get = vi.fn();
vi.mock('@/lib/api/client', () => ({ api: { post: (...a: unknown[]) => post(...a), get: (...a: unknown[]) => get(...a) } }));
vi.mock('@/features/auth/api', () => ({ useSession: () => ({ user: null, isSignedIn: true }) }));
const toast = vi.fn();
vi.mock('@/components/toast/Toaster', () => ({ useToast: () => toast }));

const field = (key: string, type: SurveyField['type'], required = false, options: string[] = []): SurveyField => ({
  key,
  label: `Q ${key}`,
  required,
  type,
  options,
});
const FIELDS: SurveyField[] = [
  field('rating', 'rating', true),
  field('story', 'long_text'),
  field('pace', 'choice', false, ['Too slow', 'Just right']),
  field('recommend', 'checkbox'),
  field('hours', 'number'),
  field('name', 'text'),
  field('work', 'email'),
  field('phone', 'phone'),
];
const survey = (over: Partial<SurveyBlock> = {}): SurveyBlock => ({
  formId: 'frm_1',
  title: 'Course feedback',
  fields: FIELDS,
  allowResubmit: false,
  canSubmit: true,
  response: null,
  ...over,
});
const lessonWith = (s: SurveyBlock): Lesson =>
  ({
    id: 'l1',
    courseSlug: 'lab',
    completed: false,
    completion: { rule: 'survey', value: null, progress: null, done: false },
    survey: s,
  }) as Lesson;
const course = { slug: 'lab', modules: [{ id: 'm1', title: 'M', lessons: [{ id: 'l1', completed: false }] }] } as PlayerCourse;

/** The panel fed from the lesson query, like the player (so cache patches and refetches show). */
function Harness() {
  const { data } = useQuery({ queryKey: learningKeys.lesson('l1'), queryFn: () => get('/me/lessons/l1') as Promise<Lesson> });
  return data ? <SurveyPanel lesson={data} /> : null;
}

function setup(s: SurveyBlock) {
  const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false }, mutations: { retry: false } } });
  qc.setQueryData(learningKeys.lesson('l1'), lessonWith(s));
  qc.setQueryData(learningKeys.course('lab'), course);
  render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en-US" messages={messages} timeZone="UTC">
        <Harness />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return qc;
}

const send = () => fireEvent.click(screen.getByRole('button', { name: /Send answers|Update answers/ }));

beforeEach(() => {
  post.mockReset();
  get.mockReset();
  toast.mockReset();
});
afterEach(cleanup);

describe('survey panel', () => {
  it('renders one labelled input per question type, with required markers', () => {
    setup(survey());
    expect(screen.getByRole('heading', { name: 'Course feedback' })).toBeInTheDocument();
    const rating = screen.getByRole('radiogroup', { name: /Q rating/ });
    expect(rating).toHaveAttribute('aria-required', 'true');
    expect(within(rating).getAllByRole('radio')).toHaveLength(5);
    expect(within(rating).getByRole('radio', { name: '3 out of 5' })).toBeInTheDocument();
    expect(screen.getByText('(required)')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Q story' }).tagName).toBe('TEXTAREA');
    const pace = screen.getByRole('radiogroup', { name: 'Q pace' });
    expect(within(pace).getByRole('radio', { name: 'Just right' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Q recommend' })).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: 'Q hours' })).toHaveAttribute('type', 'number');
    expect(screen.getByRole('textbox', { name: 'Q name' })).toHaveAttribute('type', 'text');
    expect(screen.getByRole('textbox', { name: 'Q work' })).toHaveAttribute('type', 'email');
    expect(screen.getByRole('textbox', { name: 'Q phone' })).toHaveAttribute('type', 'tel');
  });

  it('checks required answers and formats before sending', () => {
    setup(survey());
    send();
    expect(post).not.toHaveBeenCalled();
    const rating = screen.getByRole('radiogroup', { name: /Q rating/ });
    expect(rating).toHaveAttribute('aria-invalid', 'true');
    expect(rating).toHaveAccessibleDescription(/This question needs an answer\./);
    expect(screen.getByRole('alert')).toHaveTextContent('Check the questions marked with an error.');

    fireEvent.click(screen.getByRole('radio', { name: '4 out of 5' }));
    expect(rating).not.toHaveAttribute('aria-invalid');
    fireEvent.change(screen.getByRole('textbox', { name: 'Q work' }), { target: { value: 'not-an-email' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Q phone' }), { target: { value: '12' } });
    send();
    expect(post).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Q work' })).toHaveAccessibleDescription('Enter a valid email address.');
    expect(screen.getByRole('textbox', { name: 'Q phone' })).toHaveAccessibleDescription('Enter a valid phone number.');
  });

  it('maps the API’s 422 onto the questions by index, and its form-level message', async () => {
    setup(survey());
    post.mockRejectedValueOnce(
      new ApiError(422, 'Choose one of the options.', { 'answers.2': 'Choose one of the options.', 'answers.4': 'Enter a number.' }),
    );
    fireEvent.click(screen.getByRole('radio', { name: '5 out of 5' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Too slow' }));
    send();
    await waitFor(() => expect(screen.getByRole('radiogroup', { name: 'Q pace' })).toHaveAttribute('aria-invalid', 'true'));
    expect(screen.getByRole('radiogroup', { name: 'Q pace' })).toHaveAccessibleDescription('Choose one of the options.');
    expect(screen.getByRole('spinbutton', { name: 'Q hours' })).toHaveAccessibleDescription('Enter a number.');

    post.mockRejectedValueOnce(new ApiError(422, 'Answer at least one question.', { answers: 'Answer at least one question.' }));
    send();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Answer at least one question.'));
  });

  it('sends typed answers, then shows the summary and completes the lesson', async () => {
    const qc = setup(survey());
    const response = {
      answers: [
        { key: 'rating', label: 'Q rating', type: 'rating' as const, value: 4 },
        { key: 'story', label: 'Q story', type: 'long_text' as const, value: 'Loved it' },
        { key: 'pace', label: 'Q pace', type: 'choice' as const, value: 'Just right' },
        { key: 'recommend', label: 'Q recommend', type: 'checkbox' as const, value: true },
        { key: 'hours', label: 'Q hours', type: 'number' as const, value: 3.5 },
        { key: 'name', label: 'Q name', type: 'text' as const, value: null },
      ],
      submissions: 1,
      submittedAt: '2026-10-20T12:00:00Z',
    };
    post.mockResolvedValueOnce({
      survey: survey({ canSubmit: false, response }),
      completed: true,
      progress: { completed: 1, total: 1, percent: 100 },
    });
    fireEvent.click(screen.getByRole('radio', { name: '4 out of 5' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Q story' }), { target: { value: '  Loved it ' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Just right' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Q recommend' }));
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Q hours' }), { target: { value: '3.5' } });
    send();
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Thanks — your answers are in.'));
    expect(post).toHaveBeenCalledWith('/me/lessons/l1/survey', {
      answers: [
        { key: 'rating', value: 4 },
        { key: 'story', value: 'Loved it' },
        { key: 'pace', value: 'Just right' },
        { key: 'recommend', value: true },
        { key: 'hours', value: 3.5 },
      ],
    });
    expect(toast).toHaveBeenCalledWith('Your answers to “Course feedback” were sent');
    expect(screen.getByRole('heading', { name: 'Your answers' })).toBeInTheDocument();
    expect(screen.getAllByRole('definition').map((d) => d.textContent)).toEqual([
      '4 out of 5',
      'Loved it',
      'Just right',
      'Yes',
      '3.5',
      'No answer',
    ]);
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.getByText(/^Submitted /)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit your answers' })).not.toBeInTheDocument();
    const lesson = qc.getQueryData<Lesson>(learningKeys.lesson('l1'))!;
    expect(lesson.completed).toBe(true);
    expect(lesson.completion!.done).toBe(true);
    expect(qc.getQueryData<PlayerCourse>(learningKeys.course('lab'))!.modules[0]!.lessons[0]!.completed).toBe(true);
  });

  it('lets the learner edit their answers when re-submitting is on (pre-filled), or cancel', async () => {
    const response = {
      answers: [
        { key: 'rating', label: 'Q rating', type: 'rating' as const, value: 2 },
        { key: 'hours', label: 'Q hours', type: 'number' as const, value: 6 },
        { key: 'recommend', label: 'Q recommend', type: 'checkbox' as const, value: true },
      ],
      submissions: 1,
      submittedAt: '2026-10-20T12:00:00Z',
    };
    setup(survey({ allowResubmit: true, response }));
    expect(screen.queryByRole('button', { name: /Send answers/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit your answers' }));
    expect(screen.getByRole('radio', { name: '2 out of 5' })).toBeChecked();
    expect(screen.getByRole('spinbutton', { name: 'Q hours' })).toHaveValue(6);
    expect(screen.getByRole('checkbox', { name: 'Q recommend' })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Edit your answers' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Edit your answers' }));
    fireEvent.click(screen.getByRole('radio', { name: '5 out of 5' }));
    post.mockResolvedValueOnce({
      survey: survey({
        allowResubmit: true,
        response: { ...response, answers: [{ ...response.answers[0]!, value: 5 }], submissions: 2 },
      }),
      completed: true,
      progress: { completed: 1, total: 1, percent: 100 },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Update answers' }));
    await waitFor(() => expect(screen.getByRole('definition')).toHaveTextContent('5 out of 5'));
    expect(post.mock.calls[0]![1]).toEqual({
      answers: [
        { key: 'rating', value: 5 },
        { key: 'recommend', value: true },
        { key: 'hours', value: 6 },
      ],
    });
    expect(screen.getByRole('button', { name: 'Edit your answers' })).toBeInTheDocument();
  });

  it('shows the stored answers after a 409 (answered elsewhere)', async () => {
    setup(survey());
    const stored = {
      answers: [{ key: 'rating', label: 'Q rating', type: 'rating' as const, value: 3 }],
      submissions: 1,
      submittedAt: '2026-10-20T12:00:00Z',
    };
    get.mockResolvedValue(lessonWith(survey({ canSubmit: false, response: stored })));
    post.mockRejectedValueOnce(new ApiError(409, 'You’ve already answered this survey.', {}, 'conflict'));
    fireEvent.click(screen.getByRole('radio', { name: '1 out of 5' }));
    send();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Your answers' })).toBeInTheDocument());
    expect(screen.getByRole('definition')).toHaveTextContent('3 out of 5');
    expect(get).toHaveBeenCalledWith('/me/lessons/l1');
    expect(screen.getByRole('status')).toHaveTextContent('You’ve already answered this survey.');
  });

  it('shows nothing when the learner can’t answer and hasn’t answered', () => {
    setup(survey({ canSubmit: false }));
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });
});

describe('survey answers', () => {
  it('mirrors the API’s checks', () => {
    const fields = [field('r', 'rating', true), field('t', 'text'), field('c', 'checkbox')];
    expect(validateSurvey(fields, [null, '', false]).errors.map((e) => e?.key ?? null)).toEqual(['required', null, null]);
    expect(validateSurvey([field('t', 'text')], ['x'.repeat(501)]).errors[0]).toEqual({ key: 'tooLong', max: 500 });
    expect(validateSurvey([field('t', 'text'), field('c', 'checkbox')], ['', false]).answered).toBe(false);
    expect(validateSurvey([field('n', 'number')], ['1e5']).errors[0]).toEqual({ key: 'number' });
    expect(validateSurvey([field('c', 'checkbox', true)], [false]).errors[0]).toEqual({ key: 'required' });
  });

  it('builds the body (unanswered left out) and pre-fills from a response', () => {
    const fields = [field('r', 'rating'), field('n', 'number'), field('t', 'text'), field('c', 'checkbox')];
    expect(surveyInput(fields, [null, '-2.5', '  ', false])).toEqual({
      answers: [
        { key: 'n', value: -2.5 },
        { key: 'c', value: false },
      ],
    });
    const draft = draftFromResponse(fields, {
      answers: [
        { key: 'n', label: '', type: 'number', value: 7 },
        { key: 'gone', label: '', type: 'text', value: 'x' },
      ],
      submissions: 1,
      submittedAt: '2026-10-20T12:00:00Z',
    });
    expect(draft).toEqual([null, '7', '', false]);
  });
});
