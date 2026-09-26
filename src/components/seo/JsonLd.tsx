import type { Thing, WithContext } from 'schema-dts';

/**
 * Structured data for rich results. `<` is escaped so tenant-authored text can never close the script tag
 * (https://nextjs.org/docs/app/guides/json-ld).
 */
export function JsonLd({ data }: { data: WithContext<Thing> | WithContext<Thing>[] }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }} />;
}
