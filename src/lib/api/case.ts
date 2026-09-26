/**
 * snake_case on the wire, camelCase in code. The conversion happens only here (used by the server and browser API
 * clients, and by the mock API). Never put data values in object keys — they would be converted too.
 */

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

const toCamel = (s: string) => s.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
const toSnake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

function convert(value: unknown, key: (k: string) => string): unknown {
  if (Array.isArray(value)) return value.map((v) => convert(v, key));
  if (value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [key(k), convert(v, key)]));
  }
  return value;
}

export const camelize = <T>(value: unknown): T => convert(value, toCamel) as T;
export const snakeize = (value: unknown): Json => convert(value, toSnake) as Json;
