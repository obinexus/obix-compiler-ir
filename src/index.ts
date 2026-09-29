/**
 * obix-compiler-ir — the canonical DOP IR of OBIX (Phase 4 of the VueTS compiler recovery, docs/recovery/vuets-compiler.md).
 *
 *     Vue frontend ──┐
 *                    ├──►  canonical OBIX DOP IR  ──►  later: native · hybrid
 *     React frontend ┘         (this package)
 *
 * The strongly typed, plain-data, FRAMEWORK-NEUTRAL representation every syntax frontend lowers into, and the only semantic authority of OBIX (D-44): component, props, state,
 * derived values, actions, effects, elements, text, expressions, attributes, property bindings, events, conditionals, iterations, component invocations, projections, styles and
 * accessibility attributes. There is no Vue node, no React node, no JSX node, no directive name and no runtime object in it, and no source location either: provenance is a separate
 * document (`ObixIrProvenance`), keyed by the ids the nodes carry.
 *
 * This package DEFINES the representation — the types, the closed vocabularies, the check that says whether a value is one, the canonical text and the equality of two. It does not
 * LOWER anything into it: that is `obix-compiler-dop`, for the Vue frontend; the React frontend will lower into it independently.
 */
export {
  OBIX_IR_BINARY_OPERATORS,
  OBIX_IR_EXPRESSION_KINDS,
  OBIX_IR_LOGICAL_OPERATORS,
  OBIX_IR_FUNCTION_ARITY,
  OBIX_IR_FUNCTIONS,
  OBIX_IR_NODE_KINDS,
  OBIX_IR_PROP_TYPES,
  OBIX_IR_PROVENANCE_SCHEMA,
  OBIX_IR_REFERENCE_SCOPES,
  OBIX_IR_SCHEMA,
  OBIX_IR_STEP_KINDS,
  OBIX_IR_STYLE_SCOPES,
  OBIX_IR_UNARY_OPERATORS,
} from "./vocabulary.js";
export type {
  ObixIrBinaryOperator,
  ObixIrExpressionKind,
  ObixIrFunction,
  ObixIrLogicalOperator,
  ObixIrNodeKind,
  ObixIrPropType,
  ObixIrReferenceScope,
  ObixIrStepKind,
  ObixIrStyleScope,
  ObixIrUnaryOperator,
} from "./vocabulary.js";
export type * from "./types.js";
export { isAccessibilityAttribute } from "./accessibility.js";
export { isIrIdentifier } from "./identifier.js";
export { checkIr } from "./check.js";
export { irDifferences, irEqual, parseIr, serializeIr } from "./serialize.js";
export { migrateIrFromV1, migrateIrFromV2 } from "./migrate.js";
export { checkIrProvenance, parseIrProvenance, serializeIrProvenance } from "./provenance.js";
export type { ObixIrImportRecord, ObixIrProvenance } from "./provenance.js";
