/**
 * Migration between schemas of the canonical IR, to the current one (`obix-dop-ir/3`):
 *
 *   /1 → /2   C2 (docs/recovery/vuets-compiler.md §23) added component interaction — a component's `outputs`, the `output` step, an invocation's
 *             `interactions`. A /1 document said nothing of either, and means exactly what the /2 document with none of them means.
 *   /2 → /3   C3 (§24) added the call of an intrinsic function — an expression kind a /2 document cannot contain. A /2 document means exactly what the /3
 *             document with the same content means.
 */
import { checkIr, isPlainRecord } from "./check.js";
import { deepFreeze } from "./serialize.js";
import type { ObixIrComponent } from "./types.js";
import { OBIX_IR_SCHEMA } from "./vocabulary.js";

/** Every node, with the invocations given no interaction — a copy; the document given is not changed. */
function migrateNode(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(migrateNode);
  if (!isPlainRecord(node)) return node;
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) copy[key] = migrateNode(value);
  if (node["kind"] === "invocation" && !("interactions" in node)) copy["interactions"] = [];
  return copy;
}

/** A copy, given the current schema, checked and frozen — or the first problem, said by `who`. */
function finish(who: string, migrated: Record<string, unknown>): ObixIrComponent {
  migrated["schema"] = OBIX_IR_SCHEMA;
  const problems = checkIr(migrated);
  if (problems.length > 0) throw new TypeError(`${who}: the migrated IR is not valid: ${problems[0]}`);
  return deepFreeze(migrated as unknown as ObixIrComponent);
}

/** An `obix-dop-ir/1` document as the current document that means the same: no outputs, and no interaction on any invocation. Checked and frozen. */
export function migrateIrFromV1(value: unknown): ObixIrComponent {
  if (!isPlainRecord(value) || value["schema"] !== "obix-dop-ir/1") throw new TypeError("migrateIrFromV1: not an obix-dop-ir/1 IR");
  const migrated = migrateNode(value) as Record<string, unknown>;
  migrated["outputs"] = [];
  return finish("migrateIrFromV1", migrated);
}

/** An `obix-dop-ir/2` document as the current document that means the same: the same content, the current schema. Checked and frozen. */
export function migrateIrFromV2(value: unknown): ObixIrComponent {
  if (!isPlainRecord(value) || value["schema"] !== "obix-dop-ir/2") throw new TypeError("migrateIrFromV2: not an obix-dop-ir/2 IR");
  return finish("migrateIrFromV2", migrateNode(value) as Record<string, unknown>);
}
