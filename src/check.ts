/**
 * Is a value a canonical IR? `checkIr` answers with the LIST OF PROBLEMS — empty when it is — never with an exception, and never only the first: what a lowering got wrong is best
 * seen all at once. Each problem is `<path>: <what is wrong>`, the path written the way one would reach the member (`view[0].children[1].properties[0].value`).
 *
 * It checks three things. The SHAPE: every object has exactly the members of its kind, of the type the schema gives them, with no member the schema does not have — so no
 * syntax tree, location or runtime object can ride along. The NAMES: ids are unique in the whole component, and props, state, derived values, actions and dependencies share one namespace
 * of identifiers. The MEANING: a reference resolves (a local is in scope where it is written, the event payload exists only in an event handler), an assign writes a declared state,
 * an invoke calls a declared action, a constant is constant, derived values and actions are acyclic, and the accessibility attributes of an element are where they belong.
 */
import { isAccessibilityAttribute } from "./accessibility.js";
import { isIrIdentifier } from "./identifier.js";
import {
  OBIX_IR_BINARY_OPERATORS,
  OBIX_IR_EXPRESSION_KINDS,
  OBIX_IR_FUNCTION_ARITY,
  OBIX_IR_FUNCTIONS,
  OBIX_IR_LOGICAL_OPERATORS,
  OBIX_IR_NODE_KINDS,
  OBIX_IR_PROP_TYPES,
  OBIX_IR_REFERENCE_SCOPES,
  OBIX_IR_SCHEMA,
  OBIX_IR_STEP_KINDS,
  OBIX_IR_STYLE_SCOPES,
  OBIX_IR_UNARY_OPERATORS,
} from "./vocabulary.js";
import type { ObixIrFunction } from "./vocabulary.js";

type Rec = Readonly<Record<string, unknown>>;

const NOT_A_COMPONENT = "a component must be a plain object";

/** Plain data: an object whose prototype is `Object.prototype` or none — not an array, not a class instance, not a `Map`. */
export function isPlainRecord(value: unknown): value is Rec {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

const isNonEmptyString = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const isLiteralValue = (value: unknown): boolean =>
  value === null || typeof value === "boolean" || typeof value === "string" || (typeof value === "number" && Number.isFinite(value) && !Object.is(value, -0));
/** `-0`, as the IR says it: the negation of the literal 0 (not of a `-0`: a literal is never one). */
const isMinusZero = (value: Rec): boolean =>
  value.kind === "unary" && value.operator === "-" && isPlainRecord(value.operand) && value.operand.kind === "literal" && Object.is(value.operand.value, 0);
const oneOf = (table: readonly string[]): string => table.join(", ");
const present = (record: Rec, key: string): boolean => record[key] !== undefined;
const at = (path: string, key: string): string => (path === "" ? key : `${path}.${key}`);
const item = (path: string, index: number): string => `${path}[${index}]`;

/** What a check needs to know about where it is: the locals in scope, and whether it is inside an event handler. */
interface Scope {
  readonly locals: ReadonlySet<string>;
  readonly event: boolean;
}
const ROOT_SCOPE: Scope = { locals: new Set(), event: false };
const withLocals = (scope: Scope, names: readonly string[]): Scope => ({ locals: new Set([...scope.locals, ...names]), event: scope.event });
const inHandler = (scope: Scope): Scope => ({ locals: scope.locals, event: true });

/** The names a component declares, by kind — collected before anything is checked, so that a reference may name a declaration that comes later. */
interface Declared {
  readonly props: Set<string>;
  readonly state: Set<string>;
  readonly derived: Set<string>;
  readonly actions: Set<string>;
  readonly dependencies: Set<string>;
  /** channel → whether it has a payload: what an output step may tell on */
  readonly outputs: ReadonlyMap<string, boolean>;
}

function declaredNames(root: Rec): Declared {
  const names = (key: string, member: string): Set<string> => {
    const list = root[key];
    return new Set(Array.isArray(list) ? list.filter(isPlainRecord).map((entry) => entry[member]).filter(isNonEmptyString) : []);
  };
  const outputs = new Map<string, boolean>();
  for (const entry of Array.isArray(root["outputs"]) ? root["outputs"] : []) {
    if (isPlainRecord(entry) && isIrIdentifier(entry["channel"]) && !outputs.has(entry["channel"])) outputs.set(entry["channel"], entry["payload"] !== null);
  }
  return { props: names("props", "name"), state: names("state", "name"), derived: names("derived", "name"), actions: names("actions", "name"), dependencies: names("dependencies", "local"), outputs };
}

class Checker {
  readonly problems: string[] = [];
  private readonly ids = new Set<string>();
  private readonly namespace = new Set<string>();
  private readonly ancestors = new Set<object>();
  /** The derived values and the actions each derived value and action refers to, for the cycle checks. */
  private readonly derivedEdges = new Map<string, Set<string>>();
  private readonly actionEdges = new Map<string, { readonly to: string; readonly path: string }[]>();
  private currentDerived: Set<string> | null = null;
  private currentAction: { readonly to: string; readonly path: string }[] | null = null;

  constructor(private readonly declared: Declared) {}

  problem(path: string, message: string): void {
    this.problems.push(path === "" ? message : `${path}: ${message}`);
  }

  // ── the shape ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

  /** An object with exactly the members required: each is checked to be present, and any other member is reported. Returns the record, or null. */
  members(value: unknown, path: string, noun: string, required: readonly string[]): Rec | null {
    if (!isPlainRecord(value)) return null;
    for (const key of required) if (!present(value, key)) this.problem(at(path, key), "is required");
    for (const key of Object.keys(value)) if (!required.includes(key)) this.problem(at(path, key), `is not a member of ${noun}`);
    return value;
  }

  list(value: unknown, path: string): readonly unknown[] | null {
    if (Array.isArray(value)) return value;
    if (value !== undefined) this.problem(path, "must be an array");
    return null;
  }

  id(record: Rec, path: string): void {
    if (!present(record, "id")) return;
    const id = record.id;
    if (!isNonEmptyString(id)) this.problem(at(path, "id"), "must be a non-empty string");
    else if (this.ids.has(id)) this.problem(at(path, "id"), `${id} is used twice`);
    else this.ids.add(id);
  }

  nonEmptyString(record: Rec, key: string, path: string): boolean {
    if (!present(record, key)) return false;
    if (isNonEmptyString(record[key])) return true;
    this.problem(at(path, key), "must be a non-empty string");
    return false;
  }

  /** A name in the one namespace of the component. */
  declare(record: Rec, key: string, path: string): void {
    if (!present(record, key)) return;
    const name = record[key];
    if (!isIrIdentifier(name)) this.problem(at(path, key), "must be an identifier");
    else if (this.namespace.has(name)) this.problem(at(path, key), `${name} is declared twice (props, state, derived values, actions and dependencies share one namespace)`);
    else this.namespace.add(name);
  }

  /** A list of distinct identifiers: the locals a step list is given. */
  identifiers(value: unknown, path: string): string[] {
    const names: string[] = [];
    const list = this.list(value, path);
    if (!list) return names;
    list.forEach((name, i) => {
      if (!isIrIdentifier(name)) this.problem(item(path, i), "must be an identifier");
      else if (names.includes(name)) this.problem(item(path, i), `${name} is declared twice`);
      else names.push(name);
    });
    return names;
  }

  // ── expressions ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

  expression(value: unknown, path: string, scope: Scope): void {
    if (!isPlainRecord(value)) {
      this.problem(path, "must be an expression object");
      return;
    }
    if (this.ancestors.has(value)) {
      this.problem(path, "is its own ancestor — an IR is a tree");
      return;
    }
    this.ancestors.add(value);
    try {
      this.expressionOf(value, path, scope);
    } finally {
      this.ancestors.delete(value);
    }
  }

  private expressionOf(value: Rec, path: string, scope: Scope): void {
    const kind = value.kind;
    const operator = (table: readonly string[]): void => {
      if (present(value, "operator") && !table.includes(value.operator as string)) this.problem(at(path, "operator"), `must be one of ${oneOf(table)}`);
    };
    switch (kind) {
      case "literal":
        this.members(value, path, "a literal", ["kind", "value"]);
        if (present(value, "value") && !isLiteralValue(value.value)) this.problem(at(path, "value"), "must be null, a boolean, a finite number (not -0) or a string");
        return;
      case "array": {
        this.members(value, path, "an array", ["kind", "elements"]);
        this.list(value.elements, at(path, "elements"))?.forEach((element, i) => this.expression(element, item(at(path, "elements"), i), scope));
        return;
      }
      case "object": {
        this.members(value, path, "an object", ["kind", "entries"]);
        const keys = new Set<string>();
        this.list(value.entries, at(path, "entries"))?.forEach((entry, i) => {
          const where = item(at(path, "entries"), i);
          const record = this.members(entry, where, "an object entry", ["key", "value"]);
          if (!record) {
            this.problem(where, "must be an object entry");
            return;
          }
          if (present(record, "key")) {
            if (typeof record.key !== "string") this.problem(at(where, "key"), "must be a string");
            else if (keys.has(record.key)) this.problem(at(where, "key"), `${record.key} is given twice`);
            else keys.add(record.key);
          }
          if (present(record, "value")) this.expression(record.value, at(where, "value"), scope);
        });
        return;
      }
      case "reference":
        this.members(value, path, "a reference", ["kind", "scope", "name"]);
        this.reference(value, path, scope);
        return;
      case "event-payload":
        this.members(value, path, "an event payload", ["kind"]);
        if (!scope.event) this.problem(path, "the event payload exists only inside an event handler");
        return;
      case "member":
        this.members(value, path, "a member access", ["kind", "object", "property"]);
        if (present(value, "object")) this.expression(value.object, at(path, "object"), scope);
        this.nonEmptyString(value, "property", path);
        return;
      case "index":
        this.members(value, path, "an index access", ["kind", "object", "index"]);
        if (present(value, "object")) this.expression(value.object, at(path, "object"), scope);
        if (present(value, "index")) this.expression(value.index, at(path, "index"), scope);
        return;
      case "unary":
        this.members(value, path, "a unary expression", ["kind", "operator", "operand"]);
        operator(OBIX_IR_UNARY_OPERATORS);
        if (present(value, "operand")) this.expression(value.operand, at(path, "operand"), scope);
        return;
      case "binary":
      case "logical":
        this.members(value, path, kind === "binary" ? "a binary expression" : "a logical expression", ["kind", "operator", "left", "right"]);
        operator(kind === "binary" ? OBIX_IR_BINARY_OPERATORS : OBIX_IR_LOGICAL_OPERATORS);
        if (present(value, "left")) this.expression(value.left, at(path, "left"), scope);
        if (present(value, "right")) this.expression(value.right, at(path, "right"), scope);
        return;
      case "choice":
        this.members(value, path, "a choice", ["kind", "test", "consequent", "alternate"]);
        for (const key of ["test", "consequent", "alternate"]) if (present(value, key)) this.expression(value[key], at(path, key), scope);
        return;
      case "call": {
        this.members(value, path, "a call", ["kind", "function", "arguments"]);
        const fn = OBIX_IR_FUNCTIONS.includes(value.function as never) ? (value.function as ObixIrFunction) : null;
        if (present(value, "function") && fn === null) this.problem(at(path, "function"), `must be one of ${oneOf(OBIX_IR_FUNCTIONS)}`);
        const args = this.list(value.arguments, at(path, "arguments"));
        if (args === null) return;
        if (fn !== null && args.length !== OBIX_IR_FUNCTION_ARITY[fn]) {
          const arity = OBIX_IR_FUNCTION_ARITY[fn];
          this.problem(at(path, "arguments"), `${fn} takes ${arity} argument${arity === 1 ? "" : "s"}, not ${args.length}`);
        }
        args.forEach((argument, i) => this.expression(argument, item(at(path, "arguments"), i), scope));
        return;
      }
      default:
        if (!present(value, "kind")) this.problem(at(path, "kind"), "is required");
        else this.problem(at(path, "kind"), `must be one of ${oneOf(OBIX_IR_EXPRESSION_KINDS)}`);
    }
  }

  private reference(value: Rec, path: string, scope: Scope): void {
    if (present(value, "scope") && !OBIX_IR_REFERENCE_SCOPES.includes(value.scope as never)) this.problem(at(path, "scope"), `must be one of ${oneOf(OBIX_IR_REFERENCE_SCOPES)}`);
    if (present(value, "name") && !isIrIdentifier(value.name)) this.problem(at(path, "name"), "must be an identifier");
    const { scope: kind, name } = value;
    if (!isIrIdentifier(name)) return;
    switch (kind) {
      case "prop":
        if (!this.declared.props.has(name)) this.problem(path, `no prop named ${name}`);
        return;
      case "state":
        if (!this.declared.state.has(name)) this.problem(path, `no state named ${name}`);
        return;
      case "derived":
        if (!this.declared.derived.has(name)) this.problem(path, `no derived value named ${name}`);
        else this.currentDerived?.add(name);
        return;
      case "local":
        if (!scope.locals.has(name)) this.problem(path, `local ${name} is not in scope here`);
        return;
      default:
    }
  }

  /**
   * A constant: a literal, minus zero, or an array or object of constants. The problem is reported at the topmost part that is not one.
   *
   * Minus zero is the negation of the literal 0 — the only way the IR says it, since a literal is a JSON scalar and the text of `-0` is `0` (D-77) — and the only unary that is a
   * constant: what a component starts from can be `-0`, as what it computes can.
   */
  constant(value: unknown, path: string): void {
    if (!isPlainRecord(value)) return;
    if (value.kind === "array" && Array.isArray(value.elements)) {
      value.elements.forEach((element, i) => this.constant(element, item(at(path, "elements"), i)));
    } else if (value.kind === "object" && Array.isArray(value.entries)) {
      value.entries.forEach((entry, i) => {
        if (isPlainRecord(entry) && present(entry, "value")) this.constant(entry.value, at(item(at(path, "entries"), i), "value"));
      });
    } else if (value.kind !== "literal" && !isMinusZero(value) && OBIX_IR_EXPRESSION_KINDS.includes(value.kind as never)) {
      this.problem(path, "must be a constant — a literal, minus zero, or an array or object of constants");
    }
  }

  // ── steps ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

  step(value: unknown, path: string, scope: Scope): void {
    if (!isPlainRecord(value)) {
      this.problem(path, "must be a step object");
      return;
    }
    const kind = value.kind;
    if (kind === "assign") {
      const record = this.members(value, path, "an assign step", ["kind", "id", "target", "value"]);
      if (!record) return;
      this.id(record, path);
      if (present(record, "target") && !(isIrIdentifier(record.target) && this.declared.state.has(record.target))) this.problem(at(path, "target"), `${String(record.target)} is not a declared state`);
      if (present(record, "value")) this.expression(record.value, at(path, "value"), scope);
    } else if (kind === "invoke") {
      const record = this.members(value, path, "an invoke step", ["kind", "id", "action", "arguments"]);
      if (!record) return;
      this.id(record, path);
      if (present(record, "action")) {
        if (!(isIrIdentifier(record.action) && this.declared.actions.has(record.action))) this.problem(at(path, "action"), `${String(record.action)} is not a declared action`);
        else this.currentAction?.push({ to: record.action, path: at(path, "action") });
      }
      this.list(record.arguments, at(path, "arguments"))?.forEach((argument, i) => this.expression(argument, item(at(path, "arguments"), i), scope));
    } else if (kind === "output") {
      const record = this.members(value, path, "an output step", ["kind", "id", "channel", "value"]);
      if (!record) return;
      this.id(record, path);
      const channel = record.channel;
      const hasPayload = isIrIdentifier(channel) ? this.declared.outputs.get(channel) : undefined;
      if (present(record, "channel") && hasPayload === undefined) this.problem(at(path, "channel"), `${String(channel)} is not a declared output`);
      if (present(record, "value") && record.value !== null) {
        if (hasPayload === false) this.problem(at(path, "value"), `${String(channel)} has no payload: the value must be null`);
        else this.expression(record.value, at(path, "value"), scope);
      }
    } else if (!present(value, "kind")) {
      this.problem(at(path, "kind"), "is required");
    } else {
      this.problem(at(path, "kind"), `must be one of ${oneOf(OBIX_IR_STEP_KINDS)}`);
    }
  }

  steps(value: unknown, path: string, scope: Scope): void {
    this.list(value, path)?.forEach((step, i) => this.step(step, item(path, i), scope));
  }

  // ── the view ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

  nodes(value: unknown, path: string, scope: Scope): void {
    this.list(value, path)?.forEach((node, i) => this.node(node, item(path, i), scope));
  }

  node(value: unknown, path: string, scope: Scope): void {
    if (!isPlainRecord(value)) {
      this.problem(path, "must be a node object");
      return;
    }
    if (this.ancestors.has(value)) {
      this.problem(path, "is its own ancestor — an IR is a tree");
      return;
    }
    this.ancestors.add(value);
    try {
      this.nodeOf(value, path, scope);
    } finally {
      this.ancestors.delete(value);
    }
  }

  private nodeOf(value: Rec, path: string, scope: Scope): void {
    switch (value.kind) {
      case "element":
        return this.element(value, path, scope);
      case "text":
        return this.text(value, path, scope);
      case "conditional":
        return this.conditional(value, path, scope);
      case "iteration":
        return this.iteration(value, path, scope);
      case "invocation":
        return this.invocation(value, path, scope);
      case "projection":
        return this.projection(value, path, scope);
      default:
        if (!present(value, "kind")) this.problem(at(path, "kind"), "is required");
        else this.problem(at(path, "kind"), `must be one of ${oneOf(OBIX_IR_NODE_KINDS)}`);
    }
  }

  /** The attributes and bindings of an element or an invocation; `names` collects what has been given, so that nothing is given twice. */
  private attributes(value: unknown, path: string, names: Set<string>, holder: string, accessibility: boolean | null): void {
    this.list(value, path)?.forEach((entry, i) => this.attribute(entry, item(path, i), names, holder, accessibility, false, ROOT_SCOPE));
  }

  private bindings(value: unknown, path: string, names: Set<string>, holder: string, accessibility: boolean | null, scope: Scope): void {
    this.list(value, path)?.forEach((entry, i) => this.attribute(entry, item(path, i), names, holder, accessibility, true, scope));
  }

  private attribute(entry: unknown, path: string, names: Set<string>, holder: string, accessibility: boolean | null, bound: boolean, scope: Scope): void {
    const record = this.members(entry, path, bound ? "a property binding" : "an attribute", ["id", "name", "value"]);
    if (!record) {
      this.problem(path, bound ? "must be a property binding object" : "must be an attribute object");
      return;
    }
    this.id(record, path);
    if (this.nonEmptyString(record, "name", path)) {
      const name = record.name as string;
      const key = name.toLowerCase();
      if (accessibility !== null) {
        const isAccessibility = isAccessibilityAttribute(name);
        if (accessibility && !isAccessibility) this.problem(at(path, "name"), `${name} is not an accessibility attribute`);
        else if (!accessibility && isAccessibility) this.problem(at(path, "name"), `${name} is an accessibility attribute and belongs in accessibility`);
      }
      if (names.has(key)) this.problem(at(path, "name"), `${name} is given twice on this ${holder}`);
      names.add(key);
    }
    if (!present(record, "value")) return;
    if (bound) this.expression(record.value, at(path, "value"), scope);
    else if (typeof record.value !== "string") this.problem(at(path, "value"), "must be a string");
  }

  private element(value: Rec, path: string, scope: Scope): void {
    const record = this.members(value, path, "an element", ["kind", "id", "tag", "attributes", "properties", "accessibility", "events", "children"]);
    if (!record) return;
    this.id(record, path);
    this.nonEmptyString(record, "tag", path);
    const names = new Set<string>();
    this.attributes(record.attributes, at(path, "attributes"), names, "element", false);
    this.bindings(record.properties, at(path, "properties"), names, "element", false, scope);
    if (present(record, "accessibility")) {
      const where = at(path, "accessibility");
      const accessibility = this.members(record.accessibility, where, "accessibility", ["attributes", "properties"]);
      if (!accessibility) this.problem(where, "must be an accessibility object");
      else {
        this.attributes(accessibility.attributes, at(where, "attributes"), names, "element", true);
        this.bindings(accessibility.properties, at(where, "properties"), names, "element", true, scope);
      }
    }
    this.list(record.events, at(path, "events"))?.forEach((event, i) => {
      const where = item(at(path, "events"), i);
      const binding = this.members(event, where, "an event binding", ["id", "event", "steps"]);
      if (!binding) {
        this.problem(where, "must be an event binding object");
        return;
      }
      this.id(binding, where);
      this.nonEmptyString(binding, "event", where);
      this.steps(binding.steps, at(where, "steps"), inHandler(scope));
    });
    this.nodes(record.children, at(path, "children"), scope);
  }

  private text(value: Rec, path: string, scope: Scope): void {
    const record = this.members(value, path, "a text", ["kind", "id", "parts"]);
    if (!record) return;
    this.id(record, path);
    const parts = this.list(record.parts, at(path, "parts"));
    if (!parts) return;
    if (parts.length === 0) this.problem(at(path, "parts"), "must not be empty");
    parts.forEach((part, i) => {
      const where = item(at(path, "parts"), i);
      if (!isPlainRecord(part)) {
        this.problem(where, "must be a text part object");
        return;
      }
      if (part.kind === "static") {
        this.members(part, where, "a static part", ["kind", "value"]);
        if (present(part, "value") && typeof part.value !== "string") this.problem(at(where, "value"), "must be a string");
      } else if (part.kind === "display") {
        this.members(part, where, "a displayed part", ["kind", "expression"]);
        if (present(part, "expression")) this.expression(part.expression, at(where, "expression"), scope);
      } else if (!present(part, "kind")) this.problem(at(where, "kind"), "is required");
      else this.problem(at(where, "kind"), "must be one of static, display");
    });
  }

  private conditional(value: Rec, path: string, scope: Scope): void {
    const record = this.members(value, path, "a conditional", ["kind", "id", "branches", "otherwise"]);
    if (!record) return;
    this.id(record, path);
    const branches = this.list(record.branches, at(path, "branches"));
    if (branches && branches.length === 0) this.problem(at(path, "branches"), "must not be empty");
    branches?.forEach((branch, i) => {
      const where = item(at(path, "branches"), i);
      const b = this.members(branch, where, "a branch", ["id", "condition", "body"]);
      if (!b) {
        this.problem(where, "must be a branch object");
        return;
      }
      this.id(b, where);
      if (present(b, "condition")) this.expression(b.condition, at(where, "condition"), scope);
      this.nodes(b.body, at(where, "body"), scope);
    });
    if (present(record, "otherwise") && record.otherwise !== null) {
      if (!Array.isArray(record.otherwise) || record.otherwise.length === 0) this.problem(at(path, "otherwise"), "must be null, or an array that is not empty");
      else this.nodes(record.otherwise, at(path, "otherwise"), scope);
    }
  }

  private iteration(value: Rec, path: string, scope: Scope): void {
    const record = this.members(value, path, "an iteration", ["kind", "id", "source", "item", "index", "key", "body"]);
    if (!record) return;
    this.id(record, path);
    if (present(record, "source")) this.expression(record.source, at(path, "source"), scope);
    const itemName = isIrIdentifier(record.item) ? record.item : null;
    if (present(record, "item") && itemName === null) this.problem(at(path, "item"), "must be an identifier");
    const indexName = isIrIdentifier(record.index) ? record.index : null;
    if (present(record, "index") && record.index !== null) {
      if (indexName === null) this.problem(at(path, "index"), "must be an identifier or null");
      else if (indexName === itemName) this.problem(at(path, "index"), "must differ from item");
    }
    const inner = withLocals(scope, [itemName, indexName].filter((n): n is string => n !== null));
    if (present(record, "key") && record.key !== null) this.expression(record.key, at(path, "key"), inner);
    this.nodes(record.body, at(path, "body"), inner);
  }

  private invocation(value: Rec, path: string, scope: Scope): void {
    const record = this.members(value, path, "an invocation", ["kind", "id", "component", "attributes", "properties", "children", "interactions"]);
    if (!record) return;
    this.id(record, path);
    if (present(record, "component") && !(isIrIdentifier(record.component) && this.declared.dependencies.has(record.component))) {
      this.problem(at(path, "component"), `${String(record.component)} is not a declared dependency`);
    }
    const names = new Set<string>();
    this.attributes(record.attributes, at(path, "attributes"), names, "invocation", null);
    this.bindings(record.properties, at(path, "properties"), names, "invocation", null, scope);
    const channels = new Set<string>();
    this.list(record.interactions, at(path, "interactions"))?.forEach((interaction, i) => {
      const where = item(at(path, "interactions"), i);
      const entry = this.members(interaction, where, "an interaction", ["id", "channel", "steps"]);
      if (!entry) return this.problem(where, "must be an interaction object");
      this.id(entry, where);
      if (present(entry, "channel")) {
        if (!isIrIdentifier(entry.channel)) this.problem(at(where, "channel"), "must be an identifier");
        else if (channels.has(entry.channel)) this.problem(at(where, "channel"), `${entry.channel} is given twice`);
        else channels.add(entry.channel);
      }
      this.steps(entry.steps, at(where, "steps"), inHandler(scope));
    });
    const slots = new Set<string>();
    this.list(record.children, at(path, "children"))?.forEach((content, i) => {
      const where = item(at(path, "children"), i);
      const c = this.members(content, where, "projection content", ["id", "slot", "parameters", "body"]);
      if (!c) {
        this.problem(where, "must be a projection content object");
        return;
      }
      this.id(c, where);
      if (this.nonEmptyString(c, "slot", where)) {
        const slot = c.slot as string;
        if (slots.has(slot)) this.problem(at(where, "slot"), `${slot} is filled twice`);
        slots.add(slot);
      }
      const locals: string[] = [];
      this.list(c.parameters, at(where, "parameters"))?.forEach((parameter, j) => {
        const here = item(at(where, "parameters"), j);
        const p = this.members(parameter, here, "a projection parameter", ["local", "argument"]);
        if (!p) {
          this.problem(here, "must be a projection parameter object");
          return;
        }
        if (present(p, "local")) {
          if (!isIrIdentifier(p.local)) this.problem(at(here, "local"), "must be an identifier");
          else if (locals.includes(p.local)) this.problem(at(here, "local"), `${p.local} is declared twice`);
          else locals.push(p.local);
        }
        if (present(p, "argument") && p.argument !== null && !isNonEmptyString(p.argument)) this.problem(at(here, "argument"), "must be a non-empty string or null");
      });
      this.nodes(c.body, at(where, "body"), withLocals(scope, locals));
    });
  }

  private projection(value: Rec, path: string, scope: Scope): void {
    const record = this.members(value, path, "a projection", ["kind", "id", "slot", "arguments", "fallback"]);
    if (!record) return;
    this.id(record, path);
    this.nonEmptyString(record, "slot", path);
    const given = new Set<string>();
    this.list(record.arguments, at(path, "arguments"))?.forEach((argument, i) => {
      const where = item(at(path, "arguments"), i);
      const a = this.members(argument, where, "a projection argument", ["id", "name", "value"]);
      if (!a) {
        this.problem(where, "must be a projection argument object");
        return;
      }
      this.id(a, where);
      if (this.nonEmptyString(a, "name", where)) {
        const name = a.name as string;
        if (given.has(name)) this.problem(at(where, "name"), `${name} is given twice`);
        given.add(name);
      }
      if (present(a, "value")) this.expression(a.value, at(where, "value"), scope);
    });
    this.nodes(record.fallback, at(path, "fallback"), scope);
  }

  // ── the declarations ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

  declarations(root: Rec): void {
    this.list(root.props, "props")?.forEach((entry, i) => {
      const path = item("props", i);
      const prop = this.members(entry, path, "a prop", ["id", "name", "type", "required", "default"]);
      if (!prop) return this.problem(path, "must be a prop object");
      this.id(prop, path);
      this.declare(prop, "name", path);
      if (present(prop, "type") && !OBIX_IR_PROP_TYPES.includes(prop.type as never)) this.problem(at(path, "type"), `must be one of ${oneOf(OBIX_IR_PROP_TYPES)}`);
      if (present(prop, "required") && typeof prop.required !== "boolean") this.problem(at(path, "required"), "must be a boolean");
      if (present(prop, "default") && prop.default !== null) {
        this.expression(prop.default, at(path, "default"), ROOT_SCOPE);
        this.constant(prop.default, at(path, "default"));
      }
    });
    this.list(root.state, "state")?.forEach((entry, i) => {
      const path = item("state", i);
      const state = this.members(entry, path, "a state", ["id", "name", "initial"]);
      if (!state) return this.problem(path, "must be a state object");
      this.id(state, path);
      this.declare(state, "name", path);
      if (present(state, "initial")) {
        this.expression(state.initial, at(path, "initial"), ROOT_SCOPE);
        this.constant(state.initial, at(path, "initial"));
      }
    });
    this.list(root.derived, "derived")?.forEach((entry, i) => {
      const path = item("derived", i);
      const derived = this.members(entry, path, "a derived value", ["id", "name", "expression"]);
      if (!derived) return this.problem(path, "must be a derived value object");
      this.id(derived, path);
      this.declare(derived, "name", path);
      this.currentDerived = new Set();
      if (present(derived, "expression")) this.expression(derived.expression, at(path, "expression"), ROOT_SCOPE);
      if (isIrIdentifier(derived.name)) this.derivedEdges.set(derived.name, this.currentDerived);
      this.currentDerived = null;
    });
    const channels = new Set<string>();
    this.list(root.outputs, "outputs")?.forEach((entry, i) => {
      const path = item("outputs", i);
      const output = this.members(entry, path, "an output", ["id", "channel", "payload"]);
      if (!output) return this.problem(path, "must be an output object");
      this.id(output, path);
      if (present(output, "channel")) {
        if (!isIrIdentifier(output.channel)) this.problem(at(path, "channel"), "must be an identifier");
        else if (channels.has(output.channel)) this.problem(at(path, "channel"), `${output.channel} is declared twice (a component has one output of a channel)`);
        else channels.add(output.channel);
      }
      if (present(output, "payload") && output.payload !== null && !OBIX_IR_PROP_TYPES.includes(output.payload as never)) this.problem(at(path, "payload"), `must be one of ${oneOf(OBIX_IR_PROP_TYPES)} — or null`);
    });
    this.list(root.actions, "actions")?.forEach((entry, i) => {
      const path = item("actions", i);
      const action = this.members(entry, path, "an action", ["id", "name", "parameters", "steps"]);
      if (!action) return this.problem(path, "must be an action object");
      this.id(action, path);
      this.declare(action, "name", path);
      const parameters = this.identifiers(action.parameters, at(path, "parameters"));
      this.currentAction = [];
      this.steps(action.steps, at(path, "steps"), withLocals(ROOT_SCOPE, parameters));
      if (isIrIdentifier(action.name)) this.actionEdges.set(action.name, this.currentAction);
      this.currentAction = null;
    });
    this.list(root.effects, "effects")?.forEach((entry, i) => {
      const path = item("effects", i);
      const effect = this.members(entry, path, "an effect", ["id", "watch", "parameters", "steps"]);
      if (!effect) return this.problem(path, "must be an effect object");
      this.id(effect, path);
      if (present(effect, "watch")) this.expression(effect.watch, at(path, "watch"), ROOT_SCOPE);
      const parameters = this.identifiers(effect.parameters, at(path, "parameters"));
      if (Array.isArray(effect.parameters) && effect.parameters.length > 2) this.problem(at(path, "parameters"), "must have at most 2 names");
      this.steps(effect.steps, at(path, "steps"), withLocals(ROOT_SCOPE, parameters));
    });
    this.list(root.dependencies, "dependencies")?.forEach((entry, i) => {
      const path = item("dependencies", i);
      const dependency = this.members(entry, path, "a dependency", ["id", "local", "specifier", "export"]);
      if (!dependency) return this.problem(path, "must be a dependency object");
      this.id(dependency, path);
      this.declare(dependency, "local", path);
      this.nonEmptyString(dependency, "specifier", path);
      this.nonEmptyString(dependency, "export", path);
    });
  }

  view(root: Rec): void {
    this.nodes(root.view, "view", ROOT_SCOPE);
    this.list(root.styles, "styles")?.forEach((entry, i) => {
      const path = item("styles", i);
      const style = this.members(entry, path, "a style", ["id", "language", "scope", "content"]);
      if (!style) return this.problem(path, "must be a style object");
      this.id(style, path);
      this.nonEmptyString(style, "language", path);
      if (present(style, "scope") && !OBIX_IR_STYLE_SCOPES.includes(style.scope as never)) this.problem(at(path, "scope"), `must be one of ${oneOf(OBIX_IR_STYLE_SCOPES)}`);
      if (present(style, "content") && typeof style.content !== "string") this.problem(at(path, "content"), "must be a string");
    });
  }

  // ── the cycles ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

  /** The shortest way from `from` to `to` over `edges`, both ends included, or null. */
  private static route(from: string, to: string, edges: (name: string) => Iterable<string>): string[] | null {
    const before = new Map<string, string | null>([[from, null]]);
    const queue = [from];
    for (let head = 0; head < queue.length; head++) {
      const at_ = queue[head] as string;
      if (at_ === to) {
        const route: string[] = [];
        for (let n: string | null = at_; n !== null; n = before.get(n) ?? null) route.unshift(n);
        return route;
      }
      for (const next of edges(at_)) if (!before.has(next)) { before.set(next, at_); queue.push(next); }
    }
    return null;
  }

  cycles(root: Rec): void {
    const derived = Array.isArray(root.derived) ? root.derived : [];
    derived.forEach((entry, i) => {
      if (!isPlainRecord(entry) || !isIrIdentifier(entry.name)) return;
      for (const target of this.derivedEdges.get(entry.name) ?? []) {
        const route = Checker.route(target, entry.name, (n) => this.derivedEdges.get(n) ?? []);
        if (route) {
          this.problem(at(item("derived", i), "expression"), `derived values form a cycle: ${[entry.name, ...route].join(" → ")}`);
          break;
        }
      }
    });
    const actions = Array.isArray(root.actions) ? root.actions : [];
    actions.forEach((entry) => {
      if (!isPlainRecord(entry) || !isIrIdentifier(entry.name)) return;
      for (const edge of this.actionEdges.get(entry.name) ?? []) {
        const route = Checker.route(edge.to, entry.name, (n) => (this.actionEdges.get(n) ?? []).map((e) => e.to));
        if (route) this.problem(edge.path, `actions invoke each other in a cycle: ${[entry.name, ...route].join(" → ")}`);
      }
    });
  }
}

const HEADER = ["schema", "kind", "id", "name", "props", "state", "derived", "outputs", "actions", "effects", "dependencies", "view", "styles"] as const;

/** The problems of a value against the canonical IR (`ObixIrComponent`); `[]` when it is one. */
export function checkIr(value: unknown): readonly string[] {
  if (!isPlainRecord(value)) return [NOT_A_COMPONENT];
  const checker = new Checker(declaredNames(value));
  checker.members(value, "", "a component", HEADER);
  if (present(value, "schema") && value.schema !== OBIX_IR_SCHEMA) checker.problem("schema", `must be ${OBIX_IR_SCHEMA}`);
  if (present(value, "kind") && value.kind !== "component") checker.problem("kind", "must be component");
  checker.id(value, "");
  checker.nonEmptyString(value, "name", "");
  checker.declarations(value);
  checker.view(value);
  checker.cycles(value);
  return checker.problems;
}
