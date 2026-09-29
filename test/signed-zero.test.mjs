/**
 * obix-compiler-ir — SIGNED ZERO (docs/recovery/vuets-compiler.md §21, decision D-77; Phase 5.1).
 *
 * `0` and `-0` are two values: `Object.is(0, -0)` is false, `1 / 0` is `Infinity` and `1 / -0` is `-Infinity`, and a program can show the difference on the screen. The IR does not
 * collapse them — and it says `-0` in ONE way: the negation of the literal 0, a `unary` expression. A literal is a JSON scalar, and the text of `-0` is `0`, so a literal `-0` would
 * not be read back as what was written; the checker refuses it (`ir.test.mjs`) and there is no other way to write it.
 *
 * Until Phase 5.1 that made `-0` a value a component could COMPUTE and could not START FROM: a state, the default of a prop and a `const` were deferred by the lowering when they
 * were `-0`, because the IR's constants were literals, arrays and objects. That was a deferral of a program for what a literal could not carry — and the answer to "does the IR
 * preserve signed zero" was "in some places". It is now "everywhere a value is written": the negation of the literal 0 is a constant, and it is the only unary that is. Nothing
 * else about the schema moves (`obix-dop-ir/1`: no member, no kind, no operator is added); one rule of the checker accepts one form the evaluator already gave a meaning to.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { inspect } from 'node:util';
import { checkIr, irDifferences, irEqual, parseIr, serializeIr } from '../dist/index.js';

const lit = (value) => ({ kind: 'literal', value });
const unary = (operator, operand) => ({ kind: 'unary', operator, operand });
const MINUS_ZERO = unary('-', lit(0));
const bare = (over = {}) => ({ schema: 'obix-dop-ir/3', kind: 'component', id: 'component', name: 'Bare', props: [], state: [], derived: [], outputs: [], actions: [], effects: [], dependencies: [], view: [], styles: [], ...over });
const starting = (initial) => bare({ state: [{ id: 'state.n', name: 'n', initial }] });
const prop = (fallback) => bare({ props: [{ id: 'props.p', name: 'p', type: 'number', required: false, default: fallback }] });
const exactly = (value, expected, label = inspect(value, { depth: 8, breakLength: 160 })) => assert.deepEqual(checkIr(value), expected, label);

const A_CONSTANT = 'must be a constant — a literal, minus zero, or an array or object of constants';

test('minus zero is a constant, wherever a constant is needed: what a state starts from, the default of a prop, a member of a constant array or object', () => {
  exactly(starting(MINUS_ZERO), []);
  exactly(prop(MINUS_ZERO), []);
  exactly(starting({ kind: 'array', elements: [lit(1), MINUS_ZERO, { kind: 'array', elements: [MINUS_ZERO] }] }), []);
  exactly(starting({ kind: 'object', entries: [{ key: 'a', value: lit(1) }, { key: 'z', value: MINUS_ZERO }, { key: 'o', value: { kind: 'object', entries: [{ key: 'z', value: MINUS_ZERO }] } }] }), []);
});

test('it is the only unary that is: not the negation of another number, not of a string, not of itself, not the other operators — each is refused where a constant is needed, as before', () => {
  for (const initial of [unary('-', lit(1)), unary('-', lit(0.5)), unary('-', lit('0')), unary('-', lit(null)), unary('-', lit(false)), unary('+', lit(0)), unary('!', lit(0)), unary('-', unary('-', lit(0))), unary('-', unary('-', lit(1)))]) {
    exactly(starting(initial), [`state[0].initial: ${A_CONSTANT}`], inspect(initial, { depth: 6 }));
    exactly(prop(initial), [`props[0].default: ${A_CONSTANT}`], inspect(initial, { depth: 6 }));
  }
  // the topmost part that is not a constant is the one that is named, inside an array and an object as anywhere
  exactly(starting({ kind: 'array', elements: [MINUS_ZERO, unary('-', lit(1))] }), [`state[0].initial.elements[1]: ${A_CONSTANT}`]);
  exactly(starting({ kind: 'object', entries: [{ key: 'z', value: unary('+', lit(0)) }] }), [`state[0].initial.entries[0].value: ${A_CONSTANT}`]);
});

test('the rule is the negation of the literal +0, and the operand is checked as the expression it is: the negation of a literal -0 is neither a constant nor a valid literal', () => {
  const problems = checkIr(starting(unary('-', lit(-0))));
  assert.ok(problems.includes('state[0].initial.operand.value: must be null, a boolean, a finite number (not -0) or a string'), problems.join('\n'));
  assert.ok(problems.includes(`state[0].initial: ${A_CONSTANT}`), problems.join('\n'));
  assert.equal(problems.length, 2, problems.join('\n'));
});

test('what merely has the members of a negation of zero is not one — a value that is not a record as an operand is a problem and no crash; a binary that carries an operand, and an operand of no known kind that carries a zero, are refused as constants', () => {
  const NOT_AN_EXPRESSION = 'must be an expression object';
  for (const operand of [null, 5, 'x', [], undefined]) {
    const problems = checkIr(starting({ kind: 'unary', operator: '-', operand }));
    assert.deepEqual(problems.filter((p) => p.includes(A_CONSTANT)), [`state[0].initial: ${A_CONSTANT}`], String(operand));
    assert.ok(problems.some((p) => p.startsWith('state[0].initial.operand:')), problems.join('\n'));
  }
  assert.deepEqual(checkIr(starting({ kind: 'unary', operator: '-', operand: null })), [`state[0].initial.operand: ${NOT_AN_EXPRESSION}`, `state[0].initial: ${A_CONSTANT}`]);
  assert.deepEqual(checkIr(starting({ kind: 'binary', operator: '-', left: lit(1), right: lit(2), operand: lit(0) })), ['state[0].initial.operand: is not a member of a binary expression', `state[0].initial: ${A_CONSTANT}`]);
  assert.deepEqual(checkIr(starting(unary('-', { kind: 'bogus', value: 0 }))), ['state[0].initial.operand.kind: must be one of literal, array, object, reference, event-payload, member, index, unary, binary, logical, choice, call', `state[0].initial: ${A_CONSTANT}`]);
});

test('there is no literal minus zero: the text of -0 is 0 and would be read back as 0, so the only way to write it is the negation of 0', () => {
  assert.equal(JSON.stringify(-0), '0');
  exactly(starting(lit(-0)), ['state[0].initial.value: must be null, a boolean, a finite number (not -0) or a string']);
  exactly(prop(lit(-0)), ['props[0].default.value: must be null, a boolean, a finite number (not -0) or a string']);
});

test('0 and -0 are two IRs: the canonical text keeps them apart, the equality does, and each is read back from its text as what it was', () => {
  const zero = starting(lit(0));
  const minusZero = starting(MINUS_ZERO);
  assert.notEqual(serializeIr(zero), serializeIr(minusZero));
  assert.equal(irEqual(zero, minusZero), false);
  assert.ok(irDifferences(zero, minusZero).length > 0);
  assert.match(serializeIr(minusZero), /"initial":\{"kind":"unary","operand":\{"kind":"literal","value":0\},"operator":"-"\}/);
  for (const value of [zero, minusZero]) {
    const back = parseIr(serializeIr(value));
    assert.equal(irEqual(back, value), true);
    assert.equal(serializeIr(back), serializeIr(value));
  }
  assert.deepEqual(parseIr(serializeIr(minusZero)).state[0].initial, MINUS_ZERO);
  // -(0) written twice is one IR; and `-(0)` and `0` differ in exactly what the negation adds
  assert.equal(irEqual(starting(unary('-', lit(0))), starting(MINUS_ZERO)), true);
});
