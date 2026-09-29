/**
 * C2 — component interaction, a neutral concept of the IR (docs/recovery/vuets-compiler.md §23): what Vue writes `emit('select', id)` / `@select="choose"` and React
 * writes `onSelect(id)` / `onSelect={choose}` is, in the IR, one thing in three parts — none of them named after a framework:
 *
 *   outputs        on a component: the channels on which it tells its invoker that something happened, and the type of what it tells (`payload`, null for nothing);
 *   the `output` step   tell the invoker, on a channel, a value — synchronously, as Vue's emit and a React callback are;
 *   interactions   on an invocation: the invoker's steps for a channel, run with the value told as the event payload — as an element's event binding is.
 *
 * The shape of the IR changes — a component has `outputs`, an invocation `interactions`, a step may be an `output` — so the schema is `obix-dop-ir/2`, by the IR's own
 * rule ("a change that breaks a consumer changes the number"); `migrateIrFromV1` takes a /1 document to /2.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { OBIX_IR_SCHEMA, OBIX_IR_STEP_KINDS, checkIr, irEqual, migrateIrFromV1, parseIr, serializeIr } from '../dist/index.js';

const lit = (value) => ({ kind: 'literal', value });
const local = (name) => ({ kind: 'reference', scope: 'local', name });
const PAYLOAD = { kind: 'event-payload' };
const base = (over = {}) => ({ schema: 'obix-dop-ir/3', kind: 'component', id: 'component', name: 'Demo', props: [], state: [], derived: [], outputs: [], actions: [], effects: [], dependencies: [], view: [], styles: [], ...over });

/** The child: two outputs, told from an action and from an element's event. */
const CHILD = base({
  name: 'Selector',
  outputs: [
    { id: 'outputs.select', channel: 'select', payload: 'string' },
    { id: 'outputs.start', channel: 'start', payload: null },
  ],
  actions: [{ id: 'actions.pick', name: 'pick', parameters: ['id'], steps: [{ kind: 'output', id: 'actions.pick.steps.0', channel: 'select', value: local('id') }] }],
  view: [
    {
      kind: 'element', id: 'view.0', tag: 'button', attributes: [], properties: [], accessibility: { attributes: [], properties: [] },
      events: [{ id: 'view.0.events.0', event: 'click', steps: [{ kind: 'output', id: 'view.0.events.0.steps.0', channel: 'start', value: null }] }],
      children: [],
    },
  ],
});

/** The invoker: its steps for the child's `select`, the payload in scope. */
const PARENT = base({
  name: 'Main',
  state: [{ id: 'state.chosen', name: 'chosen', initial: lit('') }],
  actions: [{ id: 'actions.choose', name: 'choose', parameters: ['id'], steps: [{ kind: 'assign', id: 'actions.choose.steps.0', target: 'chosen', value: local('id') }] }],
  dependencies: [{ id: 'dependencies.Selector', local: 'Selector', specifier: './Selector', export: 'default' }],
  view: [
    {
      kind: 'invocation', id: 'view.0', component: 'Selector', attributes: [], properties: [], children: [],
      interactions: [{ id: 'view.0.interactions.0', channel: 'select', steps: [{ kind: 'invoke', id: 'view.0.interactions.0.steps.0', action: 'choose', arguments: [PAYLOAD] }] }],
    },
  ],
});

test('the schema is current — obix-dop-ir/3 since C3 — and since /2 a step may be an output', () => {
  assert.equal(OBIX_IR_SCHEMA, 'obix-dop-ir/3');
  assert.deepEqual([...OBIX_IR_STEP_KINDS], ['assign', 'invoke', 'output']);
});

test('a component with outputs, told from an action and from an event, and an invoker with an interaction, are valid IR — canonical, and round-trip', () => {
  assert.deepEqual(checkIr(CHILD), []);
  assert.deepEqual(checkIr(PARENT), []);
  for (const ir of [CHILD, PARENT]) assert.ok(irEqual(parseIr(serializeIr(ir)), ir));
});

test('outputs: a channel is an identifier, declared once; its payload is a type of the IR, or null for nothing', () => {
  const problems = checkIr(base({ outputs: [{ id: 'outputs.a', channel: 'select-it', payload: 'string' }, { id: 'outputs.b', channel: 'go', payload: 'thing' }, { id: 'outputs.c', channel: 'go', payload: null }, { id: 'outputs.d', channel: 'x', payload: null, extra: 1 }] }));
  assert.deepEqual(problems, [
    'outputs[0].channel: must be an identifier',
    'outputs[1].payload: must be one of string, number, boolean, array, object, function, unknown — or null',
    'outputs[2].channel: go is declared twice (a component has one output of a channel)',
    'outputs[3].extra: is not a member of an output',
  ]);
});

test('an output step tells on a channel the component declares; a value only on a channel with a payload', () => {
  const told = (steps) => checkIr(base({ outputs: [{ id: 'outputs.select', channel: 'select', payload: 'string' }, { id: 'outputs.start', channel: 'start', payload: null }], actions: [{ id: 'actions.a', name: 'a', parameters: [], steps }] }));
  assert.deepEqual(told([{ kind: 'output', id: 'actions.a.steps.0', channel: 'nope', value: null }]), ['actions[0].steps[0].channel: nope is not a declared output']);
  assert.deepEqual(told([{ kind: 'output', id: 'actions.a.steps.0', channel: 'start', value: lit(1) }]), ['actions[0].steps[0].value: start has no payload: the value must be null']);
  assert.deepEqual(told([{ kind: 'output', id: 'actions.a.steps.0', channel: 'select', value: null }]), [], 'a channel with a payload may be told nothing: its handler reads undefined');
  assert.deepEqual(told([{ kind: 'output', id: 'actions.a.steps.0', channel: 'select', value: local('x') }]), ['actions[0].steps[0].value: local x is not in scope here']);
  assert.deepEqual(told([{ kind: 'output', id: 'actions.a.steps.0', channel: 'select' }]), ['actions[0].steps[0].value: is required']);
});

test('an interaction: the channel is an identifier, once per invocation; its steps see the payload, and what they invoke must be declared', () => {
  const invocation = (interactions) => base({
    actions: [{ id: 'actions.choose', name: 'choose', parameters: ['id'], steps: [] }],
    dependencies: [{ id: 'dependencies.C', local: 'C', specifier: './C', export: 'default' }],
    view: [{ kind: 'invocation', id: 'view.0', component: 'C', attributes: [], properties: [], children: [], interactions }],
  });
  assert.deepEqual(checkIr(invocation([{ id: 'view.0.interactions.0', channel: 'select', steps: [{ kind: 'invoke', id: 'view.0.interactions.0.steps.0', action: 'choose', arguments: [PAYLOAD] }] }])), []);
  assert.deepEqual(
    checkIr(invocation([
      { id: 'view.0.interactions.0', channel: 'on-select', steps: [] },
      { id: 'view.0.interactions.1', channel: 'pick', steps: [{ kind: 'invoke', id: 'view.0.interactions.1.steps.0', action: 'missing', arguments: [] }] },
      { id: 'view.0.interactions.2', channel: 'pick', steps: [] },
    ])),
    ['view[0].interactions[0].channel: must be an identifier', 'view[0].interactions[1].steps[0].action: missing is not a declared action', 'view[0].interactions[2].channel: pick is given twice'],
  );
  // the payload is in scope in an interaction, and not in an action
  assert.deepEqual(checkIr(base({ actions: [{ id: 'actions.a', name: 'a', parameters: [], steps: [{ kind: 'invoke', id: 'actions.a.steps.0', action: 'a', arguments: [PAYLOAD] }] }] })).filter((p) => /payload/.test(p)), ['actions[0].steps[0].arguments[0]: the event payload exists only inside an event handler']);
});

test('a /1 document is not a /2 one — and migrateIrFromV1 makes it one: no outputs, and no interaction on any invocation', () => {
  const v1 = { ...PARENT, schema: 'obix-dop-ir/1' };
  delete v1.outputs;
  v1.view = [{ ...PARENT.view[0], interactions: undefined }];
  delete v1.view[0].interactions;
  assert.ok(checkIr(v1).includes('schema: must be obix-dop-ir/3'));
  const v2 = migrateIrFromV1(v1);
  assert.deepEqual(checkIr(v2), []);
  assert.deepEqual([v2.schema, v2.outputs, v2.view[0].interactions], ['obix-dop-ir/3', [], []]);
  assert.ok(Object.isFrozen(v2));
  assert.throws(() => migrateIrFromV1(PARENT), /migrateIrFromV1: not an obix-dop-ir\/1 IR/);
  assert.throws(() => migrateIrFromV1({ ...v1, view: [{ kind: 'nonsense' }] }), /migrateIrFromV1: the migrated IR is not valid/);
  // the document given is not changed: the migration is a copy
  assert.equal('interactions' in v1.view[0], false);
  assert.equal('outputs' in v1, false);
});

test('an output, an output step and an interaction are records with ids of their own: an id is a non-empty string, used once in the component', () => {
  const invocation = (interactions) => base({
    dependencies: [{ id: 'dependencies.C', local: 'C', specifier: './C', export: 'default' }],
    view: [{ kind: 'invocation', id: 'view.0', component: 'C', attributes: [], properties: [], children: [], interactions }],
  });
  assert.deepEqual(checkIr(base({ outputs: [1] })), ['outputs[0]: must be an output object']);
  assert.deepEqual(checkIr(invocation(['select'])), ['view[0].interactions[0]: must be an interaction object']);
  assert.deepEqual(checkIr(base({ outputs: [{ id: '', channel: 'start', payload: null }] })), ['outputs[0].id: must be a non-empty string']);
  assert.deepEqual(checkIr(invocation([{ id: 'view.0', channel: 'select', steps: [] }])), ['view[0].interactions[0].id: view.0 is used twice']);
  const told = checkIr(base({ outputs: [{ id: 'outputs.start', channel: 'start', payload: null }], actions: [{ id: 'actions.a', name: 'a', parameters: [], steps: [{ kind: 'output', id: 'outputs.start', channel: 'start', value: null }] }] }));
  assert.deepEqual(told, ['actions[0].steps[0].id: outputs.start is used twice']);
});
