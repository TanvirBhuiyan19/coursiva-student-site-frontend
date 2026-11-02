// The safe Markdown renderer's options for school-written fields, and the plain-text helper.
import { renderToStaticMarkup } from 'react-dom/server';
import { Markdown, markdownToPlain, parseBlocks } from './markdown';

const html = (el: React.ReactElement) => renderToStaticMarkup(el);

describe('Markdown renderer', () => {
  it('keeps the blog behaviour by default: lines join, # is an h2', () => {
    const out = html(<Markdown source={'# One\n## Two\n\nfirst\nsecond'} />);
    expect(out).toBe('<div><h2>One</h2><h3>Two</h3><p>first second</p></div>');
  });

  it('keeps single newlines as line breaks with `breaks` (plain text typed in a textarea)', () => {
    expect(html(<Markdown breaks source={'Line one\nLine two\n\nNext para'} />)).toBe(
      '<div><p>Line one<br/>Line two</p><p>Next para</p></div>',
    );
    expect(html(<Markdown breaks source={'> quoted\n> on two lines'} />)).toContain('<blockquote>quoted<br/>on two lines</blockquote>');
    // A lazy continuation line stays in the list item.
    expect(html(<Markdown breaks source={'- item\ncontinued\n- next'} />)).toContain('<ul><li>item<br/>continued</li><li>next</li></ul>');
    expect(parseBlocks('- item\ncontinued')).toEqual([
      { kind: 'ul', items: ['item'] },
      { kind: 'p', text: 'continued' },
    ]);
  });

  it('maps the top heading to `headingLevel` and keeps the others relative', () => {
    expect(html(<Markdown headingLevel={3} source={'## Steps\n\n### Detail'} />)).toBe('<div><h3>Steps</h3><h4>Detail</h4></div>');
    expect(html(<Markdown headingLevel={2} source={'### Only'} />)).toBe('<div><h2>Only</h2></div>');
    expect(html(<Markdown headingLevel={6} source={'# a\n\n## b'} />)).toBe('<div><h6>a</h6><h6>b</h6></div>');
  });

  it('shows the alt text instead of an image when images are off', () => {
    const src = '![Diagram](https://media.example.com/d.png)';
    expect(html(<Markdown source={src} />)).toContain('<img src="https://media.example.com/d.png" alt="Diagram"');
    expect(html(<Markdown source={src} images={false} />)).toBe('<div><p>Diagram</p></div>');
  });

  it('renders what the dashboard editor emits, including nested emphasis and link titles', () => {
    expect(html(<Markdown source={'***both*** and **bold *it* here** and *it **b** it*'} />)).toBe(
      '<div><p><strong><em>both</em></strong> and <strong>bold <em>it</em> here</strong> and <em>it <strong>b</strong> it</em></p></div>',
    );
    expect(html(<Markdown source={'[Docs](https://example.com/d "The docs")'} />)).toContain(
      '<a href="https://example.com/d" rel="noopener noreferrer nofollow ugc">Docs</a>',
    );
    expect(html(<Markdown source={'1. one\n2. two\n\n---\n\n`code`'} />)).toBe(
      '<div><ol><li>one</li><li>two</li></ol><hr/><p><code>code</code></p></div>',
    );
  });

  it('leaves plain-text stars alone (CommonMark flanking)', () => {
    expect(html(<Markdown source={'2 * 3 * 4 = 24'} />)).toBe('<div><p>2 * 3 * 4 = 24</p></div>');
  });

  it('stays safe: no script URLs, no raw HTML', () => {
    const out = html(<Markdown breaks source={'<script>alert(1)</script>\n[x](javascript:alert(1)) ![y](javascript:1)'} />);
    expect(out).not.toContain('<script');
    expect(out).toContain('&lt;script&gt;');
    expect(out).not.toContain('javascript:');
  });
});

// The dashboard editor (Lexical) saves literal punctuation with CommonMark backslash escapes.
describe('backslash escapes', () => {
  it('shows escaped punctuation literally and never as formatting', () => {
    expect(html(<Markdown source={'5\\*3 = 15, \\*not italic\\*, \\*\\*not bold\\*\\*'} />)).toBe(
      '<div><p>5*3 = 15, *not italic*, **not bold**</p></div>',
    );
    expect(html(<Markdown source={'a \\`tick\\` \\~ \\_x\\_ \\\\ {first_name} snake_case \\[x\\](https://e.com)'} />)).toBe(
      '<div><p>a `tick` ~ _x_ \\ {first_name} snake_case [x](https://e.com)</p></div>',
    );
    // An escaped backslash doesn't escape what follows: the stars still format.
    expect(html(<Markdown source={'\\\\*it*'} />)).toBe('<div><p>\\<em>it</em></p></div>');
    // A backslash before a letter is not an escape.
    expect(html(<Markdown source={'C:\\Users'} />)).toBe('<div><p>C:\\Users</p></div>');
  });

  it('keeps block markers literal when escaped', () => {
    expect(html(<Markdown source={'\\# not a heading\n\n\\- not a list\n\n1\\. not a list\n\n\\> not a quote\n\n\\-\\-\\-'} />)).toBe(
      '<div><p># not a heading</p><p>- not a list</p><p>1. not a list</p><p>&gt; not a quote</p><p>---</p></div>',
    );
  });

  it('works inside formatting, links and images, and leaves code alone', () => {
    expect(html(<Markdown source={'**a\\*b** [x\\]y](https://e.com/a\\_b) ![p\\*q](https://e.com/i.png)'} />)).toBe(
      '<div><p><strong>a*b</strong> <a href="https://e.com/a_b" rel="noopener noreferrer nofollow ugc">x]y</a> <img src="https://e.com/i.png" alt="p*q" loading="lazy"/></p></div>',
    );
    expect(html(<Markdown source={'`a\\*b`'} />)).toBe('<div><p><code>a\\*b</code></p></div>');
  });

  it('treats a backslash at the end of a paragraph line as a hard break', () => {
    expect(html(<Markdown source={'one\\\ntwo'} />)).toBe('<div><p>one<br/>two</p></div>');
    expect(html(<Markdown breaks source={'one\\\ntwo'} />)).toBe('<div><p>one<br/>two</p></div>');
    expect(html(<Markdown source={'one\\\\\ntwo'} />)).toBe('<div><p>one\\ two</p></div>');
  });

  it('cannot be faked with private-use characters in the source', () => {
    expect(html(<Markdown source={'\ue02a\ue02aplain'} />)).toBe('<div><p>\ufffd\ufffdplain</p></div>');
  });

  it('resolves escapes in the plain-text helper', () => {
    expect(markdownToPlain('5\\*3 and **bold \\*star\\*** \\_x\\_ `c\\*d`')).toBe('5*3 and bold *star* _x_ c\\*d');
    expect(markdownToPlain('\\# Title\n\n\\- item')).toBe('# Title\n- item');
  });
});

describe('markdownToPlain', () => {
  it('drops the markers and keeps the words', () => {
    expect(
      markdownToPlain(
        '## Launch kit\n\nFifty **proven** *emails* and `templates` — see [the guide](https://example.com).\n\n- one\n- two\n\n---\n\n> quote\n\n![Cover](https://x.example/c.png)',
      ),
    ).toBe('Launch kit\nFifty proven emails and templates — see the guide.\none\ntwo\nquote\nCover');
  });

  it('returns plain text unchanged (older values) and empty for empty', () => {
    expect(markdownToPlain('Templates for your launch')).toBe('Templates for your launch');
    expect(markdownToPlain('Line one\nLine two')).toBe('Line one\nLine two');
    expect(markdownToPlain('2 * 3 * 4')).toBe('2 * 3 * 4');
    expect(markdownToPlain('')).toBe('');
    expect(markdownToPlain('***both*** [**b**](javascript:x)')).toBe('both b');
  });
});
