/**
 * The names the IR carries: props, state, derived values, actions, their parameters, the locals of an iteration or of a slot, and the components a view invokes. An ASCII letter,
 * `_` or `$`, then ASCII letters, digits, `_` or `$`. The rule is closed and stated once, so the check that verifies a name and the frontend that decides whether a name can be
 * lowered cannot disagree.
 */
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

export const isIrIdentifier = (value: unknown): value is string => typeof value === "string" && IDENTIFIER.test(value);
