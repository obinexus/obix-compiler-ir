/**
 * C3 — the call of an intrinsic function (docs/recovery/vuets-compiler.md §24): `{ kind: "call", function, arguments }`, where `function` is one of a CLOSED
 * vocabulary of pure functions with the meaning ECMAScript gives them — today `round`, `Math.round`: ToNumber of its one argument, rounded to the nearest
 * integer, halves toward +∞ (−2.5 → −2). Exposed by AnyTune's PitchMeter (`Math.round(props.needlePercent - 50)` in a computed), the one component the IR could
 * not express. A call of anything else — user code, a method, another global — is still not IR. The schema is `obix-dop-ir/3`: a /2 reader cannot read it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { OBIX_IR_EXPRESSION_KINDS, OBIX_IR_FUNCTIONS, OBIX_IR_SCHEMA, checkIr, irEqual, migrateIrFromV1, migrateIrFromV2, parseIr, serializeIr } from '../dist/index.js';

const lit = (value) => ({ kind: 'literal', value });
const prop = (name) => ({ kind: 'reference', scope: 'prop', name });
const call = (fn, ...args) => ({ kind: 'call', function: fn, arguments: args });
const base = (over = {}) => ({ schema: 'obix-dop-ir/3', kind: 'component', id: 'component', name: 'Meter', props: [], state: [], derived: [], outputs: [], actions: [], effects: [], dependencies: [], view: [], styles: [], ...over });
const meter = (expression) =>
  base({
    props: [{ id: 'props.needlePercent', name: 'needlePercent', type: 'number', required: true, default: null }],
    derived: [{ id: 'derived.offset', name: 'offset', expression }],
  });

test('the schema is obix-dop-ir/3, a call is an expression, and the functions are a closed vocabulary: round', () => {
  assert.equal(OBIX_IR_SCHEMA, 'obix-dop-ir/3');
  assert.ok(OBIX_IR_EXPRESSION_KINDS.includes('call'));
  assert.deepEqual([...OBIX_IR_FUNCTIONS], ['round']);
  assert.ok(Object.isFrozen(OBIX_IR_FUNCTIONS));
});

test('PitchMeter’s offset — round(needlePercent − 50) — is valid IR: canonical, and it round-trips', () => {
  const ir = meter(call('round', { kind: 'binary', operator: '-', left: prop('needlePercent'), right: lit(50) }));
  assert.deepEqual(checkIr(ir), []);
  assert.ok(irEqual(parseIr(serializeIr(ir)), ir));
});

test('a call is checked: a function of the vocabulary, with the arguments it takes — one for round — each an expression in scope', () => {
  const said = (expression) => checkIr(meter(expression));
  assert.deepEqual(said(call('floor', lit(1))), ['derived[0].expression.function: must be one of round']);
  assert.deepEqual(said(call('round')), ['derived[0].expression.arguments: round takes 1 argument, not 0']);
  assert.deepEqual(said(call('round', lit(1), lit(2))), ['derived[0].expression.arguments: round takes 1 argument, not 2']);
  assert.deepEqual(said(call('round', { kind: 'reference', scope: 'prop', name: 'nope' })), ['derived[0].expression.arguments[0]: no prop named nope']);
  assert.deepEqual(said({ kind: 'call', function: 'round', arguments: [lit(1)], this: lit(2) }), ['derived[0].expression.this: is not a member of a call']);
  assert.deepEqual(said({ kind: 'call', function: 'round' }), ['derived[0].expression.arguments: is required']);
  assert.deepEqual(said({ kind: 'call', function: 7, arguments: [lit(1)] }), ['derived[0].expression.function: must be one of round']);
  // a call nests like any expression
  assert.deepEqual(said({ kind: 'binary', operator: '+', left: call('round', call('round', lit(1.5))), right: lit(1) }), []);
});

test('a /2 document is migrated to /3 unchanged but for its schema — /3 only adds the call; a /1 document is migrated all the way', () => {
  const v2 = { ...meter({ kind: 'binary', operator: '-', left: prop('needlePercent'), right: lit(50) }), schema: 'obix-dop-ir/2' };
  assert.ok(checkIr(v2).includes('schema: must be obix-dop-ir/3'));
  const v3 = migrateIrFromV2(v2);
  assert.deepEqual(checkIr(v3), []);
  assert.deepEqual({ ...v3, schema: 'obix-dop-ir/2' }, v2);
  assert.ok(Object.isFrozen(v3));
  assert.equal(v2.schema, 'obix-dop-ir/2', 'the document given is not changed');
  assert.throws(() => migrateIrFromV2(v3), /migrateIrFromV2: not an obix-dop-ir\/2 IR/);
  const v1 = { ...v2, schema: 'obix-dop-ir/1' };
  delete v1.outputs;
  assert.equal(migrateIrFromV1(v1).schema, 'obix-dop-ir/3');
});
