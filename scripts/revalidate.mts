/**
 * Dev helper: purge cached tenant data after editing the mock seed, exactly as Laravel would.
 *   npm run revalidate            → every seeded tenant
 *   npm run revalidate -- t:amplify:catalog
 */
import { createHmac } from 'node:crypto';

const secret = process.env.REVALIDATE_SECRET ?? 'dev-revalidate-secret';
const base = process.env.SITE_URL ?? 'http://localhost:3000';
const tags = process.argv.slice(2).length ? process.argv.slice(2) : ['t:amplify', 't:northwind'];
const body = JSON.stringify({ tags });
const sig = createHmac('sha256', secret).update(body).digest('hex');

const res = await fetch(`${base}/hooks/revalidate`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Coursiva-Signature': `sha256=${sig}` },
  body,
});
console.log(res.status, await res.text());
