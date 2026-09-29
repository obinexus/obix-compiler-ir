/**
 * Source provenance: where in the source each part of an IR came from — kept in a SEPARATE document, never inside the IR. The IR is what a component MEANS and is the same
 * whatever source produced it; provenance is what the compiler knew about where it read it, and it differs (and may be absent) without the meaning changing. So an IR has no
 * place for a location, and two IRs that mean the same are equal whatever their provenance.
 *
 * The document is keyed by the `id` of the nodes of the IR, so a later stage that keeps an id keeps its origin. It carries no syntax tree of any frontend: a range, the name and
 * version of the frontend that read the source, the file, and every import the source made exactly as it wrote it — `from "obix"` included, which nothing resolves here.
 */
import type { SourceRange } from "obix-compiler-diagnostics";
import { isPlainRecord } from "./check.js";
import { OBIX_IR_PROVENANCE_SCHEMA } from "./vocabulary.js";
import { canonical, deepFreeze } from "./serialize.js";
import type { ObixIrComponent } from "./types.js";

export interface ObixIrImportRecord {
  /** The specifier exactly as the source wrote it. */
  readonly specifier: string;
  /** The imported name: `default` for a default import, `*` for a namespace import. */
  readonly imported: string;
  readonly local: string;
  readonly isType: boolean;
}

export interface ObixIrProvenance {
  readonly schema: "obix-dop-ir-provenance/1";
  /** The syntax frontend that read the source — a name and a version, as data. */
  readonly frontend: { readonly name: string; readonly version: string };
  readonly file: string;
  /** Node id → where the node was read, file-absolute. */
  readonly origins: Readonly<Record<string, SourceRange>>;
  readonly imports: readonly ObixIrImportRecord[];
}

type Rec = Readonly<Record<string, unknown>>;
const NOT_PROVENANCE = "provenance must be a plain object";
const present = (record: Rec, key: string): boolean => record[key] !== undefined;
const isNonEmptyString = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const isInteger = (value: unknown, minimum: number): boolean => typeof value === "number" && Number.isInteger(value) && value >= minimum;

function extras(record: Rec, known: readonly string[], noun: string, prefix: string, out: string[]): void {
  for (const key of Object.keys(record)) if (!known.includes(key)) out.push(`${prefix}${key}: is not a member of ${noun}`);
}

function checkPosition(value: unknown, path: string, out: string[]): boolean {
  if (!isPlainRecord(value)) {
    out.push(`${path}: must be a position`);
    return false;
  }
  const before = out.length;
  if (!isInteger(value.line, 1)) out.push(`${path}.line: must be an integer >= 1`);
  if (!isInteger(value.column, 1)) out.push(`${path}.column: must be an integer >= 1`);
  if (!isInteger(value.offset, 0)) out.push(`${path}.offset: must be an integer >= 0`);
  extras(value, ["line", "column", "offset"], "a position", `${path}.`, out);
  return out.length === before;
}

function checkRange(value: unknown, path: string, out: string[]): void {
  if (!isPlainRecord(value)) {
    out.push(`${path}: must be a range`);
    return;
  }
  const startOk = checkPosition(value.start, `${path}.start`, out);
  const endOk = checkPosition(value.end, `${path}.end`, out);
  if (startOk && endOk && (value.start as { offset: number }).offset > (value.end as { offset: number }).offset) out.push(`${path}: start must not lie after end`);
  extras(value, ["start", "end"], "a range", `${path}.`, out);
}

/** The ids of every node of an IR that can be pointed at: everything that has an `id`. */
function idsOf(ir: unknown, into = new Set<string>(), seen = new Set<object>()): Set<string> {
  if (typeof ir !== "object" || ir === null || seen.has(ir)) return into;
  seen.add(ir);
  if (Array.isArray(ir)) ir.forEach((entry) => idsOf(entry, into, seen));
  else {
    const record = ir as Rec;
    if (typeof record.id === "string") into.add(record.id);
    Object.values(record).forEach((entry) => idsOf(entry, into, seen));
  }
  return into;
}

/**
 * The problems of a provenance record; `[]` when it is one. Given the IR it accompanies, every origin must be keyed by the id of one of that IR's nodes — the other direction, that
 * every node has an origin, is for the lowering that made both to say.
 */
export function checkIrProvenance(value: unknown, ir?: ObixIrComponent): readonly string[] {
  if (!isPlainRecord(value)) return [NOT_PROVENANCE];
  const out: string[] = [];
  for (const key of ["schema", "frontend", "file", "origins", "imports"]) if (!present(value, key)) out.push(`${key}: is required`);
  if (present(value, "schema") && value.schema !== OBIX_IR_PROVENANCE_SCHEMA) out.push(`schema: must be ${OBIX_IR_PROVENANCE_SCHEMA}`);
  if (present(value, "frontend")) {
    const frontend = value.frontend;
    if (!isPlainRecord(frontend)) out.push("frontend: must be an object");
    else {
      for (const key of ["name", "version"]) {
        if (!present(frontend, key)) out.push(`frontend.${key}: is required`);
        else if (!isNonEmptyString(frontend[key])) out.push(`frontend.${key}: must be a non-empty string`);
      }
      extras(frontend, ["name", "version"], "a frontend", "frontend.", out);
    }
  }
  if (present(value, "file") && !isNonEmptyString(value.file)) out.push("file: must be a non-empty string");
  if (present(value, "origins")) {
    const origins = value.origins;
    if (!isPlainRecord(origins)) out.push("origins: must be an object");
    else {
      const ids = ir === undefined ? null : idsOf(ir);
      for (const [id, range] of Object.entries(origins)) {
        if (id === "") out.push("origins.: an origin is keyed by the id of a node");
        else if (ids !== null && !ids.has(id)) out.push(`origins.${id}: is not the id of a node of the IR`);
        checkRange(range, `origins.${id}`, out);
      }
    }
  }
  if (present(value, "imports")) {
    if (!Array.isArray(value.imports)) out.push("imports: must be an array");
    else {
      value.imports.forEach((entry: unknown, i) => {
        const path = `imports[${i}]`;
        if (!isPlainRecord(entry)) {
          out.push(`${path}: must be an import object`);
          return;
        }
        for (const key of ["specifier", "imported", "local", "isType"]) if (!present(entry, key)) out.push(`${path}.${key}: is required`);
        for (const key of ["specifier", "imported", "local"]) if (present(entry, key) && !isNonEmptyString(entry[key])) out.push(`${path}.${key}: must be a non-empty string`);
        if (present(entry, "isType") && typeof entry.isType !== "boolean") out.push(`${path}.isType: must be a boolean`);
        extras(entry, ["specifier", "imported", "local", "isType"], "an import", `${path}.`, out);
      });
    }
  }
  extras(value, ["schema", "frontend", "file", "origins", "imports"], "provenance", "", out);
  return out;
}

/** The canonical text of a provenance record: keys sorted at every level, no whitespace. */
export function serializeIrProvenance(provenance: ObixIrProvenance): string {
  const problems = checkIrProvenance(provenance);
  if (problems.length > 0) throw new TypeError(`cannot serialize invalid provenance: ${problems[0]}`);
  return canonical(provenance);
}

/** Read what `serializeIrProvenance` wrote: the record, deep-frozen. */
export function parseIrProvenance(text: string): ObixIrProvenance {
  if (typeof text !== "string") throw new TypeError(`parseIrProvenance: the text must be a string, received ${typeof text}`);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new TypeError(`parseIrProvenance: the text is not JSON: ${(error as Error).message}`);
  }
  const problems = checkIrProvenance(value);
  if (problems.length > 0) throw new TypeError(`invalid provenance: ${problems[0]}`);
  return deepFreeze(value as ObixIrProvenance);
}
