# obix-compiler-ir

> Previous name: `@obinexusltd/obix-compiler-ir` — OBIX packages are named without an npm scope since decision D-102 (2026-09-29); the package, its version and its exports are unchanged.

**The canonical DOP IR of OBIX** — the strongly typed, plain-data, **framework-neutral** representation that every syntax frontend lowers into, and the only semantic authority of OBIX (D-44).

```bash
npm install obix-compiler-ir
```

```text
   Vue frontend ──┐                                      ┌──►  native   (later)
                  ├──►  canonical OBIX DOP IR  ──────────┤
   React frontend ┘      (this package)                   └──►  hybrid   (later)
```

There is **no Vue node, no React node, no JSX node, no directive name and no runtime object** in an IR, and **no source location** either: where the source was is a separate document (`ObixIrProvenance`), keyed by the ids the nodes carry. This package *defines* the representation — types, closed vocabularies, a check, the canonical text, equality. It lowers nothing: that is [`obix-compiler-dop`](https://github.com/obinexus/obix-compiler-dop) for the Vue frontend, and the React frontend will lower into it independently.

```ts
import { checkIr, serializeIr, parseIr, irEqual, irDifferences, isIrIdentifier } from "obix-compiler-ir";
import type { ObixIrComponent } from "obix-compiler-ir";

checkIr(value);                  // [] — or one line per problem: "view[0].children[1].properties[0].value: local item is not in scope here"
isIrIdentifier(name);            // the names the IR carries: ASCII letters, digits, _ and $, not starting with a digit — what a frontend asks before it names something
const text = serializeIr(ir);    // canonical JSON: keys sorted at every level, no whitespace — the same bytes from any frontend
const again = parseIr(text);     // checked and deep-frozen
irEqual(a, b);                   // exactly when the canonical texts are equal
irDifferences(a, b);             // [{ path: "state[0].initial.value", a: 0, b: 1 }, …]
```

## What is in it

| Concept | IR | Notes |
|---|---|---|
| component | `ObixIrComponent` | `props`, `state`, `derived`, `actions`, `effects`, `dependencies`, `view`, `styles` |
| props | `ObixIrProp` | a type of a closed set (`string` `number` `boolean` `array` `object` `function` `unknown`), `required`, a constant `default` |
| state | `ObixIrState` | named values that change only by an `assign` step; the initial value is a constant |
| derived / computed | `ObixIrDerived` | a pure expression over props, state and other derived values — acyclic |
| actions / transitions | `ObixIrAction` | named, ordered steps: `assign` a state, `invoke` an action — no recursion |
| effects | `ObixIrEffect` | after any change, when the value it watches is no longer the one seen last (`Object.is`), run steps with (new, previous); not at the start |
| element | `ObixIrElement` | tag, fixed `attributes`, `properties` (bound), `accessibility`, `events`, `children` |
| text | `ObixIrText` | parts: `static` text and `display` of an expression |
| expression references | `ObixIrReference` | `prop` · `state` · `derived` · `local`; resolved by the frontend, never by the reader |
| attributes, property bindings | `ObixIrAttribute`, `ObixIrPropertyBinding` | a fixed string, or an expression evaluated with every view |
| events | `ObixIrEventBinding` | an event name and steps; the event payload (`event-payload`) is in scope in them and nowhere else |
| conditionals | `ObixIrConditional` | branches with conditions, and an `otherwise` that is `null` or not empty — one canonical form |
| iteration | `ObixIrIteration` | `source`, `item`, optional `index`, optional `key`, `body` |
| component invocation | `ObixIrInvocation` | a declared dependency, fixed and bound inputs, and `children`: contents for the invoked component's projections |
| children / slot projections | `ObixIrProjectionContent`, `ObixIrProjection` | content that fills a named projection (default: `default`, what React calls `children`), possibly with parameters; the outlet, with arguments and a fallback |
| styles metadata | `ObixIrStyle` | language, scope (`component` \| `global`) and the text — nothing is compiled |
| accessibility metadata | `ObixIrAccessibility` | `role`, `tabindex`, `alt`, `for` and every `aria-*` of an element, kept apart from its other attributes, fixed or bound, exactly as written (`isAccessibilityAttribute`) |
| source provenance | `ObixIrProvenance` | **a separate document**: node id → range, the frontend's name and version, the file, and every import as written |

Expressions are a small structured language over plain data — `literal` `array` `object` `reference` `event-payload` `member` `index` `unary` `binary` `logical` `choice` — with the meaning ECMAScript gives the operators on plain data (`+ - * / %`, `=== !==`, `< <= > >=`, `&& || ??`, `!`, unary `-` `+`). There is no call, no function, no assignment expression, no loose equality. A step list does the writing.

What a frontend's own names become is the frontend's business, and this is the point of the IR: `v-if` is a **conditional**, `v-for` an **iteration**, `@click` an **event binding** with `event: "click"`, `:disabled` a **property binding** named `disabled`, `<slot>` a **projection**; React's `cond && <X/>`, `items.map(…)`, `onClick={…}` and `props.children` are the same concepts and lower to the same nodes.

## What `checkIr` checks

* **Shape.** Every object has exactly the members of its kind, of the schema's types; a member the schema does not have is a problem — so no syntax tree, no location and no runtime object can ride along. A cyclic structure is a problem, not a crash.
* **Names.** Ids are non-empty and unique in the whole component; props, state, derived values, actions and dependencies share **one namespace** of identifiers.
* **Meaning.** A reference resolves; a local is in scope where it is written (action and effect parameters, an iteration's item and index, a projection content's parameters); the event payload exists only inside an event handler; `assign` writes a declared state; `invoke` calls a declared action; a state's initial value and a prop's default are **constants** — a literal, an array or object of constants, or **minus zero**, the negation of the literal 0, which is how the IR says `-0` (a literal cannot: the text of `-0` is `0`) and the only unary that is a constant; derived values are acyclic; actions do not invoke each other in a cycle; the accessibility attributes of an element are in `accessibility` and only they are, and no attribute is given twice on an element.

## Canonical text and equality

`serializeIr` writes JSON with the keys of every object sorted and no structural whitespace, and refuses an invalid IR (bytes of a wrong IR would only say the wrong thing reliably). `parseIr` reads it back, checks it and freezes it all the way down; the round trip is byte-stable. Two IRs are **equal exactly when their canonical texts are** — whichever frontend made them, in whichever order it created the keys. Provenance is not part of equality: two components that mean the same are equal whatever their sources.

## Dependency role

The only dependency is [`obix-compiler-diagnostics`](https://github.com/obinexus/obix-compiler-diagnostics), and for **types only** (`SourceRange`, in the provenance document): the built package imports nothing but its own modules. `obix-neutral.json` lists it as a **neutral contract** — graph rule R9 refuses any other dependency of any kind, and the Node-free import check applies to it although it lives in the compiler family. It is compile-time data; graph rule R5 keeps the compiler family out of every browser graph.

## Tests

`npm test -w obix-compiler-ir` — 63 tests: 44 written before the code, one for the rule of a name (`isIrIdentifier`: what the check and every frontend ask), and 18 (`test/exact.test.mjs`) that mutation testing asked for — tests that say only "a wrong IR has a problem that matches" let a checker stop looking at part of the IR without anybody noticing, so these say **exactly** which problems a small wrong component has, and check that nested scopes see what is outside them, that a shared value is not a cycle and a cycle is not a crash, and the edges of the provenance document: the closed vocabularies; `checkIr` on a hand-written component that uses every kind of the schema (`tests/vuets/ir-sample.mjs` (OBIX monorepo record)) and on 169 ways to be wrong; canonical serialization, byte-stable round trip, equality and differences; the provenance document and its separation from the IR; the framework-neutral vocabulary; and the declared types judged by TypeScript itself — exhaustive `switch` over every node and expression kind, and `@ts-expect-error` for every shape that must be refused (a directive name as a kind, a location, a call, a wrong operator).

<!-- obix-release:begin — generated by scripts/release/prepare.mjs; edit the text above this line -->

## Installation

```bash
npm install obix-compiler-ir
```

> **Not yet on npm.** The OBIX packages are prepared for publication and are published only on the owner's authorisation; until then this is the command the published package will answer to.

## API surface

- `obix-compiler-ir` — 25 value exports: `OBIX_IR_BINARY_OPERATORS`, `OBIX_IR_EXPRESSION_KINDS`, `OBIX_IR_FUNCTIONS`, `OBIX_IR_FUNCTION_ARITY`, `OBIX_IR_LOGICAL_OPERATORS`, `OBIX_IR_NODE_KINDS`, `OBIX_IR_PROP_TYPES`, `OBIX_IR_PROVENANCE_SCHEMA`, `OBIX_IR_REFERENCE_SCOPES`, `OBIX_IR_SCHEMA`, `OBIX_IR_STEP_KINDS`, `OBIX_IR_STYLE_SCOPES`, `OBIX_IR_UNARY_OPERATORS`, `checkIr`, `checkIrProvenance`, `irDifferences`, `irEqual`, `isAccessibilityAttribute`, `isIrIdentifier`, `migrateIrFromV1`, `migrateIrFromV2`, `parseIr`, `parseIrProvenance`, `serializeIr`, `serializeIrProvenance`
- Type declarations: `./dist/index.d.ts` (and a declaration next to every JS entry point).

## Architecture role

`obix-compiler-ir` is part of the **OBIX compiler** (build-time tooling): it never runs in an application's browser graph.

The architecture of OBIX — the package families and which packages are public API — is indexed in the umbrella: [docs/architecture.md](https://github.com/obinexus/obix/blob/main/docs/architecture.md).

## Package relationships

- Depends on (OBIX): [`obix-compiler-diagnostics`](https://github.com/obinexus/obix-compiler-diagnostics).
- Used by (OBIX): [`obix-compiler-dop`](https://github.com/obinexus/obix-compiler-dop), [`obix-compiler-react`](https://github.com/obinexus/obix-compiler-react).

## Testing

- 3 test files ship in the npm package (`test/`): they are the evidence of the package's contract, published so that its verification can be read — not runtime code (no entry point reaches them).
- Run them with `npm test` (`node --test "test/*.test.mjs"`) in the OBIX monorepo, which provides the test tooling (Node's test runner, TypeScript).
- 2 test files are in the repository but not in the npm package, because they use the monorepo's shared test harness, oracles or fixtures:
  - `test/exact.test.mjs` — reads ../../../tests/vuets/ir-sample.mjs, outside the package
  - `test/ir.test.mjs` — reads ../../../tests/vuets/ir-sample.mjs, outside the package

## Documentation

- [CHANGELOG.md](CHANGELOG.md)
- The OBIX architecture index: [obix/docs/architecture.md](https://github.com/obinexus/obix/blob/main/docs/architecture.md)

## Repository

- https://github.com/obinexus/obix-compiler-ir — `git@github.com:obinexus/obix-compiler-ir.git`
- Issues: https://github.com/obinexus/obix-compiler-ir/issues
- The repository is a clean export of the package from the OBIX monorepo; its lineage (the monorepo commit it was exported from, the sources it was recovered from, earlier names) is in `PROVENANCE.json`.

## License

MIT — see [LICENSE](LICENSE).

<!-- obix-release:end -->
