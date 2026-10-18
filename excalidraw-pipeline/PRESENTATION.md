# Simplified maps only

## Link-only handoff amendment

The TUI displays only a clickable “Go online to edit” link, not text cards,
PNG previews, or an embedded editor. Terminal image protocols, PNG export, browser
launch during generation, and the added bundler dependency have been removed.
All successful runs write `edit.html`; the original editable `.excalidraw` remains
the primary artifact. No planning/interpretation/model pass is added. All prior
stage boundaries remain. Old run artifacts are retained, not rewritten or deleted.

“Go online to edit” is posted as a structured system link inside the chat, not a
separate completion screen. The TUI opens a short tokenized loopback HTTP link
because IDE terminals may treat file:// HTML links as source files. The local
listener serves only that handoff and its native drawing download and closes with
the TUI. The handoff then uses excalidraw.com's existing
`#url=data:application/json;base64,…` importer. No hosted sharing backend,
browser editor component, or raw transcript upload is added. The online payload
omits internal `customData`; source JSON and native saved scene remain unchanged.
The URL fragment is readable by the browser app and may remain in browser history.
The handoff includes a manual file-import fallback; online edits are not synced back.

## Map semantics

The latest user requirements supersede exhaustive rendering, eight mandatory
color-agent comments, and the final review. All changes stay in this component.
`docs/excalidraw.md` still governs extraction, authority and canonical planning data.
The latest user-requested fast-map amendment below supersedes the baseline's
LLM-only decision builder and blocking endpoint-type matrix, not its authority rules.
The latest implementation-planning amendment requests more ambitious grounded
inference, not more user decisions: Step 2 may add concrete mechanics and optional
recommendations with honest origins/statuses. Approved work must not be downgraded
during repair. Step 1 remains descriptive, and the canvas remains just two maps.

- Keep the sketch-style Decision Map and Implementation Map, with descriptive
  grouped cards. Do not draw every option, record, organizer or annotation separately.
- Chosen decisions form a linear reading path, with brief recorded tradeoffs.
  Keep open/deferred choices separate. Arrows guide reading, not chronology.
- Implementation arrows have optional natural-language captions. Code derives
  endpoints/direction from selected source relationships, collapsing internal and
  parallel arrows after grouping.
- Do not print IDs, provenance, support badges, per-node comments, agent summaries,
  empty placeholders or review findings. Full evidence stays in the source JSON.
- All source decisions/non-group implementation items remain covered once. Main-flow
  cards must share a commitment state. Code automatically converts mixed/open
  cards into notes: the renderer labels each source item with its canonical state and uses
  neutral open-note styling, never a shared confirmed badge.
- Keep canonical authority, evidence, valid references, selection and cycle checks intact.
  Structural validation cannot prove that generated prose is faithful to evidence.

Version 5 presentation contains only the two map objects, each with heading, ordered
nodes and selected source edges. There is one presentation call after validated
Step 2; no final-review call, output or rendering code. Three normal CLI calls total;
six maximum with the shared five-call planning budget and one presentation call.

## Fast-map amendment

- Step 2's two views still depend only on canonical Step 1, never each other.
  The CLI projects all recorded decisions/options deterministically; the implementation
  builder remains an LLM. Decision grouping and readable prose are designed in the
  existing presentation call. No new validation/review model pass is added.
  The library retains its model decision-builder mode for compatibility.
- Relation endpoint-type matrices, implementation subtype labels, multiple containment
  parents and duplicate provenance classifications are advisory, not export blockers.
  Real cycles, missing endpoints/objects, invalid decision membership, false commitments
  and fabricated canonical annotations remain blocking or are replaced by deterministic
  canonical annotation resolution. Unknown object IDs are never silently invented.
- Selected technologies may directly represent an authoritatively selected proposal;
  extraction does not have to duplicate every selection as a separate technology entity.
- Safe reconciliation expands known relationship citations placed in object-reference
  arrays to their existing object endpoints. Unsupported optional relationship attribution
  is removed and the connection explicitly labeled planner inference. Raw drafts and
  every correction/advisory are retained in the run artifacts.
- Prompts contain short stage-specific architecture contracts, not whole document parts.
  Builders receive compact canonical facts/current states/agent views, not source excerpts
  or full historical audit records. Presentation receives only relevant graph nodes/edges
  plus compact knowledge, not option/group nodes or cross-link indexes. Full originals
  remain in saved JSON; the extraction model still receives the entire ordered conversation.
- Presentation additionally receives only canonical decisions/proposals and recorded
  agent reasons/conditions alongside the validated display nodes/edges. Duplicate
  implementation entity records, relationship tables and graph-node justification
  arrays remain in full saved/validated artifacts, not in the designer prompt. All
  canonical status, coverage and evidence checks still use the original full data.
- Text brevity is a prompt target, with generous safety bounds and text-aware sizing.
  Mixed/open cards become notes automatically instead of rejecting an otherwise valid map.
  Canonical statuses and source coverage are preserved; text is never truncated by code.

The model-only wire format uses a required `sourceAssignments` mapping (each
source ID → exactly one card ID) instead of repeated per-card source arrays.
Code converts this to the same canonical version 5 presentation and fully validates
it before rendering. This is a structural coverage safeguard, not new planning
inference, an additional call, or permission to omit or duplicate sources.

`--reuse-presentation` upgrades saved versions 2–4 without API calls: it preserves
map descriptions/grouping/arrows and removes old comment/review sections. It also
renders current version 5 plans. Every invocation writes a new output folder and
leaves the original run untouched.
If a failed run has only `step3.presentation.response.json`, reuse fully validates
that raw candidate before rendering. Invalid candidates still fail without model calls.
