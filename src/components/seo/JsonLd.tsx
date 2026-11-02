import type { Thing, WithContext } from 'schema-dts';
import { jsonLdText, schemaAllowed, schemaTypeOf } from '@/features/seo/normalize';
import { getSeo } from '@/features/seo/server';
import { currentScope } from '@/features/tenant/server';

/**
 * Structured data for rich results, filtered by the school's structured-data settings (SEO → Structured data: all off,
 * or per type). Escaped so tenant-authored text can never close or break out of the script tag
 * (https://nextjs.org/docs/app/guides/json-ld).
 */
export async function JsonLd({ data }: { data: WithContext<Thing> | WithContext<Thing>[] }) {
  const { tenant } = await currentScope();
  const seo = await getSeo(tenant);
  const nodes = (Array.isArray(data) ? data : [data]).filter((node) => {
    const type = schemaTypeOf((node as { '@type'?: unknown })['@type']);
    return type === null || schemaAllowed(seo, type);
  });
  if (nodes.length === 0) return null;
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdText(nodes.length === 1 ? nodes[0] : nodes) }} />;
}
