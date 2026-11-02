// @vitest-environment jsdom
// Quiz questions and explanations are Markdown from the dashboard's rich text editor: the player renders them formatted,
// and older plain-text questions read as before.
import { fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import messages from '../../../messages/en.json';
import { Quiz } from './components/Player';
import type { Lesson, QuizBlock, QuizResult } from './types';

const submit = vi.fn();
vi.mock('./api', () => ({
  useAskQuestion: () => ({ mutate: vi.fn(), isPending: false }),
  useLesson: () => ({}),
  usePlayerCourse: () => ({}),
  useSaveNote: () => ({ mutate: vi.fn(), isPending: false }),
  useSubmitQuiz: () => ({ mutate: submit, isPending: false }),
  useToggleComplete: () => ({ mutate: vi.fn(), isPending: false }),
  useTutor: () => ({}),
}));
vi.mock('next/dynamic', () => ({ default: () => () => null }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock('@/components/toast/Toaster', () => ({ useToast: () => vi.fn() }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
  useLocalizedRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const quiz: QuizBlock = {
  passPercent: 70,
  questions: [
    {
      id: 'q1',
      type: 'single_choice',
      prompt: 'Which stage comes **first**?\n\n- think `top`',
      points: 1,
      media: null,
      options: [
        { id: 'o0', label: 'Close' },
        { id: 'o1', label: 'Attract' },
      ],
      multiple: false,
      blankCount: 0,
      prompts: [],
      matches: [],
    },
    {
      id: 'q2',
      type: 'fill_blanks',
      prompt: 'Keep ___ between ad\nand page',
      points: 1,
      media: null,
      options: [],
      multiple: false,
      blankCount: 1,
      prompts: [],
      matches: [],
    },
  ],
  lastResult: null,
  attemptsAllowed: null,
  attemptsUsed: 0,
  timeLimitMinutes: null,
  expiresAt: null,
};

const lesson = { id: 'l1', title: 'Check', type: 'quiz', quiz } as unknown as Lesson;

const renderQuiz = () =>
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <Quiz lesson={lesson} courseSlug="funnels" onContinue={vi.fn()} />
    </NextIntlClientProvider>,
  );

describe('quiz questions as rich text', () => {
  it('renders the question Markdown, names each question group by it, and keeps plain text and blanks as typed', () => {
    renderQuiz();
    const first = screen.getByRole('group', { name: /Which stage comes first/ });
    expect(within(first).getByText('first').tagName).toBe('STRONG');
    expect(within(first).getByText('top').tagName).toBe('CODE');
    expect(first.querySelector('li')).not.toBeNull();
    const second = screen.getByRole('group', { name: /Keep ___ between ad/ });
    // An older plain-text question: its newline stays a line break, `___` shows as typed.
    expect(second.querySelector('br')).not.toBeNull();
    expect(second.textContent).toContain('Keep ___ between ad');
    expect(screen.queryByText(/\*\*/)).toBeNull();
  });

  it('lists revealed verdicts with the author’s explanation formatted', () => {
    const result: QuizResult = {
      scorePercent: 50,
      passed: false,
      correct: 1,
      total: 2,
      pendingPoints: 0,
      submittedAt: '2026-10-19T10:00:00Z',
      reviewStatus: null,
      provisionalPercent: null,
      feedback: null,
      reviewedAt: null,
      attemptNo: 1,
      attemptsLeft: null,
      results: [
        { questionId: 'q1', verdict: 'incorrect', explanation: '*Attract* comes first.' },
        { questionId: 'q2', verdict: 'correct', explanation: '' },
      ],
    };
    submit.mockImplementation((_input: unknown, opts: { onSuccess: (r: QuizResult) => void }) => opts.onSuccess(result));
    renderQuiz();
    fireEvent.click(screen.getByRole('radio', { name: 'Attract' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Blank 1' }), { target: { value: 'message match' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit answers' }));
    const answers = screen.getByText('Your answers').parentElement!;
    // One item per question (the first prompt has a list of its own).
    const items = [...answers.querySelectorAll<HTMLElement>(':scope > ol > li')];
    expect(items).toHaveLength(2);
    expect(within(items[0]!).getByText('Incorrect')).toBeInTheDocument();
    expect(within(items[0]!).getByText('Attract').tagName).toBe('EM');
    expect(within(items[0]!).getByText('first').tagName).toBe('STRONG');
    expect(within(items[1]!).getByText('Correct')).toBeInTheDocument();
  });
});
