// Merges a JSON fragment into messages/en.json: `node scripts/add-messages.mjs <fragment.json>`.
import fs from 'node:fs';

const [, , fragmentPath] = process.argv;
if (!fragmentPath) throw new Error('Usage: node scripts/add-messages.mjs <fragment.json>');
const target = 'messages/en.json';
const messages = JSON.parse(fs.readFileSync(target, 'utf8'));
const fragment = JSON.parse(fs.readFileSync(fragmentPath, 'utf8'));

const merge = (a, b) => {
  for (const [k, v] of Object.entries(b))
    a[k] = v && typeof v === 'object' && !Array.isArray(v) && typeof a[k] === 'object' ? merge(a[k], v) : v;
  return a;
};
fs.writeFileSync(target, `${JSON.stringify(merge(messages, fragment), null, 2)}\n`);
console.log(`merged ${Object.keys(fragment).join(', ')}`);
