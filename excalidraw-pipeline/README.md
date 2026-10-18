# Isolated conversation-to-planning pipeline

The architecture and technical source of truth is
[`../docs/excalidraw.md`](../docs/excalidraw.md) for Steps 1–2 and
[`../docs/step3.md`](../docs/step3.md) for Excalidraw generation. This component
implements Steps 1–3 and runs independently of the existing TUI. Changes are contained in
this directory; it imports no application modules. The application now invokes
this component as a subprocess for `/draw`; React/runtime dependencies stay separate.
The readability extension adds presentation design after validated Step 2.
The final review is removed; output is just the two maps. The latest user-requested
fast-map amendment is recorded in `PRESENTATION.md`: decision projection is now
deterministic in the CLI and relationship-category checks are advisory.
The current display contract follows the user's simplified-map amendment in
[`PRESENTATION.md`](PRESENTATION.md), superseding the earlier exhaustive canvas.

## Run

Use Node.js 24. Install and run from this directory:

```sh
cd excalidraw-pipeline
npm ci
npm run pipeline
```

The default performs real model processing. Configure `OPENAI_API_KEY` locally
in this directory's `.env` file or your shell environment before running. The
npm script loads `.env` automatically when it exists. Without a key it saves a
failure report and makes zero calls.
There is no fixture-replay or prewritten-output fallback.

The default input is `fixtures/conversation.seed.json`, following the EventBus
format in `jacob/log_usage.txt`: `id`, `kind`, `text`, agent identity, and
optional user `replyTo`. You can also ingest the document's native
`ConversationInput` envelope with attributed, ordered messages:

```sh
npm run pipeline -- --input /absolute/path/to/conversation.json
npm run pipeline -- --prepare
```

The TUI integration uses `--session-file /path/to/session.json --progress-json`.
It ingests only the session envelope's `discussion.log` array, never its summary,
and saves that immutable input snapshot in the new run folder. Machine-readable
`I4S_DRAW` stderr events report the output directory and each actual request start
so the parent UI can display progress and enforce the shared session call budget.
The parent pauses discussion before saving/launching and does not resume it automatically.

`--prepare` saves inputs, schemas, and the Step 1 prompt without a model call.
`--out /path/to/parent` changes the run parent. `--model <model-id>` overrides
the default `gpt-6-luna`. All calls use low reasoning effort. `--spec` can explicitly select another location of the
architecture document; the default always reads the original `docs/excalidraw.md`.
Each run records that file's path and SHA-256 hash.

Normal CLI processing uses three calls: extraction/reconciliation, implementation
inference, and presentation design. Step 2 projects recorded decisions/options
directly from canonical knowledge without a model call; neither builder consumes
the other graph. The library still supports the original model decision-builder mode.
The planning budget remains five as an upper bound. Only blocking implementation
errors can receive one constrained regeneration. Step 1 failures can also receive
one repair, reserving the implementation call. Normal cached-extraction runs use
two calls, not three. No semantic validation/judge model pass is added.
Presentation has one separate call with a 10,000-token ceiling and no retries.
Presentation brevity is a prompt target; generous safety limits prevent runaway text,
and card sizing follows the actual text. Mixed/open cards are automatically displayed
as notes rather than rejected. Text is never truncated by the renderer.
There is no final-review call. The full pipeline has a six-call maximum.
Only failed builders are retried, independently; repair never bypasses validation.
The TUI passes `--reuse-extraction`: an unchanged snapshot can reuse Step 1 from
the 20 most recent runs in the same output parent. Reuse requires the exact
conversation, specification hash, model, extraction schema and a passing saved
report; the knowledge is also fully revalidated against the current conversation.
Invalid or incomplete candidates fall back to normal extraction. Step 2 still
builds both graphs independently, and each invocation writes a new run folder.
Standalone runs opt in with `--reuse-extraction --out <same-run-parent>`.
`step1.reuse.json` records the source run. `timings.json` records total elapsed time,
per-request durations, HTTP statuses and API token counts when available; no keys
or raw API error bodies are saved. Prompts request compact JSON to reduce output
overhead without dropping evidence or graph content. Provider schemas share repeated
definitions through `$defs`/`$ref`, avoiding repeated ID enums exceeding API limits;
authority, source-reference, actual endpoint-ID and cycle checks remain hard guards.
Implementation repair uses a run-specific schema that fixes node identities and
restricts edge endpoints to existing node IDs, including canonical relationship references
only for matching endpoints and directions. These constraints also apply when node
origin or status fails at the same time. Only nodes implicated in reference/provenance
errors may change their primary reference. All repairs require final validation.
Repairs preserve every original node and freeze statuses except where a reported
status/approval error requires correction. Direct representations of adopted entities,
confirmed requirements and selected proposals must remain confirmed. The constrained
repair schema is validated locally as well as supplied to the model; a provenance or
edge repair cannot silently relabel approved milestones/tests as suggestions.
Each call has a 32,768-token completion ceiling
and five-minute timeout. The adapter uses strict structured output schemas;
optional nullable wire fields normalize to absent canonical fields. There are no
unbounded retries or extra semantic-auditor repair calls. Agent messages without annotation
evidence produce review warnings; these detect possible omissions, not proof that
every message requires an annotation. Extraction explicitly reviews every agent message.

## Architecture

| Responsibility                                                         | Implementation                                |
| ---------------------------------------------------------------------- | --------------------------------------------- |
| Domain contracts and runtime schemas                                   | `src/contracts/domain.ts`, `src/contracts.ts` |
| Ordered input adaptation and validation                                | `src/conversation.ts`                         |
| Extraction, independent builders, and stage orchestration              | `src/finalOrchestrator.ts`                    |
| Canonical decision projection (no model)                                | `src/step2/buildDecisionGraph.ts`             |
| Compact model-only context views                                        | `src/modelContext.ts`                        |
| Canonical reconciliation and source/authority validation               | `src/step1/`                                  |
| Annotation/cross-graph linking, graph reconciliation, final validation | `src/step2/`                                  |
| Standalone file input/output and dependency wiring                     | `src/cli.ts`                                  |

`FinalOrchestrator` exposes `extractConversation`, `buildPlanningGraphs`, and
`processConversation` following §5.3. Contracts and deterministic operations are
independent of the provider adapter.

### What the models receive

All model calls also receive a strict output schema. The models do not receive
TUI state, unrelated sessions, credentials or an entire repository.

| Model call | Context |
| --- | --- |
| Step 1 extraction | Entire ordered, attributed conversation snapshot and the short Step 1 prompt contract from the architecture |
| Step 2 implementation | Short builder contract, canonical objects/current states, constraints, requirements, agent views/conditions, relationships and approved-object IDs |
| Step 3 presentation | Non-group implementation items, recorded decisions, candidate directed edges and compact canonical knowledge |

Later calls omit raw transcript copies, source excerpts/citations and decision-history
audit records. Presentation also omits option/group nodes, duplicate annotation lists
and cross-link indexes. No canonical facts, current dispositions, hard constraints or
expressed agent conditions are removed from knowledge context; full originals stay
in `knowledge.json` and the input snapshot. There is no lossy extra summarizer call.
The deterministic decision projection makes no request at all.

Relation-type matrices and implementation subtype classifications produce warnings,
not another generation pass. Known relationship IDs accidentally placed in object-ID
lists are expanded mechanically; unsupported optional relationship attribution is
removed and the edge kept explicitly as planner inference. Truly unknown objects,
missing endpoints, invalid decision membership, real cycles and unsupported declared
commitments remain errors. Only those errors can trigger the bounded repair.

Step 1 extracts objects, annotations, and relationships together. Semantic
identity and chronological interpretation happen in the extraction call. Its
internal `objectRedirects` sidecar declares supported candidate-to-canonical
identity mappings; canonical output retains the document's knowledge-graph schema.
Local reconciliation resolves redirect chains, merges compatible records,
remaps references, resolves authoritative decision history, deduplicates
relationships, and orders records stably. Invalid or ambiguous mappings block
progress. All claims keep transcript evidence; Step 1 creates no new plan details.
Extraction explicitly retains individually described user-approved milestones and
verification tasks as adopted task entities, without promoting unapproved sub-details.

Step 1 validation gates both Step 2 builders. Each builder reads only the same
canonical knowledge graph and produces its own nodes/internal edges with empty
annotation references. Planning additions carry honest origin/status and
knowledge justifications. Single-choice decisions are the default; explicitly
supported multiple selections use the extension described in §1.1.3.

The implementation builder actively fills in useful architecture mechanics rather
than merely listing discussed technologies: interfaces, persistence/migration work,
transaction/concurrency boundaries, recovery, deployment wiring and verification.
Mandatory consequences of confirmed requirements or accepted decisions may be `planner_derived/confirmed`;
optional design recommendations remain `planner_suggested/proposed`. Additional detail
cites its motivation as justification, not a primary reference borrowed to imply approval.
Unknown providers and unchosen named technologies stay unresolved. Nonsoftware plans
receive appropriate workflow/handoff elaborations instead. The Decision Map still
contains only actual discussion decisions, and the renderer still groups the detailed
plan into two maps. No new model stages, dependencies or call-budget increases are added.

Step 2 follows the required sequence: link annotations and cross-graph references,
reconcile duplicate canonical graph roles and edges, relink after repairs, then
validate the completed result. Hard checks cover references and actual endpoint IDs,
selection fidelity, provenance, containment/dependency cycles, annotation
associations, cross-link indexes, and represented conflicts with authoritative
requirements/constraints.
Reconciliation merges canonical entity identities, not all planning items sharing
a broad proposal or requirement. Distinct milestones/tasks retain their identities;
only exact title-and-description copies merge when the source is not a canonical
entity. This preserves ordering without weakening dependency-cycle validation.

## Run artifacts

Every invocation with valid input creates a unique `runs/<timestamp>-<suffix>/`:

- `input.log.json`, `conversation.json`: original input and normalized snapshot.
- `run.json`, `schemas.json`: request configuration, architecture hash, and contracts.
- `step1.response.json`, `step1.reconciliation.json`, `step1.validation.json`.
- `knowledge.json`: validated canonical source, saved only when Step 1 passes.
- `step2.decision.*`, `step2.implementation.*`: independent prompts and responses.
- `step2.validation.json`: validation of the completed linked/reconciled graphs.
- `step2.candidate.json`: linked/reconciled candidate, reconciliation details and report,
  including on semantic validation failure. `validated: false` is diagnostic, not a usable handoff.
- `step2.initial.*`: original linked candidate/report when repair is needed.
- `step2.<kind>.repair.*`: optional repair prompt/response; the original response is preserved.
- `result.json`: the `FinalOrchestratorResult` with separate stage reports.
- `step2.json`: the final `Step2Result`, including planning graphs on success.
- `project-plan.excalidraw`: one editable scene with Decision and Implementation maps.
- `terminal-maps.json`: versioned text projection of the actual rendered cards,
  canonical states/outcomes and bound arrows, used by the terminal viewer. No extra
  model interpretation or model call is used for this projection.
- `step3.presentation.prompt.txt`, `step3.presentation.schema.json`,
  `step3.presentation.response.json`, `step3.presentation.json`: presentation prompt,
  coverage contract, raw response and validated display plan.
- `step3.json`: saved file path, element count and display warnings, or export error.
- `step3.reuse.json`: source run/artifact and successful revalidation for reused presentations.
- `completion.json`: completed/prepared/failed status and call count.

A Step 1 failure starts no Step 2 calls and produces no `step2.json`. A Step 2
failure returns the document's structured validation failure without a
`planningGraphs` field. Responses and successful sibling artifacts remain
available for inspection. Preparation runs contain no generated results.

The CLI prints `Plan saved: <absolute-path>` after successful export and progress
to stderr. The Step 2 JSON is still saved as `step2.json`.
Canonical knowledge is saved separately; neither planning graph embeds a copy.

To redesign an existing successful run with one presentation call (without
repeating extraction or planning):

```sh
npm run pipeline -- --render-run runs/2026-10-18T02-56-49.045Z-0Jx9h6
```

This creates a new run folder with copied planning inputs, presentation artifacts,
`project-plan.excalidraw`, and `step3.json`. Existing runs are never overwritten.
Open the `.excalidraw` file in Excalidraw to edit it.

To apply renderer/style updates using an existing `step3.presentation.json`, use
`--render-run runs/<saved-run> --reuse-presentation`. This makes zero model calls
and needs no key. Saved simplified presentations from versions 2–5 are supported:

```sh
npm run pipeline -- --render-run runs/<saved-run> --reuse-presentation
```

This preserves the saved nodes/grouping/arrows, drops old agent comments and
review sections, and writes a separate new run folder without any model calls.
Older run files are never changed. `--review-only` and `--comments-only` are removed.
If the validated presentation is absent, reuse tries the saved raw
`step3.presentation.response.json` and fully validates it before export. Invalid
raw candidates still fail; no model calls or validation bypasses are introduced.
To use the original exhaustive layout without presentation inference,
use `--deterministic` (also supported on normal pipeline runs).

Step 3 exposes `buildExcalidrawScene` and `exportExcalidraw` from `src/process.ts`.
The version 5 presentation model groups related source items into fewer cards,
each with a description and an optional brief reason. Agent summaries, placeholders
and final-review findings are removed. All decisions and non-group implementation items retain private source
coverage; options are expressed inside decision cards instead of separate boxes.
For model generation only, a required `sourceAssignments` object assigns each source
ID to one card (`c1`–`c12`). This prevents missing/repeated coverage across card
arrays. Code converts those assignments to the same version 5 `sourceNodeIds`
arrays and applies all existing coverage/status/evidence checks. Raw responses keep
the assignment format; `--reuse-presentation` can validate and convert them too.
The presentation prompt omits source excerpts and redundant cross-link indexes,
which remain in the canonical run files; no extra model pass is introduced.
Main-flow cards cannot merge different commitment states. Related mixed-status
items may share a note card, with each item's canonical status explicitly displayed
and neutral open-note styling. IDs, provenance, support badges and
annotation catalogs are not printed. Full evidence remains in the source JSON.

Chosen decision cards form a vertical reading path; the arrows indicate reading
order, not chronology or dependencies. Open/deferred decisions remain separate
notes. Implementation arrows are plain arrows with optional free-form, short
natural-language captions, never mandatory enum labels. The model selects source
edge IDs and writes captions; code derives their original directed endpoints after
grouping, removing a source of endpoint-generation failures. Redundant edges can be
omitted from the canvas, not from the source graph. Implementation placement uses
ELK, accounting for card text and arrow captions. There is no connection register
or node directory: the file contains only the two maps and their compact notes.

The style uses native Excalifont handwriting, rough pen strokes, pastel note fills,
light dashed map boundaries and small deterministic offsets. This hand-drawn
appearance does not randomize graph semantics or sacrifice node spacing.
The headless native JSON adapter is pinned to Excalidraw 0.18.1; official helpers
do not import in Node 24 because of browser/dependency assumptions. ELK.js 0.12.0
also supports the implementation-map layout.

### Online editing (link only)

All runs save `edit.html`: open it to load both maps into excalidraw.com for
editing. This uses Excalidraw's URL-fragment data importer, not a sharing-service
upload. Only visual elements are included (no internal provenance metadata or raw
conversation); the browser app can read the drawing and history may retain the URL.
The local `.excalidraw` remains unchanged. Manual native-file import is the fallback.

The TUI posts “Go online to edit” inside the chat. Its short, tokenized loopback
HTTP link opens the saved handoff in your browser instead of opening HTML source
in an IDE. This local listener serves only generated drawings and closes with the
TUI; no hosted service or arbitrary-file endpoint is added. No text map, terminal
image protocol, PNG export, or browser process runs during generation.
Standalone runs print the saved local edit-file link:

```sh
npm run pipeline
npm run pipeline -- --render-run runs/<saved-run-folder> --reuse-presentation
```

Reusing a saved presentation creates a new run without model calls. The link
requires no browser installation or additional dependencies during generation.
Previously generated PNGs and other old run artifacts are left untouched.

Inspect an existing run using the current deterministic linker and validator without
any model calls or changing its original files:

```sh
npm run audit-run -- runs/<saved-run-folder>
```

This creates a separate `*-audit-*` run folder. Builder `*.response.json` files
intentionally contain empty annotation arrays; inspect the linked candidate or the
successful `step2.json` instead. Annotation text remains in `knowledge.json` and is
referenced by ID. Nodes without relevant canonical annotations can legitimately
have empty lists; the linker never manufactures opinions or traverses multiple hops.

## Verification

```sh
npm run check
```

Automated tests use fake providers and test-only expected model responses.
They cover all entity subtypes, choice revisions, ambiguous acceptance,
unresolved choices, semantic-identity redirects, negative scope, agent attribution,
nonsoftware planning, independent builders, bounded calls, safe graph repair,
post-link validation, and provider failures. No API credits are used in tests.

Rendering fixtures come from the successful seeded run (11 decision nodes,
16 implementation nodes, 15 canonical annotations and 10 knowledge relationships).
The pasted-text attachments named in `docs/step3.md` are absent from this checkout;
their stated 14-annotation count is not substituted for the 15 actual records.
`excalidraw-0.18.1.excalidraw` was produced by the official conversion helpers.
The import integration test bundles the installed Excalidraw package and opens the
generated file in headless Chrome, then checks native box/text/connector editing.
It uses the installed Chrome on macOS, or `EXCALIDRAW_TEST_CHROME` elsewhere; without
an available browser that integration check is explicitly skipped. It may need
permission to launch Chrome in a sandboxed environment.

Model interpretation still requires evaluation on live responses. Structural
validation cannot prove that a passage supports a semantic claim; the document's
optional model-based semantic auditor is not enabled. Unknown identity or
contradictory structural evidence is reported rather than silently repaired.
