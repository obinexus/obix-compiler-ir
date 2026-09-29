/**
 * obix-compiler-ir — the canonical DOP IR (Phase 4 of the VueTS compiler recovery, docs/recovery/vuets-compiler.md).
 *
 * The IR is the semantic authority of OBIX (D-44): plain, strongly typed, FRAMEWORK-NEUTRAL data that every syntax frontend lowers into — no Vue node, no React node, no
 * JSX node, no directive name, no runtime object — with the source provenance in a separate document. These tests specify it: the closed vocabularies, what `checkIr` accepts
 * (a hand-written component that uses every kind: tests/vuets/ir-sample.mjs) and the way in which it refuses each violation of the schema, the deterministic serialization
 * and equality that make two IRs comparable byte for byte, the provenance document and its separation from the IR, and the declared types, judged by TypeScript itself.
 *
 * Written before the implementation (RED), then satisfied (GREEN).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ir from '../dist/index.js';
import { sample, sampleProvenance } from '../../../tests/vuets/ir-sample.mjs';
import { typeErrors } from '../../../tests/vuets/type-check.mjs';

const PACKAGE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { checkIr, checkIrProvenance, serializeIr, parseIr, irEqual, irDifferences, serializeIrProvenance, parseIrProvenance, isAccessibilityAttribute } = ir;

const lit = (value) => ({ kind: 'literal', value });
const ref = (scope, name) => ({ kind: 'reference', scope, name });
const problemsOf = (mutate) => {
  const value = sample();
  mutate(value);
  return checkIr(value);
};
/** The problems of a mutated sample must include one that matches — and none may be a crash. */
const refuses = (mutate, pattern, label = String(mutate)) => {
  const problems = problemsOf(mutate);
  assert.ok(problems.some((p) => pattern.test(p)), `${label}\n  expected ${pattern}\n  got ${JSON.stringify(problems, null, 1)}`);
  return problems;
};

// ── the surface and the vocabularies ───────────────────────────────────────────────────────────────────────────────────────────────────────

test('the package exposes the closed vocabularies, the checks, the serialization, the equality — and nothing else', () => {
  assert.deepEqual(Object.keys(ir).sort(), [
    'OBIX_IR_BINARY_OPERATORS', 'OBIX_IR_EXPRESSION_KINDS', 'OBIX_IR_FUNCTIONS', 'OBIX_IR_FUNCTION_ARITY', 'OBIX_IR_LOGICAL_OPERATORS', 'OBIX_IR_NODE_KINDS', 'OBIX_IR_PROP_TYPES', 'OBIX_IR_PROVENANCE_SCHEMA',
    'OBIX_IR_REFERENCE_SCOPES', 'OBIX_IR_SCHEMA', 'OBIX_IR_STEP_KINDS', 'OBIX_IR_STYLE_SCOPES', 'OBIX_IR_UNARY_OPERATORS',
    'checkIr', 'checkIrProvenance', 'irDifferences', 'irEqual', 'isAccessibilityAttribute', 'isIrIdentifier', 'migrateIrFromV1', 'migrateIrFromV2', 'parseIr', 'parseIrProvenance', 'serializeIr', 'serializeIrProvenance',
  ]);
});

test('the vocabularies are frozen and say exactly what the schema says — the kinds, the scopes, the operators, the prop types', () => {
  assert.equal(ir.OBIX_IR_SCHEMA, 'obix-dop-ir/3');
  assert.equal(ir.OBIX_IR_PROVENANCE_SCHEMA, 'obix-dop-ir-provenance/1');
  assert.deepEqual([...ir.OBIX_IR_NODE_KINDS], ['element', 'text', 'conditional', 'iteration', 'invocation', 'projection']);
  assert.deepEqual([...ir.OBIX_IR_EXPRESSION_KINDS], ['literal', 'array', 'object', 'reference', 'event-payload', 'member', 'index', 'unary', 'binary', 'logical', 'choice', 'call']);
  assert.deepEqual([...ir.OBIX_IR_STEP_KINDS], ['assign', 'invoke', 'output']);
  assert.deepEqual([...ir.OBIX_IR_REFERENCE_SCOPES], ['prop', 'state', 'derived', 'local']);
  assert.deepEqual([...ir.OBIX_IR_UNARY_OPERATORS], ['!', '-', '+']);
  assert.deepEqual([...ir.OBIX_IR_BINARY_OPERATORS], ['+', '-', '*', '/', '%', '===', '!==', '<', '<=', '>', '>=']);
  assert.deepEqual([...ir.OBIX_IR_LOGICAL_OPERATORS], ['&&', '||', '??']);
  assert.deepEqual([...ir.OBIX_IR_PROP_TYPES], ['string', 'number', 'boolean', 'array', 'object', 'function', 'unknown']);
  assert.deepEqual([...ir.OBIX_IR_STYLE_SCOPES], ['component', 'global']);
  for (const [name, table] of Object.entries(ir)) if (/^OBIX_IR_[A-Z_]+S$/.test(name) && Array.isArray(table)) assert.ok(Object.isFrozen(table), name);
});

test('the vocabulary is framework-neutral: no word of a table names Vue, React, JSX, a directive, a compiler helper or a syntax tree', () => {
  const forbidden = /vue|react|jsx|^v-|_ctx|\$setup|createvnode|nodetypes|\bast\b|\bloc\b|directive|sfc/i;
  let tables = 0;
  let words = 0;
  for (const [name, table] of Object.entries(ir)) {
    if (!/^OBIX_IR_/.test(name)) continue;
    tables++;
    for (const word of Array.isArray(table) ? table : typeof table === 'object' ? Object.keys(table) : [table]) { assert.doesNotMatch(String(word), forbidden, `${name}: ${word}`); words++; }
  }
  assert.ok(tables === 13 && words >= 52, `${tables} tables and ${words} words were scanned — the scan reads the real vocabulary`);
});

test('accessibility attributes are a closed rule: role, tabindex, alt, for and every aria-* — whatever their case — and nothing else', () => {
  for (const yes of ['role', 'tabindex', 'alt', 'for', 'aria-label', 'aria-labelledby', 'aria-hidden', 'ARIA-Label', 'Role', 'TabIndex', 'aria-x']) assert.equal(isAccessibilityAttribute(yes), true, yes);
  for (const no of ['title', 'class', 'id', 'disabled', 'lang', 'hidden', 'type', 'value', 'aria', 'aria-', 'arial-label', 'data-aria-label', 'role2', '', ' role']) assert.equal(isAccessibilityAttribute(no), false, JSON.stringify(no));
});

test('a name the IR carries is an identifier of ASCII letters, digits, _ and $ that does not start with a digit — the one rule the check and the frontends share', () => {
  for (const yes of ['a', 'A', 'count', 'Card', '_x', '$x', 'x1', 'a_b', 'a$b', '__proto__', 'constructor', 'class']) assert.equal(ir.isIrIdentifier(yes), true, yes);
  for (const no of ['', '1a', 'a-b', 'a b', 'a.b', 'café', 'größe', 'ñ', '日本', 'a\n', '\na', ' a', 'a ', '-a', 'a​']) assert.equal(ir.isIrIdentifier(no), false, JSON.stringify(no));
  for (const notAName of [null, undefined, 1, true, {}, [], ['a'], new String('a'), Symbol('a')]) assert.equal(ir.isIrIdentifier(notAName), false, String(typeof notAName));
});

// ── zero dependencies ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('frontend-neutral by construction: the only dependency is the diagnostic contract\'s TYPES, the built code imports nothing but its own modules, and no host, browser or framework name appears in it', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(PACKAGE, 'package.json'), 'utf8'));
  assert.deepEqual(Object.keys(manifest.dependencies), ['obix-compiler-diagnostics']);
  for (const field of ['peerDependencies', 'optionalDependencies', 'devDependencies']) assert.equal(manifest[field], undefined, field);
  const files = fs.readdirSync(path.join(PACKAGE, 'dist'), { recursive: true }).map(String).filter((f) => f.endsWith('.js'));
  assert.ok(files.length >= 5, `${files.length} built modules`);
  for (const file of files) {
    const code = fs.readFileSync(path.join(PACKAGE, 'dist', file), 'utf8');
    const uncommented = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const m of uncommented.matchAll(/(?:^|\n)\s*(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']/g)) assert.match(m[1], /^\.\/[a-z-]+\.js$/, `${file}: imports ${m[1]}`);
    assert.doesNotMatch(uncommented, /\brequire\s*\(|\bimport\s*\(|\bprocess\b|\bBuffer\b|\bwindow\b|\bdocument\b|\bself\b|\bglobalThis\b|node:|@vue|react/i, `${file}: no host, browser or framework name`);
  }
});

// ── checkIr: what it accepts ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('checkIr accepts the hand-written sample that uses every kind of the schema — and says nothing about it', () => {
  assert.deepEqual(checkIr(sample()), []);
});

test('checkIr accepts the smallest component, a component with an empty view, and a frozen one', () => {
  const minimal = { schema: 'obix-dop-ir/3', kind: 'component', id: 'component', name: 'Empty', props: [], state: [], derived: [], outputs: [], actions: [], effects: [], dependencies: [], view: [], styles: [] };
  assert.deepEqual(checkIr(minimal), []);
  const frozen = parseIr(serializeIr(sample()));
  assert.deepEqual(checkIr(frozen), []);
});

test('checkIr accepts what an author may write: a local shadowing a state name, a nested iteration reusing a name, the same name for a local in two places', () => {
  const value = sample();
  const list = value.view[0].children[3].children[0];
  list.item = 'count'; // shadows the state `count`
  list.body[0].children[0].parts[2].expression = ref('local', 'count');
  list.key = ref('local', 'count');
  assert.deepEqual(checkIr(value), []);
});

// ── checkIr: every way to be wrong ─────────────────────────────────────────────────────────────────────────────────────────────────────────

test('checkIr refuses what is not a component: null, a primitive, an array, a class instance', () => {
  class Component { constructor() { Object.assign(this, sample()); } }
  for (const value of [null, undefined, 4, 'component', [], [sample()], new Component(), new Map()]) assert.deepEqual(checkIr(value), ['a component must be a plain object'], String(value));
});

test('checkIr: the root — schema, kind, id, name, the closed set of members, and the lists', () => {
  refuses((v) => { v.schema = 'obix-dop-ir/4'; }, /^schema: must be obix-dop-ir\/3/);
  refuses((v) => { v.schema = 'obix-dop-ir/1'; }, /^schema: must be obix-dop-ir\/3/);
  refuses((v) => { delete v.schema; }, /^schema: is required/);
  refuses((v) => { v.kind = 'module'; }, /^kind: must be component/);
  refuses((v) => { v.id = ''; }, /^id: must be a non-empty string/);
  refuses((v) => { delete v.name; }, /^name: is required/);
  refuses((v) => { v.name = ''; }, /^name: must be a non-empty string/);
  refuses((v) => { v.loc = { start: 0 }; }, /^loc: is not a member of a component/);
  refuses((v) => { v.ast = {}; }, /^ast: is not a member of a component/);
  refuses((v) => { v.provenance = {}; }, /^provenance: is not a member of a component/);
  for (const key of ['props', 'state', 'derived', 'actions', 'effects', 'dependencies', 'view', 'styles']) {
    refuses((v) => { v[key] = {}; }, new RegExp(`^${key}: must be an array`));
    refuses((v) => { delete v[key]; }, new RegExp(`^${key}: is required`));
  }
});

test('checkIr: a cyclic structure is a problem, not a crash — an IR is a tree', () => {
  refuses((v) => { v.view[0].children.push(v.view[0]); }, /^view\[0\]\.children\[7\]: is its own ancestor — an IR is a tree/);
});

test('checkIr: ids are non-empty strings and unique in the whole component', () => {
  refuses((v) => { v.state[0].id = ''; }, /^state\[0\]\.id: must be a non-empty string/);
  refuses((v) => { v.state[0].id = 7; }, /^state\[0\]\.id: must be a non-empty string/);
  refuses((v) => { delete v.view[0].attributes[0].id; }, /^view\[0\]\.attributes\[0\]\.id: is required/);
  refuses((v) => { v.view[0].children[0].id = v.view[0].id; }, /^view\[0\]\.children\[0\]\.id: view\.0 is used twice/);
  refuses((v) => { v.actions[0].steps[0].id = 'state.count'; }, /^actions\[0\]\.steps\[0\]\.id: state\.count is used twice/);
  refuses((v) => { v.id = 'view.0'; }, /^view\[0\]\.id: view\.0 is used twice/);
});

test('checkIr: one namespace for props, state, derived values, actions and dependencies — identifiers, each declared once', () => {
  refuses((v) => { v.props[0].name = '1x'; }, /^props\[0\]\.name: must be an identifier/);
  refuses((v) => { v.props[0].name = 'a-b'; }, /^props\[0\]\.name: must be an identifier/);
  refuses((v) => { v.state[0].name = 'label'; }, /^state\[0\]\.name: label is declared twice/);
  refuses((v) => { v.derived[0].name = 'count'; }, /^derived\[0\]\.name: count is declared twice/);
  refuses((v) => { v.actions[0].name = 'doubled'; }, /^actions\[0\]\.name: doubled is declared twice/);
  refuses((v) => { v.dependencies[0].local = 'count'; }, /^dependencies\[0\]\.local: count is declared twice/);
  refuses((v) => { v.dependencies[0].specifier = ''; }, /^dependencies\[0\]\.specifier: must be a non-empty string/);
  refuses((v) => { v.dependencies[0].export = ''; }, /^dependencies\[0\]\.export: must be a non-empty string/);
  refuses((v) => { v.dependencies[0].imported = 'x'; }, /^dependencies\[0\]\.imported: is not a member of a dependency/);
});

test('checkIr: props — a type of the closed set, required is a boolean, a default is a constant', () => {
  refuses((v) => { v.props[0].type = 'String'; }, /^props\[0\]\.type: must be one of string, number, boolean, array, object, function, unknown/);
  refuses((v) => { v.props[0].required = 'yes'; }, /^props\[0\]\.required: must be a boolean/);
  refuses((v) => { v.props[1].default = ref('state', 'count'); }, /^props\[1\]\.default: must be a constant — a literal, minus zero, or an array or object of constants/);
  refuses((v) => { delete v.props[1].default; }, /^props\[1\]\.default: is required/);
  refuses((v) => { v.props[0].extra = 1; }, /^props\[0\]\.extra: is not a member of a prop/);
});

test('checkIr: the initial value of a state is a constant — nothing that has to be computed from anything', () => {
  refuses((v) => { v.state[0].initial = ref('state', 'items'); }, /^state\[0\]\.initial: must be a constant/);
  refuses((v) => { v.state[1].initial.elements[0] = { kind: 'binary', operator: '+', left: lit(1), right: lit(2) }; }, /^state\[1\]\.initial\.elements\[0\]: must be a constant/);
  refuses((v) => { v.state[2].initial.entries[1].value = { kind: 'event-payload' }; }, /^state\[2\]\.initial\.entries\[1\]\.value: must be a constant/);
  refuses((v) => { v.state[0].initial = { kind: 'unary', operator: '-', operand: lit(1) }; }, /^state\[0\]\.initial: must be a constant/);
});

test('checkIr: derived values are pure and acyclic — a cycle is named, a self reference is one', () => {
  refuses((v) => { v.derived[0].expression = ref('derived', 'atMax'); }, /^derived\[0\]\.expression: derived values form a cycle: doubled → atMax → doubled/);
  refuses((v) => { v.derived[0].expression = ref('derived', 'doubled'); }, /^derived\[0\]\.expression: derived values form a cycle: doubled → doubled/);
  refuses((v) => { v.derived[0].expression = { kind: 'event-payload' }; }, /^derived\[0\]\.expression: the event payload exists only inside an event handler/);
});

test('checkIr: a reference resolves — to a declared prop, state or derived value, or to a local that is in scope where it is written', () => {
  refuses((v) => { v.derived[0].expression = ref('state', 'nope'); }, /^derived\[0\]\.expression: no state named nope/);
  refuses((v) => { v.derived[0].expression = ref('prop', 'nope'); }, /^derived\[0\]\.expression: no prop named nope/);
  refuses((v) => { v.derived[0].expression = ref('derived', 'nope'); }, /^derived\[0\]\.expression: no derived value named nope/);
  refuses((v) => { v.derived[0].expression = ref('local', 'nope'); }, /^derived\[0\]\.expression: local nope is not in scope here/);
  refuses((v) => { v.derived[0].expression = ref('action', 'increment'); }, /^derived\[0\]\.expression\.scope: must be one of prop, state, derived, local/);
  refuses((v) => { v.view[0].children[0].properties[0].value = ref('local', 'item'); }, /^view\[0\]\.children\[0\]\.properties\[0\]\.value: local item is not in scope here/);
  refuses((v) => { v.actions[0].steps[0].value = ref('local', 'by'); }, /^actions\[0\]\.steps\[0\]\.value: local by is not in scope here/);
  refuses((v) => { v.view[0].children[3].children[0].source = ref('local', 'item'); }, /^view\[0\]\.children\[3\]\.children\[0\]\.source: local item is not in scope here/);
  refuses((v) => { v.view[0].children[5].properties[0].value = ref('local', 'n'); }, /^view\[0\]\.children\[5\]\.properties\[0\]\.value: local n is not in scope here/);
  refuses((v) => { v.view[0].children[5].children[0].body[0].children[0].parts[0] = { kind: 'display', expression: ref('local', 'n') }; }, /^view\[0\]\.children\[5\]\.children\[0\]\.body\[0\]\.children\[0\]\.parts\[0\]\.expression: local n is not in scope here/);
  refuses((v) => { v.effects[0].watch = ref('local', 'value'); }, /^effects\[0\]\.watch: local value is not in scope here/);
  refuses((v) => { v.view[0].children[6].fallback[0].parts[0] = { kind: 'display', expression: ref('local', 'n') }; }, /^view\[0\]\.children\[6\]\.fallback\[0\]\.parts\[0\]\.expression: local n is not in scope here/);
});

test('checkIr: the event payload exists only inside an event handler', () => {
  refuses((v) => { v.actions[0].steps[0].value = { kind: 'event-payload' }; }, /^actions\[0\]\.steps\[0\]\.value: the event payload exists only inside an event handler/);
  refuses((v) => { v.view[0].children[0].properties[0].value = { kind: 'event-payload' }; }, /^view\[0\]\.children\[0\]\.properties\[0\]\.value: the event payload exists only inside an event handler/);
  refuses((v) => { v.effects[0].steps[0].value = { kind: 'event-payload' }; }, /^effects\[0\]\.steps\[0\]\.value: the event payload exists only inside an event handler/);
});

test('checkIr: steps — assign writes a declared state, invoke calls a declared action, and actions do not invoke each other in a cycle', () => {
  refuses((v) => { v.actions[0].steps[0].target = 'nope'; }, /^actions\[0\]\.steps\[0\]\.target: nope is not a declared state/);
  refuses((v) => { v.actions[0].steps[0].target = 'doubled'; }, /^actions\[0\]\.steps\[0\]\.target: doubled is not a declared state/);
  refuses((v) => { v.actions[3].steps[0].action = 'nope'; }, /^actions\[3\]\.steps\[0\]\.action: nope is not a declared action/);
  refuses((v) => { v.actions[0].steps[0].kind = 'call'; }, /^actions\[0\]\.steps\[0\]\.kind: must be one of assign, invoke/);
  refuses((v) => { v.actions[3].steps[0].action = 'twice'; }, /^actions\[3\]\.steps\[0\]\.action: actions invoke each other in a cycle: twice → twice/);
  refuses((v) => { v.actions[0].steps.push({ kind: 'invoke', id: 'actions.increment.steps.1', action: 'twice', arguments: [] }); }, /^actions\[0\]\.steps\[1\]\.action: actions invoke each other in a cycle: increment → twice → increment/);
  refuses((v) => { v.actions[3].steps[1].arguments = {}; }, /^actions\[3\]\.steps\[1\]\.arguments: must be an array/);
  refuses((v) => { v.actions[0].steps[0].action = 'increment'; }, /^actions\[0\]\.steps\[0\]\.action: is not a member of an assign step/);
});

test('checkIr: action parameters are distinct identifiers, and are the locals of the action', () => {
  refuses((v) => { v.actions[1].parameters = ['by', 'by']; }, /^actions\[1\]\.parameters\[1\]: by is declared twice/);
  refuses((v) => { v.actions[1].parameters = ['1']; }, /^actions\[1\]\.parameters\[0\]: must be an identifier/);
  refuses((v) => { v.actions[1].parameters = 'by'; }, /^actions\[1\]\.parameters: must be an array/);
});

test('checkIr: effects — at most two parameters (the new value and the previous one), a watched expression, and steps', () => {
  refuses((v) => { v.effects[0].parameters = ['a', 'b', 'c']; }, /^effects\[0\]\.parameters: must have at most 2 names/);
  refuses((v) => { v.effects[0].parameters = ['a', 'a']; }, /^effects\[0\]\.parameters\[1\]: a is declared twice/);
  refuses((v) => { delete v.effects[0].watch; }, /^effects\[0\]\.watch: is required/);
  refuses((v) => { v.effects[0].steps[0].target = 'doubled'; }, /^effects\[0\]\.steps\[0\]\.target: doubled is not a declared state/);
  refuses((v) => { v.effects[0].name = 'e'; }, /^effects\[0\]\.name: is not a member of an effect/);
});

test('checkIr: expressions — the closed set of kinds, operators, literal values and members', () => {
  refuses((v) => { v.derived[0].expression = { kind: 'lambda', body: lit(1) }; }, /^derived\[0\]\.expression\.kind: must be one of literal, array, object, reference, event-payload, member, index, unary, binary, logical, choice, call/);
  // a call of user code is still not IR: only an intrinsic function, by its name in the vocabulary (C3)
  refuses((v) => { v.derived[0].expression = { kind: 'call', callee: 'f', arguments: [] }; }, /^derived\[0\]\.expression\.callee: is not a member of a call/);
  refuses((v) => { v.derived[0].expression = { kind: 'binary', operator: '**', left: lit(1), right: lit(2) }; }, /^derived\[0\]\.expression\.operator: must be one of \+, -, \*, \/, %, ===, !==, <, <=, >, >=/);
  refuses((v) => { v.derived[0].expression = { kind: 'binary', operator: '==', left: lit(1), right: lit(2) }; }, /^derived\[0\]\.expression\.operator: must be one of/);
  refuses((v) => { v.derived[0].expression = { kind: 'unary', operator: 'typeof', operand: lit(1) }; }, /^derived\[0\]\.expression\.operator: must be one of !, -, \+/);
  refuses((v) => { v.derived[0].expression = { kind: 'logical', operator: 'and', left: lit(1), right: lit(2) }; }, /^derived\[0\]\.expression\.operator: must be one of &&, \|\|, \?\?/);
  for (const bad of [NaN, Infinity, -Infinity, -0, undefined, {}, [], () => 1, 10n, Symbol('s')]) {
    refuses((v) => { v.derived[0].expression = { kind: 'literal', value: bad }; }, /^derived\[0\]\.expression\.value: must be null, a boolean, a finite number \(not -0\) or a string|^derived\[0\]\.expression\.value: is required/, `literal ${String(bad)}`);
  }
  refuses((v) => { v.derived[0].expression = { kind: 'member', object: lit(1), property: '' }; }, /^derived\[0\]\.expression\.property: must be a non-empty string/);
  refuses((v) => { v.derived[0].expression = { kind: 'index', object: lit(1) }; }, /^derived\[0\]\.expression\.index: is required/);
  refuses((v) => { v.derived[0].expression = { kind: 'choice', test: lit(1), consequent: lit(1) }; }, /^derived\[0\]\.expression\.alternate: is required/);
  refuses((v) => { v.derived[0].expression = { kind: 'object', entries: [{ key: 'a', value: lit(1) }, { key: 'a', value: lit(2) }] }; }, /^derived\[0\]\.expression\.entries\[1\]\.key: a is given twice/);
  refuses((v) => { v.derived[0].expression = { kind: 'array', elements: 'x' }; }, /^derived\[0\]\.expression\.elements: must be an array/);
  refuses((v) => { v.derived[0].expression = { kind: 'literal', value: 1, type: 'number' }; }, /^derived\[0\]\.expression\.type: is not a member of a literal/);
  refuses((v) => { v.derived[0].expression = { kind: 'reference', scope: 'state', name: '1' }; }, /^derived\[0\]\.expression\.name: must be an identifier/);
  refuses((v) => { v.derived[0].expression = 'count * 2'; }, /^derived\[0\]\.expression: must be an expression object/);
  refuses((v) => { v.derived[0].expression = { kind: 'event-payload', name: 'e' }; }, /^derived\[0\]\.expression\.name: is not a member of an event payload/);
});

test('checkIr: nodes — the closed set of kinds; an element has a tag; nothing of a syntax tree is accepted, not even in disguise', () => {
  refuses((v) => { v.view[0].kind = 'fragment'; }, /^view\[0\]\.kind: must be one of element, text, conditional, iteration, invocation, projection/);
  refuses((v) => { v.view[0].kind = 'v-if'; }, /^view\[0\]\.kind: must be one of element, text, conditional, iteration, invocation, projection/);
  refuses((v) => { v.view[0].tag = ''; }, /^view\[0\]\.tag: must be a non-empty string/);
  refuses((v) => { v.view[0].loc = { start: { line: 1, column: 1, offset: 0 } }; }, /^view\[0\]\.loc: is not a member of an element/);
  refuses((v) => { v.view[0].children[1].props = []; }, /^view\[0\]\.children\[1\]\.props: is not a member of an element/);
  refuses((v) => { v.view[0].children[1].directives = []; }, /^view\[0\]\.children\[1\]\.directives: is not a member of an element/);
  refuses((v) => { v.view[0] = { type: 1, tag: 'div', tagType: 0, props: [], children: [], loc: {} }; }, /^view\[0\]\.kind: is required/);
  refuses((v) => { v.view[0] = 'div'; }, /^view\[0\]: must be a node object/);
  refuses((v) => { v.view[0].children = null; }, /^view\[0\]\.children: must be an array/);
});

test('checkIr: attributes are strings, property bindings are expressions, and the accessibility attributes live apart — exactly once each on an element', () => {
  refuses((v) => { v.view[0].attributes[0].value = 1; }, /^view\[0\]\.attributes\[0\]\.value: must be a string/);
  refuses((v) => { v.view[0].attributes[0].name = ''; }, /^view\[0\]\.attributes\[0\]\.name: must be a non-empty string/);
  refuses((v) => { v.view[0].attributes.push({ id: 'x.1', name: 'role', value: 'main' }); }, /^view\[0\]\.attributes\[1\]\.name: role is an accessibility attribute and belongs in accessibility/);
  refuses((v) => { v.view[0].attributes.push({ id: 'x.1', name: 'ARIA-Label', value: 'x' }); }, /^view\[0\]\.attributes\[1\]\.name: ARIA-Label is an accessibility attribute and belongs in accessibility/);
  refuses((v) => { v.view[0].properties.push({ id: 'x.1', name: 'aria-hidden', value: lit(true) }); }, /^view\[0\]\.properties\[0\]\.name: aria-hidden is an accessibility attribute and belongs in accessibility/);
  refuses((v) => { v.view[0].accessibility.attributes.push({ id: 'x.1', name: 'class', value: 'a' }); }, /^view\[0\]\.accessibility\.attributes\[1\]\.name: class is not an accessibility attribute/);
  refuses((v) => { v.view[0].accessibility.properties.push({ id: 'x.1', name: 'title', value: lit('t') }); }, /^view\[0\]\.accessibility\.properties\[1\]\.name: title is not an accessibility attribute/);
  refuses((v) => { v.view[0].properties.push({ id: 'x.1', name: 'class', value: lit('b') }); }, /^view\[0\]\.properties\[0\]\.name: class is given twice on this element/);
  refuses((v) => { v.view[0].accessibility.attributes.push({ id: 'x.1', name: 'role', value: 'main' }); }, /^view\[0\]\.accessibility\.attributes\[1\]\.name: role is given twice on this element/);
  refuses((v) => { v.view[0].accessibility.properties.push({ id: 'x.1', name: 'aria-label', value: lit('x') }); }, /^view\[0\]\.accessibility\.properties\[1\]\.name: aria-label is given twice on this element/);
  refuses((v) => { delete v.view[0].accessibility; }, /^view\[0\]\.accessibility: is required/);
  refuses((v) => { v.view[0].accessibility.roles = []; }, /^view\[0\]\.accessibility\.roles: is not a member of accessibility/);
  refuses((v) => { v.view[0].children[1].properties[0].value = 'true'; }, /^view\[0\]\.children\[1\]\.properties\[0\]\.value: must be an expression object/);
});

test('checkIr: events — a name and steps that resolve, with the payload of the event in scope', () => {
  refuses((v) => { v.view[0].children[1].events[0].event = ''; }, /^view\[0\]\.children\[1\]\.events\[0\]\.event: must be a non-empty string/);
  refuses((v) => { v.view[0].children[1].events[0].steps[0].action = 'nope'; }, /^view\[0\]\.children\[1\]\.events\[0\]\.steps\[0\]\.action: nope is not a declared action/);
  refuses((v) => { v.view[0].children[1].events[0].steps = 'x'; }, /^view\[0\]\.children\[1\]\.events\[0\]\.steps: must be an array/);
  refuses((v) => { v.view[0].children[1].events[0].modifiers = ['prevent']; }, /^view\[0\]\.children\[1\]\.events\[0\]\.modifiers: is not a member of an event binding/);
  // the event handlers of a list item see the loop variables
  assert.deepEqual(problemsOf((v) => { v.view[0].children[3].children[0].body[0].events[0].steps[0].arguments = [ref('local', 'item'), ref('local', 'i'), { kind: 'event-payload' }]; }), []);
});

test('checkIr: text is a non-empty list of static and displayed parts', () => {
  refuses((v) => { v.view[0].children[0].children[0].parts = []; }, /^view\[0\]\.children\[0\]\.children\[0\]\.parts: must not be empty/);
  refuses((v) => { v.view[0].children[0].children[0].parts[0].kind = 'interpolation'; }, /^view\[0\]\.children\[0\]\.children\[0\]\.parts\[0\]\.kind: must be one of static, display/);
  refuses((v) => { v.view[0].children[0].children[0].parts[0].value = 4; }, /^view\[0\]\.children\[0\]\.children\[0\]\.parts\[0\]\.value: must be a string/);
  refuses((v) => { v.view[0].children[0].children[0].parts[1].expression = 'label'; }, /^view\[0\]\.children\[0\]\.children\[0\]\.parts\[1\]\.expression: must be an expression object/);
  refuses((v) => { v.view[0].children[0].children[0].parts[1].id = 'p'; }, /^view\[0\]\.children\[0\]\.children\[0\]\.parts\[1\]\.id: is not a member of a displayed part/);
});

test('checkIr: a conditional has branches with conditions, and an otherwise that is absent or not empty — one canonical form', () => {
  refuses((v) => { v.view[0].children[2].branches = []; }, /^view\[0\]\.children\[2\]\.branches: must not be empty/);
  refuses((v) => { delete v.view[0].children[2].branches[0].condition; }, /^view\[0\]\.children\[2\]\.branches\[0\]\.condition: is required/);
  refuses((v) => { v.view[0].children[2].otherwise = []; }, /^view\[0\]\.children\[2\]\.otherwise: must be null, or an array that is not empty/);
  refuses((v) => { v.view[0].children[2].otherwise = 'none'; }, /^view\[0\]\.children\[2\]\.otherwise: must be null, or an array that is not empty/);
  refuses((v) => { delete v.view[0].children[2].otherwise; }, /^view\[0\]\.children\[2\]\.otherwise: is required/);
  assert.deepEqual(problemsOf((v) => { v.view[0].children[2].otherwise = null; }), []);
  assert.deepEqual(problemsOf((v) => { v.view[0].children[2].branches[1].body = []; }), [], 'a branch with nothing to show is a valid branch');
});

test('checkIr: an iteration names an item and, possibly, an index — two identifiers — and its key may use them', () => {
  refuses((v) => { v.view[0].children[3].children[0].item = '1'; }, /^view\[0\]\.children\[3\]\.children\[0\]\.item: must be an identifier/);
  refuses((v) => { v.view[0].children[3].children[0].index = 'x-y'; }, /^view\[0\]\.children\[3\]\.children\[0\]\.index: must be an identifier or null/);
  refuses((v) => { v.view[0].children[3].children[0].index = 'item'; }, /^view\[0\]\.children\[3\]\.children\[0\]\.index: must differ from item/);
  refuses((v) => { delete v.view[0].children[3].children[0].key; }, /^view\[0\]\.children\[3\]\.children\[0\]\.key: is required/);
  assert.deepEqual(problemsOf((v) => {
    const it = v.view[0].children[3].children[0];
    it.index = null;
    it.key = null;
    it.body[0].events[0].steps[0].arguments = [lit(0)]; // the body no longer has an index to use
    it.body[0].children[0].parts[0] = { kind: 'static', value: '#' };
  }), []);
  refuses((v) => { const it = v.view[0].children[3].children[0]; it.index = null; }, /local i is not in scope here/, 'without an index, nothing may use one');
});

test('checkIr: an invocation names a declared dependency, gives each input once, and fills each projection once, with parameters that are distinct locals', () => {
  refuses((v) => { v.view[0].children[5].component = 'Nope'; }, /^view\[0\]\.children\[5\]\.component: Nope is not a declared dependency/);
  refuses((v) => { v.view[0].children[5].children[1].slot = 'default'; }, /^view\[0\]\.children\[5\]\.children\[1\]\.slot: default is filled twice/);
  refuses((v) => { v.view[0].children[5].children[0].slot = ''; }, /^view\[0\]\.children\[5\]\.children\[0\]\.slot: must be a non-empty string/);
  refuses((v) => { v.view[0].children[5].children[1].parameters.push({ local: 'n', argument: 'x' }); }, /^view\[0\]\.children\[5\]\.children\[1\]\.parameters\[2\]\.local: n is declared twice/);
  refuses((v) => { v.view[0].children[5].children[1].parameters[1].argument = ''; }, /^view\[0\]\.children\[5\]\.children\[1\]\.parameters\[1\]\.argument: must be a non-empty string or null/);
  refuses((v) => { v.view[0].children[5].children[1].parameters[0].local = '1'; }, /^view\[0\]\.children\[5\]\.children\[1\]\.parameters\[0\]\.local: must be an identifier/);
  refuses((v) => { v.view[0].children[5].properties.push({ id: 'x.1', name: 'title', value: lit('t') }); }, /^view\[0\]\.children\[5\]\.properties\[1\]\.name: title is given twice on this invocation/);
  refuses((v) => { v.view[0].children[5].events = []; }, /^view\[0\]\.children\[5\]\.events: is not a member of an invocation/);
  refuses((v) => { v.view[0].children[5].accessibility = { attributes: [], properties: [] }; }, /^view\[0\]\.children\[5\]\.accessibility: is not a member of an invocation/);
});

test('checkIr: a projection names its slot, gives each argument once, and has a fallback', () => {
  refuses((v) => { v.view[0].children[6].slot = ''; }, /^view\[0\]\.children\[6\]\.slot: must be a non-empty string/);
  refuses((v) => { v.view[0].children[6].arguments.push({ id: 'x.1', name: 'n', value: lit(1) }); }, /^view\[0\]\.children\[6\]\.arguments\[1\]\.name: n is given twice/);
  refuses((v) => { delete v.view[0].children[6].fallback; }, /^view\[0\]\.children\[6\]\.fallback: is required/);
  refuses((v) => { v.view[0].children[6].arguments[0].name = ''; }, /^view\[0\]\.children\[6\]\.arguments\[0\]\.name: must be a non-empty string/);
});

test('checkIr: styles — a language, a scope of the closed set, the text', () => {
  refuses((v) => { v.styles[0].scope = 'scoped'; }, /^styles\[0\]\.scope: must be one of component, global/);
  refuses((v) => { v.styles[0].language = ''; }, /^styles\[0\]\.language: must be a non-empty string/);
  refuses((v) => { v.styles[0].content = 3; }, /^styles\[0\]\.content: must be a string/);
  refuses((v) => { v.styles[0].module = true; }, /^styles\[0\]\.module: is not a member of a style/);
  assert.deepEqual(problemsOf((v) => { v.styles[0].content = ''; }), [], 'an empty stylesheet is a stylesheet');
});

test('checkIr reports every problem of a component, not the first', () => {
  const value = sample();
  value.name = '';
  value.state[0].id = '';
  value.view[0].tag = '';
  const got = checkIr(value);
  assert.ok(got.length >= 3, JSON.stringify(got));
  assert.ok(got.some((p) => /^name:/.test(p)) && got.some((p) => /^state\[0\]\.id:/.test(p)) && got.some((p) => /^view\[0\]\.tag:/.test(p)));
});

// ── serialization and equality ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The same data with the keys of every object in the opposite order. */
const reversedKeys = (value) => {
  if (Array.isArray(value)) return value.map(reversedKeys);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, reversedKeys(v)]));
  return value;
};

test('serializeIr is canonical JSON: keys in sorted order at every level, no whitespace, and the same bytes whatever the order the keys were created in', () => {
  const text = serializeIr(sample());
  assert.equal(typeof text, 'string');
  assert.match(text, /^\{"actions":\[\{"id":"actions\.increment","name":"increment","parameters":\[\],"steps":\[/);
  assert.equal(text, JSON.stringify(JSON.parse(text)), 'no whitespace but what is inside a string');
  assert.equal(serializeIr(reversedKeys(sample())), text);
  assert.deepEqual(JSON.parse(text), JSON.parse(JSON.stringify(sample())));
  // every object of the output has its keys sorted
  const sorted = (value) => {
    if (Array.isArray(value)) return value.every(sorted);
    if (value && typeof value === 'object') { const keys = Object.keys(value); return keys.join() === [...keys].sort().join() && keys.every((k) => sorted(value[k])); }
    return true;
  };
  assert.ok(sorted(JSON.parse(text)));
});

test('serializeIr is deterministic and total over valid IR — and refuses an invalid one instead of writing bytes that mean nothing', () => {
  assert.equal(serializeIr(sample()), serializeIr(sample()));
  const broken = sample();
  broken.view[0].tag = '';
  assert.throws(() => serializeIr(broken), (e) => e instanceof TypeError && /cannot serialize an invalid IR: view\[0\]\.tag: must be a non-empty string/.test(e.message));
  assert.throws(() => serializeIr(null), TypeError);
});

test('parseIr reads what serializeIr wrote and returns the same IR, deep-frozen — and the round trip is stable byte for byte', () => {
  const text = serializeIr(sample());
  const parsed = parseIr(text);
  assert.deepEqual(parsed, sample());
  assert.equal(serializeIr(parsed), text);
  assert.equal(serializeIr(parseIr(serializeIr(parsed))), text);
  const frozen = (value) => value === null || typeof value !== 'object' || (Object.isFrozen(value) && Object.values(value).every(frozen));
  assert.ok(frozen(parsed), 'frozen all the way down');
  assert.throws(() => { parsed.view[0].tag = 'x'; }, TypeError);
});

test('parseIr refuses what is not an IR: text that is not JSON, JSON that is not a component, a component that is not valid — each with the reason', () => {
  assert.throws(() => parseIr('{not json'), (e) => e instanceof TypeError && /not JSON/.test(e.message));
  assert.throws(() => parseIr('[1,2]'), (e) => e instanceof TypeError && /invalid IR: a component must be a plain object/.test(e.message));
  const broken = JSON.parse(serializeIr(sample()));
  broken.state[0].name = 'label';
  assert.throws(() => parseIr(JSON.stringify(broken)), (e) => e instanceof TypeError && /invalid IR: state\[0\]\.name: label is declared twice/.test(e.message));
  assert.throws(() => parseIr(42), TypeError);
});

test('irEqual: two IRs are equal exactly when their canonical bytes are — the order of keys does not matter, a literal that differs does, and so does the order of a list', () => {
  assert.equal(irEqual(sample(), sample()), true);
  assert.equal(irEqual(sample(), reversedKeys(sample())), true);
  const other = sample();
  other.state[0].initial.value = 1;
  assert.equal(irEqual(sample(), other), false);
  const reordered = sample();
  reordered.props.reverse();
  assert.equal(irEqual(sample(), reordered), false);
  assert.throws(() => irEqual(sample(), { nope: true }), TypeError);
});

test('irDifferences says where two values differ — a path and both sides — in a deterministic order, and nothing when they are equal', () => {
  assert.deepEqual(irDifferences(sample(), sample()), []);
  assert.deepEqual(irDifferences(sample(), reversedKeys(sample())), []);
  const other = sample();
  other.state[0].initial.value = 1;
  other.view[0].children[0].tag = 'h2';
  other.props.pop();
  other.name = 'Other';
  assert.deepEqual(irDifferences(sample(), other), [
    { path: 'name', a: 'Demo', b: 'Other' },
    { path: 'props[1]', a: sample().props[1], b: undefined },
    { path: 'state[0].initial.value', a: 0, b: 1 },
    { path: 'view[0].children[0].tag', a: 'h1', b: 'h2' },
  ]);
  assert.deepEqual(irDifferences({ a: [1, 2] }, { a: [1, 2, 3] }), [{ path: 'a[2]', a: undefined, b: 3 }]);
  assert.deepEqual(irDifferences({ a: 1 }, { a: '1' }), [{ path: 'a', a: 1, b: '1' }]);
  assert.deepEqual(irDifferences({ a: { b: 1 } }, { a: [1] }), [{ path: 'a', a: { b: 1 }, b: [1] }]);
  assert.deepEqual(irDifferences({ x: 1 }, { y: 1 }), [{ path: 'x', a: 1, b: undefined }, { path: 'y', a: undefined, b: 1 }]);
});

// ── provenance: a separate document ────────────────────────────────────────────────────────────────────────────────────────────────────────

test('provenance is a SEPARATE document: the IR has no place for a source location, and a location put in it is refused', () => {
  const text = serializeIr(sample());
  assert.doesNotMatch(text, /"(?:loc|range|start|end|origin|origins|offset|line|column|provenance|file|filename)"/, 'no key of the IR is about the source');
  refuses((v) => { v.view[0].origin = { start: 0 }; }, /^view\[0\]\.origin: is not a member of an element/);
  refuses((v) => { v.view[0].range = {}; }, /^view\[0\]\.range: is not a member of an element/);
  refuses((v) => { v.state[0].provenance = {}; }, /^state\[0\]\.provenance: is not a member of a state/);
});

test('checkIrProvenance accepts a provenance record and, given the IR, insists that every origin is the id of one of its nodes', () => {
  const value = sample();
  const provenance = sampleProvenance(value);
  assert.deepEqual(checkIrProvenance(provenance), []);
  assert.deepEqual(checkIrProvenance(provenance, value), []);
  const stray = sampleProvenance(value);
  stray.origins['view.99'] = stray.origins['view.0'];
  assert.deepEqual(checkIrProvenance(stray), [], 'without the IR there is nothing to compare with');
  assert.ok(checkIrProvenance(stray, value).some((p) => /^origins\.view\.99: is not the id of a node of the IR/.test(p)));
});

test('checkIrProvenance names each way a provenance record can be wrong', () => {
  const cases = [
    [(p) => { p.schema = 'x'; }, /^schema: must be obix-dop-ir-provenance\/1/],
    [(p) => { delete p.frontend; }, /^frontend: is required/],
    [(p) => { p.frontend = { name: '', version: '1' }; }, /^frontend\.name: must be a non-empty string/],
    [(p) => { p.frontend.version = 3; }, /^frontend\.version: must be a non-empty string/],
    [(p) => { p.frontend.extra = 1; }, /^frontend\.extra: is not a member of a frontend/],
    [(p) => { p.file = ''; }, /^file: must be a non-empty string/],
    [(p) => { p.origins = []; }, /^origins: must be an object/],
    [(p) => { p.origins['view.0'] = { start: { line: 0, column: 1, offset: 0 }, end: { line: 1, column: 1, offset: 0 } }; }, /^origins\.view\.0\.start\.line: must be an integer >= 1/],
    [(p) => { p.origins['view.0'] = { start: { line: 1, column: 1, offset: 5 }, end: { line: 1, column: 1, offset: 2 } }; }, /^origins\.view\.0: start must not lie after end/],
    [(p) => { p.origins['view.0'] = { start: { line: 1, column: 1 }, end: { line: 1, column: 1, offset: 0 } }; }, /^origins\.view\.0\.start\.offset: must be an integer >= 0/],
    [(p) => { p.origins['view.0'] = 'x'; }, /^origins\.view\.0: must be a range/],
    [(p) => { p.origins[''] = p.origins['view.0']; }, /^origins\.: an origin is keyed by the id of a node/],
    [(p) => { p.imports = {}; }, /^imports: must be an array/],
    [(p) => { p.imports[0].specifier = ''; }, /^imports\[0\]\.specifier: must be a non-empty string/],
    [(p) => { p.imports[0].imported = ''; }, /^imports\[0\]\.imported: must be a non-empty string/],
    [(p) => { p.imports[0].local = 3; }, /^imports\[0\]\.local: must be a non-empty string/],
    [(p) => { p.imports[0].isType = 'no'; }, /^imports\[0\]\.isType: must be a boolean/],
    [(p) => { p.imports[0].alias = 'x'; }, /^imports\[0\]\.alias: is not a member of an import/],
    [(p) => { p.ast = {}; }, /^ast: is not a member of provenance/],
  ];
  for (const [mutate, pattern] of cases) {
    const provenance = sampleProvenance();
    mutate(provenance);
    const got = checkIrProvenance(provenance);
    assert.ok(got.some((p) => pattern.test(p)), `${String(mutate)}\n  expected ${pattern}\n  got ${JSON.stringify(got)}`);
  }
  assert.deepEqual(checkIrProvenance(null), ['provenance must be a plain object']);
});

test('provenance serializes canonically and round trips, deep-frozen — the imports as written, "obix" included, are data of the document and never touched', () => {
  const provenance = sampleProvenance();
  const text = serializeIrProvenance(provenance);
  assert.match(text, /^\{"file":"Demo\.obix","frontend":\{"name":"vue","version":"3\.5\.43"\},"imports":\[\{"imported":"ref","isType":false,"local":"ref","specifier":"obix"\}/);
  assert.equal(serializeIrProvenance(reversedKeys(provenance)), text);
  const parsed = parseIrProvenance(text);
  assert.deepEqual(parsed, provenance);
  assert.equal(serializeIrProvenance(parsed), text);
  assert.ok(Object.isFrozen(parsed) && Object.isFrozen(parsed.origins) && Object.isFrozen(parsed.imports[0]));
  assert.equal(parsed.imports[0].specifier, 'obix');
  assert.throws(() => parseIrProvenance('{'), (e) => e instanceof TypeError && /not JSON/.test(e.message));
  const broken = sampleProvenance();
  broken.file = '';
  assert.throws(() => serializeIrProvenance(broken), (e) => e instanceof TypeError && /cannot serialize invalid provenance: file: must be a non-empty string/.test(e.message));
  assert.throws(() => parseIrProvenance(JSON.stringify(broken)), (e) => e instanceof TypeError && /invalid provenance: file: must be a non-empty string/.test(e.message));
});

// ── neutrality of what is written ──────────────────────────────────────────────────────────────────────────────────────────────────────────

test('what the IR is made of is framework-neutral: every key and every word of the closed vocabulary in the sample — kinds, scopes, operators, types, languages — is free of Vue, React, JSX, directives and syntax trees', () => {
  const forbidden = /vue|react|jsx|^v-|_ctx|\$setup|createvnode|nodetypes|\bast\b|\bloc\b|directive|sfc|tagtype|helper|codegen/i;
  const vocabulary = new Set(['kind', 'scope', 'operator', 'type', 'language', 'schema']);
  const seen = { keys: new Set(), words: new Set() };
  const walk = (value) => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) {
        seen.keys.add(k);
        if (vocabulary.has(k) && typeof v === 'string') seen.words.add(v);
        walk(v);
      }
    }
  };
  walk(sample());
  assert.ok(seen.keys.size >= 40 && seen.words.size >= 25, `${seen.keys.size} keys, ${seen.words.size} words`);
  for (const word of [...seen.keys, ...seen.words]) assert.doesNotMatch(word, forbidden, word);
});

// ── the declared types ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('the declarations accept a component and reject what the schema forbids — judged by TypeScript itself, with @ts-expect-error for every wrong shape', () => {
  const source = `
import type {
  ObixIrComponent, ObixIrNode, ObixIrElement, ObixIrText, ObixIrConditional, ObixIrIteration, ObixIrInvocation, ObixIrProjection, ObixIrExpression, ObixIrStep,
  ObixIrAttribute, ObixIrPropertyBinding, ObixIrEventBinding, ObixIrAccessibility, ObixIrProp, ObixIrState, ObixIrDerived, ObixIrAction, ObixIrEffect, ObixIrDependency, ObixIrStyle,
  ObixIrProvenance, ObixIrImportRecord, ObixIrDifference, ObixIrReferenceScope, ObixIrPropType,
} from "../dist/index.js";
import { checkIr, parseIr, serializeIr, irEqual, irDifferences, OBIX_IR_NODE_KINDS } from "../dist/index.js";

const count: ObixIrExpression = { kind: "reference", scope: "state", name: "count" };
const one: ObixIrExpression = { kind: "literal", value: 1 };
const sum: ObixIrExpression = { kind: "binary", operator: "+", left: count, right: one };
const step: ObixIrStep = { kind: "assign", id: "actions.a.steps.0", target: "count", value: sum };
const action: ObixIrAction = { id: "actions.a", name: "a", parameters: [], steps: [step] };
const text: ObixIrText = { kind: "text", id: "view.0", parts: [{ kind: "static", value: "x" }, { kind: "display", expression: count }] };
const attribute: ObixIrAttribute = { id: "view.1.attributes.0", name: "type", value: "button" };
const binding: ObixIrPropertyBinding = { id: "view.1.properties.0", name: "disabled", value: count };
const event: ObixIrEventBinding = { id: "view.1.events.0", event: "click", steps: [step] };
const accessibility: ObixIrAccessibility = { attributes: [attribute], properties: [binding] };
const button: ObixIrElement = { kind: "element", id: "view.1", tag: "button", attributes: [attribute], properties: [binding], accessibility, events: [event], children: [text] };
const node: ObixIrNode = button;
const prop: ObixIrProp = { id: "props.p", name: "p", type: "string", required: true, default: null };
const state: ObixIrState = { id: "state.count", name: "count", initial: one };
const derived: ObixIrDerived = { id: "derived.d", name: "d", expression: sum };
const effect: ObixIrEffect = { id: "effects.0", watch: count, parameters: ["value"], steps: [step] };
const dependency: ObixIrDependency = { id: "dependencies.C", local: "C", specifier: "./C.vue", export: "default" };
const style: ObixIrStyle = { id: "styles.0", language: "css", scope: "component", content: "" };
const component: ObixIrComponent = { schema: "obix-dop-ir/3", kind: "component", id: "component", name: "X", props: [prop], state: [state], derived: [derived], outputs: [], actions: [action], effects: [effect], dependencies: [dependency], view: [node], styles: [style] };
const provenance: ObixIrProvenance = { schema: "obix-dop-ir-provenance/1", frontend: { name: "vue", version: "3.5.43" }, file: "X.obix", origins: { "view.0": { start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 2, offset: 1 } } }, imports: [] };
const imported: ObixIrImportRecord = { specifier: "obix", imported: "ref", local: "ref", isType: false };
const scope: ObixIrReferenceScope = "local";
const propType: ObixIrPropType = "unknown";
const parsed: ObixIrComponent = parseIr(serializeIr(component));
const problems: readonly string[] = checkIr(parsed);
const same: boolean = irEqual(parsed, component);
const differences: readonly ObixIrDifference[] = irDifferences(parsed, component);
const kinds: readonly string[] = OBIX_IR_NODE_KINDS;
void [conditional(), iteration(), invocation(), projection(), imported, scope, propType, provenance, problems, same, differences, kinds];

// every kind of node is handled, or the switch stops compiling
function describe(n: ObixIrNode): string {
  switch (n.kind) {
    case "element": return n.tag;
    case "text": return n.parts.length + "";
    case "conditional": return n.branches.length + "";
    case "iteration": return n.item;
    case "invocation": return n.component;
    case "projection": return n.slot;
    default: { const unreachable: never = n; return unreachable; }
  }
}
function measure(e: ObixIrExpression): number {
  switch (e.kind) {
    case "literal": return 1;
    case "array": return e.elements.length;
    case "object": return e.entries.length;
    case "reference": return e.name.length;
    case "event-payload": return 0;
    case "member": return measure(e.object);
    case "index": return measure(e.index);
    case "unary": return measure(e.operand);
    case "binary": return measure(e.left) + measure(e.right);
    case "logical": return measure(e.left) + measure(e.right);
    case "choice": return measure(e.test);
    case "call": return e.arguments.length;
    default: { const unreachable: never = e; return unreachable; }
  }
}
void [describe, measure];
declare function conditional(): ObixIrConditional;
declare function iteration(): ObixIrIteration;
declare function invocation(): ObixIrInvocation;
declare function projection(): ObixIrProjection;

// @ts-expect-error a Vue directive name is not a kind of node
const directiveKind: ObixIrNode["kind"] = "v-if";
// @ts-expect-error nor a compiler's own name for a node
const numericKind: ObixIrNode["kind"] = 1;
// @ts-expect-error no source location in the IR: provenance is a separate document
const located: ObixIrElement = { ...button, loc: { start: 0 } };
// @ts-expect-error no syntax tree of a frontend either
const withAst: ObixIrElement = { ...button, ast: {} };
// @ts-expect-error a call is not an expression of the kernel
const call: ObixIrExpression = { kind: "call", callee: "f", arguments: [] };
// @ts-expect-error the operators are a closed set
const power: ObixIrExpression = { kind: "binary", operator: "**", left: one, right: one };
// @ts-expect-error a reference has a scope of the closed set
const global: ObixIrExpression = { kind: "reference", scope: "global", name: "x" };
// @ts-expect-error a literal is a JSON scalar
const objectLiteral: ObixIrExpression = { kind: "literal", value: {} };
// @ts-expect-error an element needs its accessibility record
const bare: ObixIrElement = { kind: "element", id: "v", tag: "p", attributes: [], properties: [], events: [], children: [] };
// @ts-expect-error a step is assign, invoke or output
const stepKind: ObixIrStep = { kind: "call", id: "s", action: "a", arguments: [] };
// @ts-expect-error a prop type is one of the closed set
const badPropType: ObixIrPropType = "String";
// @ts-expect-error the schema is a literal
const badSchema: ObixIrComponent = { ...component, schema: "obix-dop-ir/4" };
// @ts-expect-error the IR is read-only
component.name = "Y";
// @ts-expect-error all the way down
component.view[0] = node;
// @ts-expect-error the provenance keeps the file it is about
const noFile: ObixIrProvenance = { schema: "obix-dop-ir-provenance/1", frontend: { name: "vue", version: "1" }, origins: {}, imports: [] };
void [directiveKind, numericKind, located, withAst, call, power, global, objectLiteral, bare, stepKind, badPropType, badSchema, noFile];
`;
  const errors = typeErrors(source, path.join(PACKAGE, 'test', 'types.virtual.ts'));
  assert.deepEqual(errors, [], JSON.stringify(errors, null, 1));
});
