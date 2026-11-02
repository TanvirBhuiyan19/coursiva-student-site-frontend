import { createElement } from 'react';
import { reactProps, type HeadElement } from '@/lib/headCode';

/**
 * The passive part of the school's own `<head>` code (verification `<meta>` tags, inert links, plain styles), rendered
 * on every page of its site. Scripts and anything else that could set a cookie or contact another server wait for
 * the visitor's consent in the browser instead (`ConsentScripts`, docs/consent.md). The layout splits the code with
 * `partitionHeadCode` (the API sends `null` on previews and when empty).
 */
export function HeadCode({ elements }: { elements: HeadElement[] }) {
  return elements.map((el, i) => {
    const props = { key: `head-code-${i}`, ...reactProps(el.attrs) };
    if (el.tag === 'meta' || el.tag === 'link') return createElement(el.tag, props);
    return createElement(el.tag, { ...props, dangerouslySetInnerHTML: { __html: el.content } });
  });
}
