/**
 * Deterministic serialization and equality of the canonical IR.
 *
 * The canonical text of an IR is JSON with the keys of every object in sorted order and no whitespace: the same IR is the same bytes whatever order its keys were created in and
 * whichever frontend made it, so two IRs are equal exactly when their texts are. Nothing that is not valid is written (a text of a wrong IR would only say the wrong thing
 * reliably), and what is read back is checked and frozen.
 */
import { checkIr, isPlainRecord } from "./check.js";
import type { ObixIrComponent, ObixIrDifference } from "./types.js";

/** JSON text of plain data with the keys of every object sorted. A member whose value is `undefined` is not there, as in JSON. */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Readonly<Record<string, unknown>>;
  const keys = Object.keys(record).filter((key) => record[key] !== undefined).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
}

/**
 * Freeze an object and everything reachable from it that is plain data — through an object that is frozen already, too: what is reachable ends up frozen, however much of it was.
 * Each object is visited once, so a value that is shared, or that contains itself, is no trouble.
 */
export function deepFreeze<T>(value: T, seen: WeakSet<object> = new WeakSet()): T {
  if (typeof value === "object" && value !== null && !seen.has(value)) {
    seen.add(value);
    Object.freeze(value);
    for (const member of Object.values(value)) deepFreeze(member, seen);
  }
  return value;
}

/** The canonical text of an IR. Throws a `TypeError` naming the first problem when the value is not a valid IR. */
export function serializeIr(ir: ObixIrComponent): string {
  const problems = checkIr(ir);
  if (problems.length > 0) throw new TypeError(`cannot serialize an invalid IR: ${problems[0]}`);
  return canonical(ir);
}

/** Read the text of an IR: the component, checked and deep-frozen. Throws a `TypeError` when the text is not JSON or the JSON is not a valid IR. */
export function parseIr(text: string): ObixIrComponent {
  if (typeof text !== "string") throw new TypeError(`parseIr: the text must be a string, received ${typeof text}`);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new TypeError(`parseIr: the text is not JSON: ${(error as Error).message}`);
  }
  const problems = checkIr(value);
  if (problems.length > 0) throw new TypeError(`invalid IR: ${problems[0]}`);
  return deepFreeze(value as ObixIrComponent);
}

/** True when the two IRs have the same canonical text. Throws a `TypeError` when either is not a valid IR. */
export function irEqual(a: ObixIrComponent, b: ObixIrComponent): boolean {
  return serializeIr(a) === serializeIr(b);
}

function walk(a: unknown, b: unknown, path: string, out: ObixIrDifference[]): void {
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) walk(a[i], b[i], `${path}[${i}]`, out);
    return;
  }
  if (isPlainRecord(a) && isPlainRecord(b)) {
    for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) walk(a[key], b[key], path === "" ? key : `${path}.${key}`, out);
    return;
  }
  if (!Object.is(a, b)) out.push({ path, a, b });
}

/** Every place where two plain-data values differ, in the order of their sorted keys; `[]` when they are the same data. The values need not be valid IR. */
export function irDifferences(a: unknown, b: unknown): readonly ObixIrDifference[] {
  const out: ObixIrDifference[] = [];
  walk(a, b, "", out);
  return out;
}
