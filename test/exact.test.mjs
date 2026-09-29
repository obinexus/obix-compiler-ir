/**
 * obix-compiler-ir — what MUTATION TESTING asked for (docs/recovery/vuets-compiler.md, Phase 4).
 *
 * The first mutation run over the built package — 267 single changes to the checker, the canonical text, the equality and the provenance document — was caught 208 times by the
 * tests of ir.test.mjs and missed 59 times. What it missed had one cause: those tests say that a wrong IR has a problem that MATCHES a pattern, and a change that stops some part
 * of the IR from being looked at (or makes one problem into two) leaves the pattern matched by another problem or leaves nothing to match at all. So this file says EXACTLY: a small
 * component with one thing wrong in one place has exactly the problem list stated here, in full; a nested scope sees what is outside it; a shared value is not a cycle and a cycle
 * is not a crash; and the edges of the document that names where things were read.
 *
 * Each test below was written for changes that first run left standing, and says what those changes altered; the run that followed the tests is recorded in docs/recovery/vuets-compiler.md,
 * with the few changes that still stand and why they change nothing a test could see.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { inspect } from 'node:util';
import * as ir from '../dist/index.js';
import { canonical, deepFreeze } from '../dist/serialize.js';
import { sample, sampleProvenance } from '../../../tests/vuets/ir-sample.mjs';

const { checkIr, checkIrProvenance, parseIr, parseIrProvenance, irDifferences } = ir;

const lit = (value) => ({ kind: 'literal', value });
const ref = (scope, name) => ({ kind: 'reference', scope, name });
const bin = (operator, left, right) => ({ kind: 'binary', operator, left, right });
const bare = (over = {}) => ({ schema: 'obix-dop-ir/3', kind: 'component', id: 'component', name: 'Bare', props: [], state: [], derived: [], outputs: [], actions: [], effects: [], dependencies: [], view: [], styles: [], ...over });
const derived = (expression) => bare({ derived: [{ id: 'derived.d', name: 'd', expression }] });
const element = (over = {}) => ({ kind: 'element', id: 'view.0', tag: 'p', attributes: [], properties: [], accessibility: { attributes: [], properties: [] }, events: [], children: [], ...over });
const text = (id, ...parts) => ({ kind: 'text', id, parts });
const exactly = (value, expected, label = inspect(value, { depth: 8, breakLength: 160 })) => assert.deepEqual(checkIr(value), expected, label);

/** An expression that is not one: a kind no IR has (since C3, 'call' is one — the call of an intrinsic function). */
const NOT_AN_EXPRESSION = { kind: 'lambda' };
const WRONG_KIND = 'must be one of literal, array, object, reference, event-payload, member, index, unary, binary, logical, choice, call';

// ── what is not an object, where an object belongs ─────────────────────────────────────────────────────────────────────────────────────────

test('a value that is not an object where one belongs is ONE problem, at its place — nothing inside it is looked for, and nothing crashes', () => {
  exactly(bare({ props: [5] }), ['props[0]: must be a prop object']);
  exactly(bare({ state: [null] }), ['state[0]: must be a state object']);
  exactly(bare({ derived: ['x'] }), ['derived[0]: must be a derived value object']);
  exactly(bare({ actions: [1] }), ['actions[0]: must be an action object']);
  exactly(bare({ effects: [true] }), ['effects[0]: must be an effect object']);
  exactly(bare({ dependencies: [[]] }), ['dependencies[0]: must be a dependency object']);
  exactly(bare({ styles: ['x'] }), ['styles[0]: must be a style object']);
  exactly(derived('x'), ['derived[0].expression: must be an expression object']);
  exactly(derived(null), ['derived[0].expression: must be an expression object']);
  exactly(derived({ kind: 'array', elements: [5] }), ['derived[0].expression.elements[0]: must be an expression object']);
  exactly(derived({ kind: 'object', entries: [7] }), ['derived[0].expression.entries[0]: must be an object entry']);
  exactly(bare({ state: [{ id: 'state.s', name: 's', initial: null }] }), ['state[0].initial: must be an expression object']);
  exactly(bare({ actions: [{ id: 'actions.a', name: 'a', parameters: [], steps: ['x'] }] }), ['actions[0].steps[0]: must be a step object']);
  exactly(bare({ view: [7] }), ['view[0]: must be a node object']);
  exactly(bare({ view: [text('view.0', 7)] }), ['view[0].parts[0]: must be a text part object']);
  exactly(bare({ view: [element({ attributes: [3] })] }), ['view[0].attributes[0]: must be an attribute object']);
  exactly(bare({ view: [element({ properties: [3] })] }), ['view[0].properties[0]: must be a property binding object']);
  exactly(bare({ view: [element({ events: [3] })] }), ['view[0].events[0]: must be an event binding object']);
  exactly(bare({ view: [element({ accessibility: 3 })] }), ['view[0].accessibility: must be an accessibility object']);
});

test('what is missing is said ONCE, with the member it is about: an id, a tag, a value, a kind', () => {
  const noId = element();
  delete noId.id;
  exactly(bare({ view: [noId] }), ['view[0].id: is required']);
  const noTag = element();
  delete noTag.tag;
  exactly(bare({ view: [noTag] }), ['view[0].tag: is required']);
  exactly(bare({ view: [element({ attributes: [{ id: 'view.0.attributes.0', name: 'x' }] })] }), ['view[0].attributes[0].value: is required']);
  exactly(derived({}), ['derived[0].expression.kind: is required']);
  exactly(bare({ view: [text('view.0', {})] }), ['view[0].parts[0].kind: is required']);
  exactly(derived({ kind: 'reference', scope: 'state', name: '1' }), ['derived[0].expression.name: must be an identifier']);
});

// ── every part of an expression, a node and a declaration is looked at ─────────────────────────────────────────────────────────────────────

test('every part of every expression is checked — the elements of an array, the keys and values of an object, both sides of an operator, all three parts of a choice', () => {
  const at = (path) => [`derived[0].expression${path}.kind: ${WRONG_KIND}`];
  exactly(derived({ kind: 'array', elements: [lit(1), NOT_AN_EXPRESSION] }), at('.elements[1]'));
  exactly(derived({ kind: 'object', entries: [{ key: 5, value: lit(1) }] }), ['derived[0].expression.entries[0].key: must be a string']);
  exactly(derived({ kind: 'object', entries: [{ key: 'a', value: NOT_AN_EXPRESSION }] }), at('.entries[0].value'));
  exactly(derived({ kind: 'member', object: NOT_AN_EXPRESSION, property: 'p' }), at('.object'));
  exactly(derived({ kind: 'index', object: NOT_AN_EXPRESSION, index: lit(0) }), at('.object'));
  exactly(derived({ kind: 'index', object: lit(1), index: NOT_AN_EXPRESSION }), at('.index'));
  exactly(derived({ kind: 'unary', operator: '!', operand: NOT_AN_EXPRESSION }), at('.operand'));
  for (const [kind, operator] of [['binary', '+'], ['logical', '&&']]) {
    exactly(derived({ kind, operator, left: NOT_AN_EXPRESSION, right: lit(1) }), at('.left'));
    exactly(derived({ kind, operator, left: lit(1), right: NOT_AN_EXPRESSION }), at('.right'));
  }
  for (const part of ['test', 'consequent', 'alternate']) {
    const choice = { kind: 'choice', test: lit(1), consequent: lit(2), alternate: lit(3) };
    choice[part] = NOT_AN_EXPRESSION;
    exactly(derived(choice), at(`.${part}`));
  }
});

test('every part of a node is checked — the condition, the body and the otherwise of a conditional, the argument of a projection, the value of a binding', () => {
  const branch = (over) => ({ id: 'view.0.branches.0', condition: lit(true), body: [], ...over });
  const conditional = (branches, otherwise = null) => bare({ view: [{ kind: 'conditional', id: 'view.0', branches, otherwise }] });
  exactly(conditional([branch({ condition: NOT_AN_EXPRESSION })]), [`view[0].branches[0].condition.kind: ${WRONG_KIND}`]);
  exactly(conditional([branch({ body: [7] })]), ['view[0].branches[0].body[0]: must be a node object']);
  exactly(conditional([branch()], [7]), ['view[0].otherwise[0]: must be a node object']);
  exactly(bare({ view: [{ kind: 'projection', id: 'view.0', slot: 's', arguments: [{ id: 'view.0.arguments.0', name: 'n', value: NOT_AN_EXPRESSION }], fallback: [] }] }), [`view[0].arguments[0].value.kind: ${WRONG_KIND}`]);
  exactly(bare({ props: [{ id: 'props.p', name: 'p', type: 'string', required: false, default: NOT_AN_EXPRESSION }] }), [`props[0].default.kind: ${WRONG_KIND}`]);
  exactly(bare({ state: [{ id: 'state.s', name: 's', initial: NOT_AN_EXPRESSION }] }), [`state[0].initial.kind: ${WRONG_KIND}`]);
});

// ── scopes ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const iteration = (item, body, id = 'view.0') => ({ kind: 'iteration', id, source: { kind: 'array', elements: [] }, item, index: null, key: null, body });
const invocation = (id, children) => ({ kind: 'invocation', interactions: [], id, component: 'Child', attributes: [], properties: [], children });
const withChild = (view) => bare({ dependencies: [{ id: 'dependencies.Child', local: 'Child', specifier: './Child.vue', export: 'default' }], view });

test('a nested scope sees what is outside it: an iteration inside an iteration, a binding in the body of one, the content of an invocation inside one', () => {
  exactly(bare({ view: [iteration('a', [iteration('b', [text('view.0.body.0.body.0', { kind: 'display', expression: ref('local', 'a') }, { kind: 'display', expression: ref('local', 'b') })], 'view.0.body.0')])] }), []);
  exactly(bare({ view: [iteration('item', [element({ id: 'view.0.body.0', properties: [{ id: 'view.0.body.0.properties.0', name: 'title', value: ref('local', 'item') }] })])] }), [], 'a property binding');
  exactly(bare({ view: [iteration('item', [element({ id: 'view.0.body.0', accessibility: { attributes: [], properties: [{ id: 'view.0.body.0.accessibility.properties.0', name: 'aria-label', value: ref('local', 'item') }] } })])] }), [], 'an accessibility binding');
  exactly(withChild([iteration('item', [invocation('view.0.body.0', [{ id: 'view.0.body.0.children.0', slot: 'default', parameters: [], body: [text('view.0.body.0.children.0.body.0', { kind: 'display', expression: ref('local', 'item') })] }])])]), [], 'the content of an invocation');
  exactly(withChild([invocation('view.0', [{ id: 'view.0.children.0', slot: 'default', parameters: [{ local: 'p', argument: null }], body: [iteration('q', [text('view.0.children.0.body.0.body.0', { kind: 'display', expression: bin('+', ref('local', 'p'), ref('local', 'q')) })], 'view.0.children.0.body.0')] }])]), [], 'a parameter of a content, seen in an iteration inside it');
});

test('an invocation may be given any attribute, the accessibility ones included: they are its inputs, and belong to the component that receives them', () => {
  const given = { ...invocation('view.0', []), attributes: [{ id: 'view.0.attributes.0', name: 'aria-label', value: 'x' }], properties: [{ id: 'view.0.properties.0', name: 'role', value: lit('button') }] };
  exactly(withChild([given]), []);
});

test('attribute names are compared without regard to case, as HTML has them: DATA-X is data-x, given twice', () => {
  exactly(bare({ view: [element({ attributes: [{ id: 'view.0.attributes.0', name: 'data-x', value: '' }], properties: [{ id: 'view.0.properties.0', name: 'DATA-X', value: lit(1) }] })] }), ['view[0].properties[0].name: DATA-X is given twice on this element']);
});

// ── shared and cyclic ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('a cycle is a problem and a shared value is not: the same expression used twice is a tree with a repeated part, an expression that contains itself is a cycle — and neither crashes', () => {
  const one = lit(1);
  exactly(derived(bin('+', one, one)), [], 'the same literal on both sides');
  const cyclic = { kind: 'unary', operator: '-', operand: null };
  cyclic.operand = cyclic;
  exactly(derived(cyclic), ['derived[0].expression.operand: is its own ancestor — an IR is a tree']);
  const shared = text('view.0', { kind: 'static', value: 'x' });
  exactly(bare({ view: [shared, shared] }), ['view[1].id: view.0 is used twice'], 'a node used twice has an id used twice — and is not called a cycle');
});

test('derived values that refer to each other are reported once each, with the shortest way round', () => {
  const value = bare({
    derived: [
      { id: 'derived.d0', name: 'd0', expression: bin('+', ref('derived', 'd1'), ref('derived', 'd2')) },
      { id: 'derived.d1', name: 'd1', expression: ref('derived', 'd0') },
      { id: 'derived.d2', name: 'd2', expression: ref('derived', 'd0') },
    ],
  });
  exactly(value, [
    'derived[0].expression: derived values form a cycle: d0 → d1 → d0',
    'derived[1].expression: derived values form a cycle: d1 → d0 → d1',
    'derived[2].expression: derived values form a cycle: d2 → d0 → d2',
  ]);
});

// ── plain data, however it was made ────────────────────────────────────────────────────────────────────────────────────────────────────────

const withoutPrototypes = (value) => {
  if (Array.isArray(value)) return value.map(withoutPrototypes);
  if (value && typeof value === 'object') return Object.assign(Object.create(null), Object.fromEntries(Object.entries(value).map(([k, v]) => [k, withoutPrototypes(v)])));
  return value;
};

test('plain data is plain however it was made: objects with no prototype are records — and an array is never one, even without a prototype', () => {
  exactly(withoutPrototypes(sample()), [], 'a whole component of objects without a prototype');
  const bareArray = Object.setPrototypeOf([], null);
  exactly(bareArray, ['a component must be a plain object']);
  assert.deepEqual(checkIrProvenance(bareArray), ['provenance must be a plain object']);
});

// ── the canonical text and the equality ────────────────────────────────────────────────────────────────────────────────────────────────────

test('canonical: a member whose value is undefined is not written, as in JSON — and keys are sorted', () => {
  assert.equal(canonical({ b: 1, a: undefined, c: { z: undefined, y: [1] } }), '{"b":1,"c":{"y":[1]}}');
});

test('deepFreeze freezes everything reachable that is plain data — through an object that is frozen already, whose members are not — and never loops on a cycle', () => {
  const inner = { x: { y: 1 } };
  Object.freeze(inner);
  const outer = { inner, list: [{ z: 1 }] };
  deepFreeze(outer);
  assert.ok(Object.isFrozen(outer) && Object.isFrozen(inner) && Object.isFrozen(inner.x) && Object.isFrozen(outer.list) && Object.isFrozen(outer.list[0]));
  const loop = { self: null };
  loop.self = loop;
  assert.doesNotThrow(() => deepFreeze(loop));
  assert.ok(Object.isFrozen(loop));
});

test('the texts that are not texts are refused with the reason: a number is not a document', () => {
  assert.throws(() => parseIr(42), (e) => e instanceof TypeError && /^parseIr: the text must be a string, received number$/.test(e.message));
  assert.throws(() => parseIrProvenance(42), (e) => e instanceof TypeError && /^parseIrProvenance: the text must be a string, received number$/.test(e.message));
});

test('irDifferences compares as Object.is does — NaN is NaN, 0 is not -0 — and lists what differs in the order of the sorted keys, whatever the order they were made in', () => {
  assert.deepEqual(irDifferences({ a: Number.NaN }, { a: Number.NaN }), []);
  assert.deepEqual(irDifferences({ a: 0 }, { a: -0 }), [{ path: 'a', a: 0, b: -0 }]);
  assert.deepEqual(irDifferences({ z: 1, a: 1, m: 1 }, { z: 2, a: 2, m: 2 }).map((d) => d.path), ['a', 'm', 'z']);
});

// ── the provenance document ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const provenanceProblems = (mutate) => {
  const provenance = sampleProvenance();
  mutate(provenance);
  return checkIrProvenance(provenance);
};
const range = (start, end) => ({ start, end });
const at = (line, column, offset) => ({ line, column, offset });

test('provenance: what is missing or wrong is said exactly once, at its place', () => {
  assert.deepEqual(provenanceProblems((p) => { delete p.imports; }), ['imports: is required']);
  assert.deepEqual(provenanceProblems((p) => { delete p.imports[0].isType; }), ['imports[0].isType: is required']);
  assert.deepEqual(provenanceProblems((p) => { p.frontend = 'vue'; }), ['frontend: must be an object']);
  assert.deepEqual(provenanceProblems((p) => { p.origins['view.0'] = 'x'; }), ['origins.view.0: must be a range']);
});

test('provenance: a position is a line and a column of at least 1 and an offset of at least 0, all integers — and has no other member', () => {
  assert.deepEqual(provenanceProblems((p) => { p.origins['view.0'] = range(at(1, 0, 0), at(1, 1, 1)); }), ['origins.view.0.start.column: must be an integer >= 1']);
  assert.deepEqual(provenanceProblems((p) => { p.origins['view.0'] = range(at(1.5, 1, 0), at(1, 1, 1)); }), ['origins.view.0.start.line: must be an integer >= 1']);
  assert.deepEqual(provenanceProblems((p) => { p.origins['view.0'] = range({ ...at(1, 1, 0), extra: 1 }, at(1, 1, 1)); }), ['origins.view.0.start.extra: is not a member of a position']);
  assert.deepEqual(provenanceProblems((p) => { p.origins['view.0'] = range(null, at(1, 1, 1)); }), ['origins.view.0.start: must be a position']);
});

test('provenance: a position with a problem of its own is not also compared with the other — a problem is said once; a range that is one point is a range; a range has no other member', () => {
  assert.deepEqual(provenanceProblems((p) => { p.origins['view.0'] = range(at(1, 0, 5), at(1, 1, 2)); }), ['origins.view.0.start.column: must be an integer >= 1']);
  assert.deepEqual(provenanceProblems((p) => { p.origins['view.0'] = range(at(1, 1, 3), at(1, 1, 3)); }), []);
  assert.deepEqual(provenanceProblems((p) => { p.origins['view.0'] = { ...range(at(1, 1, 0), at(1, 1, 1)), extra: 1 }; }), ['origins.view.0.extra: is not a member of a range']);
});

test('provenance: a cyclic IR is not a crash — the ids of an IR are collected once from each part of it', () => {
  const value = sample();
  value.view[0].children.push(value.view[0]);
  assert.doesNotThrow(() => checkIrProvenance(sampleProvenance(), value));
  assert.ok(Array.isArray(checkIrProvenance(sampleProvenance(), value)));
});
