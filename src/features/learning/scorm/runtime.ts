/**
 * The SCORM run-time API the player exposes to a package (docs/scorm.md, "What the student site must implement"):
 * `window.API` for SCORM 1.2 and `window.API_1484_11` for SCORM 2004, both backed by one data-model store.
 *
 * - `GetValue` reads the `cmi` map from `GET /me/lessons/{id}/scorm` (saved elements + LMS-owned values); `_count` is
 *   derived from the stored `cmi.interactions.n.*` / `cmi.objectives.n.*` keys, `_children` from the standard lists.
 * - `SetValue` validates (read-only, write-only, unknown elements → the standard error codes) and buffers the change.
 * - `Commit` sends only the changed elements (`onCommit`, ≤ 500 per request); `Finish`/`Terminate` does the same with
 *   `finish: true`. The API owns status, score and completion: nothing is graded here.
 *
 * Pure TypeScript — no DOM, no fetch — so it is unit-tested directly.
 */

export type ScormVersion = '1.2' | '2004';
export type CommitFn = (changes: Record<string, string>, finish: boolean) => void;

/** Laravel validates element names with this pattern; anything else is an unknown element. */
const ELEMENT = /^cmi\.[A-Za-z0-9_.]{1,250}$/;
export const MAX_PER_COMMIT = 500;

const READ_ONLY_12 = new Set([
  'cmi.core.student_id',
  'cmi.core.student_name',
  'cmi.core.credit',
  'cmi.core.entry',
  'cmi.core.total_time',
  'cmi.core.lesson_mode',
  'cmi.launch_data',
  'cmi.comments_from_lms',
  'cmi.student_data.mastery_score',
  'cmi.student_data.max_time_allowed',
  'cmi.student_data.time_limit_action',
]);
const WRITE_ONLY_12 = new Set(['cmi.core.exit', 'cmi.core.session_time']);

const READ_ONLY_2004 = new Set([
  'cmi._version',
  'cmi.learner_id',
  'cmi.learner_name',
  'cmi.credit',
  'cmi.entry',
  'cmi.mode',
  'cmi.total_time',
  'cmi.launch_data',
  'cmi.scaled_passing_score',
  'cmi.completion_threshold',
  'cmi.max_time_allowed',
  'cmi.time_limit_action',
]);
const WRITE_ONLY_2004 = new Set(['cmi.exit', 'cmi.session_time']);

const CHILDREN: Record<string, string> = {
  'cmi.core._children': 'student_id,student_name,lesson_location,credit,lesson_status,entry,score,total_time,lesson_mode,exit,session_time',
  'cmi.core.score._children': 'raw,min,max',
  'cmi.objectives._children': 'id,score,status',
  'cmi.student_data._children': 'mastery_score,max_time_allowed,time_limit_action',
  'cmi.student_preference._children': 'audio,language,speed,text',
  'cmi.interactions._children': 'id,objectives,time,type,correct_responses,weighting,student_response,result,latency',
  'cmi.score._children': 'scaled,raw,min,max',
  'cmi.learner_preference._children': 'audio_level,language,delivery_speed,audio_captioning',
};
const CHILDREN_2004: Record<string, string> = {
  'cmi.objectives._children': 'id,score,success_status,completion_status,progress_measure,description',
  'cmi.interactions._children': 'id,type,objectives,timestamp,correct_responses,weighting,learner_response,result,latency,description',
};

const ERRORS_12: Record<string, string> = {
  '0': 'No error',
  '101': 'General exception',
  '201': 'Invalid argument error',
  '202': 'Element cannot have children',
  '203': 'Element not an array - cannot have count',
  '301': 'Not initialized',
  '401': 'Not implemented error',
  '402': 'Invalid set value, element is a keyword',
  '403': 'Element is read only',
  '404': 'Element is write only',
  '405': 'Incorrect data type',
};
const ERRORS_2004: Record<string, string> = {
  '0': 'No error',
  '101': 'General exception',
  '102': 'General initialization failure',
  '103': 'Already initialized',
  '104': 'Content instance terminated',
  '111': 'General termination failure',
  '112': 'Termination before initialization',
  '113': 'Termination after termination',
  '122': 'Retrieve data before initialization',
  '123': 'Retrieve data after termination',
  '132': 'Store data before initialization',
  '133': 'Store data after termination',
  '142': 'Commit before initialization',
  '143': 'Commit after termination',
  '201': 'General argument error',
  '301': 'General get failure',
  '351': 'General set failure',
  '391': 'General commit failure',
  '401': 'Undefined data model element',
  '402': 'Unimplemented data model element',
  '403': 'Data model element value not initialized',
  '404': 'Data model element is read only',
  '405': 'Data model element is write only',
  '406': 'Data model element type mismatch',
  '407': 'Data model element value out of range',
};

type State = 'idle' | 'running' | 'terminated';

export class ScormDataModel {
  private readonly values: Map<string, string>;
  private readonly dirty = new Map<string, string>();
  private state: State = 'idle';
  private error = '0';

  constructor(
    readonly version: ScormVersion,
    cmi: Record<string, string>,
    private readonly onCommit: CommitFn,
  ) {
    this.values = new Map(Object.entries(cmi));
  }

  get initialized() {
    return this.state === 'running';
  }
  get terminated() {
    return this.state === 'terminated';
  }
  get pending() {
    return this.dirty.size > 0;
  }

  private ok<T>(v: T): T {
    this.error = '0';
    return v;
  }
  private fail<T>(code12: string, code2004: string, v: T): T {
    this.error = this.version === '1.2' ? code12 : code2004;
    return v;
  }

  initialize(): 'true' | 'false' {
    if (this.state === 'running') return this.fail('101', '103', 'false');
    if (this.state === 'terminated') return this.fail('101', '104', 'false');
    this.state = 'running';
    return this.ok('true');
  }

  /** LMSFinish / Terminate: commits what changed with `finish: true` (adds session_time to the total). */
  terminate(): 'true' | 'false' {
    if (this.state === 'idle') return this.fail('301', '112', 'false');
    if (this.state === 'terminated') return this.fail('101', '113', 'false');
    this.flush(true);
    this.state = 'terminated';
    return this.ok('true');
  }

  commit(): 'true' | 'false' {
    if (this.state === 'idle') return this.fail('301', '142', 'false');
    if (this.state === 'terminated') return this.fail('101', '143', 'false');
    this.flush(false);
    return this.ok('true');
  }

  /** Sends the buffered changes, in chunks the API accepts. Also used by the periodic and `pagehide` commits. */
  flush(finish: boolean) {
    const entries = [...this.dirty];
    this.dirty.clear();
    if (entries.length === 0) {
      if (finish) this.onCommit({}, true);
      return;
    }
    for (let i = 0; i < entries.length; i += MAX_PER_COMMIT) {
      const last = i + MAX_PER_COMMIT >= entries.length;
      this.onCommit(Object.fromEntries(entries.slice(i, i + MAX_PER_COMMIT)), finish && last);
    }
  }

  private count(prefix: string): number {
    const re = new RegExp(`^${prefix.replace(/\./g, '\\.')}\\.(\\d+)\\.`);
    let n = 0;
    for (const k of this.values.keys()) {
      const m = re.exec(k);
      if (m) n = Math.max(n, Number(m[1]) + 1);
    }
    return n;
  }

  getValue(element: string): string {
    if (this.state === 'idle') return this.fail('301', '122', '');
    if (this.state === 'terminated') return this.fail('101', '123', '');
    if (typeof element !== 'string' || element === '') return this.fail('201', '301', '');
    if (element.endsWith('._children')) {
      const v = (this.version === '2004' ? CHILDREN_2004[element] : undefined) ?? CHILDREN[element];
      return v === undefined ? this.fail('202', '301', '') : this.ok(v);
    }
    if (element.endsWith('._count')) {
      const base = element.slice(0, -'._count'.length);
      if (!/(^cmi\.(interactions|objectives|comments_from_learner|comments_from_lms)$)|(\.(objectives|correct_responses)$)/.test(base))
        return this.fail('203', '301', '');
      return this.ok(String(this.count(base)));
    }
    if (element === 'cmi._version' && this.version === '2004') return this.ok(this.values.get(element) ?? '1.0');
    if (!ELEMENT.test(element)) return this.fail('201', '401', '');
    const writeOnly = this.version === '1.2' ? WRITE_ONLY_12 : WRITE_ONLY_2004;
    if (writeOnly.has(element) || (this.version === '1.2' && /^cmi\.interactions\.\d+\./.test(element))) return this.fail('404', '405', '');
    const v = this.values.get(element);
    // SCORM 2004 reports an element nobody set yet; 1.2 just returns "".
    if (v === undefined) return this.version === '2004' ? this.fail('0', '403', '') : this.ok('');
    return this.ok(v);
  }

  setValue(element: string, value: unknown): 'true' | 'false' {
    if (this.state === 'idle') return this.fail('301', '132', 'false');
    if (this.state === 'terminated') return this.fail('101', '133', 'false');
    if (typeof element !== 'string' || element === '') return this.fail('201', '351', 'false');
    if (element.endsWith('._children') || element.endsWith('._count') || element === 'cmi._version')
      return this.fail('402', '404', 'false');
    if (!ELEMENT.test(element)) return this.fail('201', '401', 'false');
    const readOnly = this.version === '1.2' ? READ_ONLY_12 : READ_ONLY_2004;
    if (readOnly.has(element) || element.startsWith('cmi.comments_from_lms')) return this.fail('403', '404', 'false');
    const v = typeof value === 'string' ? value : typeof value === 'number' || typeof value === 'boolean' ? String(value) : null;
    if (v === null || v.length > 64_000) return this.fail('405', '406', 'false');
    this.values.set(element, v);
    this.dirty.set(element, v);
    return this.ok('true');
  }

  lastError(): string {
    return this.error;
  }
  errorString(code: unknown): string {
    return (this.version === '1.2' ? ERRORS_12 : ERRORS_2004)[String(code)] ?? '';
  }
  diagnostic(code: unknown): string {
    return this.errorString(code === '' || code === undefined ? this.error : code);
  }
}

/** The object a SCORM 1.2 package looks up as `window.API`. */
export function scorm12Api(m: ScormDataModel) {
  return {
    LMSInitialize: (_param?: string) => m.initialize(),
    LMSFinish: (_param?: string) => m.terminate(),
    LMSGetValue: (el: string) => m.getValue(el),
    LMSSetValue: (el: string, v: unknown) => m.setValue(el, v),
    LMSCommit: (_param?: string) => m.commit(),
    LMSGetLastError: () => m.lastError(),
    LMSGetErrorString: (code: unknown) => m.errorString(code),
    LMSGetDiagnostic: (code: unknown) => m.diagnostic(code),
  };
}

/** The object a SCORM 2004 package looks up as `window.API_1484_11`. */
export function scorm2004Api(m: ScormDataModel) {
  return {
    Initialize: (_param?: string) => m.initialize(),
    Terminate: (_param?: string) => m.terminate(),
    GetValue: (el: string) => m.getValue(el),
    SetValue: (el: string, v: unknown) => m.setValue(el, v),
    Commit: (_param?: string) => m.commit(),
    GetLastError: () => m.lastError(),
    GetErrorString: (code: unknown) => m.errorString(code),
    GetDiagnostic: (code: unknown) => m.diagnostic(code),
  };
}
