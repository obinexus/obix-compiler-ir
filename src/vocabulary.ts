/**
 * The closed vocabularies of the canonical DOP IR. Every word an IR may use for a KIND, a SCOPE, an OPERATOR or a TYPE is in one of these tables, and only OBIX's own words are:
 * there is no name of a syntax frontend here — no directive, no helper, no node type of any compiler. `v-if` becomes a conditional, `v-for` an iteration, `@click` an event
 * binding, `:disabled` a property binding, `<slot>` a projection; the frontend that read them keeps its own names.
 */

/** The schema of an IR document. A change that breaks a consumer changes the number. */
export const OBIX_IR_SCHEMA = "obix-dop-ir/3" as const;

/** The schema of the provenance document that accompanies an IR — a separate document, keyed by the ids of the IR's nodes. */
export const OBIX_IR_PROVENANCE_SCHEMA = "obix-dop-ir-provenance/1" as const;

/** What a node of the view can be. */
export const OBIX_IR_NODE_KINDS = Object.freeze(["element", "text", "conditional", "iteration", "invocation", "projection"] as const);
export type ObixIrNodeKind = (typeof OBIX_IR_NODE_KINDS)[number];

/**
 * What an expression can be: a small structured language over plain data — no function, no assignment, and no call of user code: a `call` is of one of the
 * intrinsic functions of OBIX_IR_FUNCTIONS, pure, with the meaning ECMAScript gives it (C3).
 */
export const OBIX_IR_EXPRESSION_KINDS = Object.freeze(["literal", "array", "object", "reference", "event-payload", "member", "index", "unary", "binary", "logical", "choice", "call"] as const);
export type ObixIrExpressionKind = (typeof OBIX_IR_EXPRESSION_KINDS)[number];

/** What a step of an action, an effect or an event handler can be: write a state, invoke an action, or tell the invoker on an output channel (C2). */
export const OBIX_IR_STEP_KINDS = Object.freeze(["assign", "invoke", "output"] as const);
export type ObixIrStepKind = (typeof OBIX_IR_STEP_KINDS)[number];

/** What a reference can name: a prop, a state, a derived value, or a local (an action or effect parameter, an iteration item or index, a projection parameter). */
export const OBIX_IR_REFERENCE_SCOPES = Object.freeze(["prop", "state", "derived", "local"] as const);
export type ObixIrReferenceScope = (typeof OBIX_IR_REFERENCE_SCOPES)[number];

/**
 * The intrinsic functions a `call` may name — a closed vocabulary, each pure, each with the meaning of the ECMAScript function it is named for, and each added
 * only with its own proof across the frontends and the runtimes (C3):
 *
 *   round   Math.round — ToNumber of its one argument, rounded to the nearest integer, halves toward +∞ (−2.5 → −2), NaN and ±Infinity kept
 */
export const OBIX_IR_FUNCTIONS = Object.freeze(["round"] as const);
export type ObixIrFunction = (typeof OBIX_IR_FUNCTIONS)[number];
/** How many arguments each function takes. */
export const OBIX_IR_FUNCTION_ARITY: Readonly<Record<ObixIrFunction, number>> = Object.freeze({ round: 1 });

export const OBIX_IR_UNARY_OPERATORS = Object.freeze(["!", "-", "+"] as const);
export type ObixIrUnaryOperator = (typeof OBIX_IR_UNARY_OPERATORS)[number];

/** Arithmetic and strict comparison, with the meaning ECMAScript gives them on plain data. No loose equality. */
export const OBIX_IR_BINARY_OPERATORS = Object.freeze(["+", "-", "*", "/", "%", "===", "!==", "<", "<=", ">", ">="] as const);
export type ObixIrBinaryOperator = (typeof OBIX_IR_BINARY_OPERATORS)[number];

/** Short-circuit operators: the right side is not evaluated when the left decides. */
export const OBIX_IR_LOGICAL_OPERATORS = Object.freeze(["&&", "||", "??"] as const);
export type ObixIrLogicalOperator = (typeof OBIX_IR_LOGICAL_OPERATORS)[number];

/** The type a component states for a prop: enough to say what the prop is, never a framework's own constructor. */
export const OBIX_IR_PROP_TYPES = Object.freeze(["string", "number", "boolean", "array", "object", "function", "unknown"] as const);
export type ObixIrPropType = (typeof OBIX_IR_PROP_TYPES)[number];

/** Whether the rules of a style belong to the component alone or to the whole page. */
export const OBIX_IR_STYLE_SCOPES = Object.freeze(["component", "global"] as const);
export type ObixIrStyleScope = (typeof OBIX_IR_STYLE_SCOPES)[number];
