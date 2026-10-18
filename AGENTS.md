# Shared repository guidance

## Project context

The Idiots is a local TypeScript terminal app using React and Ink. Four agents share a discussion; there is no hosted backend. The TUI and plain transcript use the same working engine, with brief exchanges of at most six public agent messages per user submission. Character identities come from `src/assets/README.md`.

## Development

- Use Node.js 24 and npm. Install a fresh checkout with `npm ci`.
- Commit `package-lock.json` with dependency changes. Do not hand-edit it or add other package-manager lockfiles.
- Run `npm run check` before handing off changes. Report any checks that could not run and why.
- Use `npm run dev` for interactive verification. Watch mode restarts the process and resets in-memory state.
- Keep changes focused. Do not add dependencies or abstraction layers without a concrete need.

## Code boundaries

- `src/cli.tsx`: arguments, startup/shutdown, and dependency wiring.
- Use `.tsx` for JSX and `.ts` otherwise. Use `.js` extensions in relative ESM imports and `import type` for type-only dependencies.

## Behavior to preserve

- The room has four modes: initial prompt, running, awaiting user, and paused. Agent activity is separate; changing speakers does not change room mode.
- Discussions persist across brief exchanges. Proposal selection is optional; do not reintroduce mandatory rounds or selection gates.
- Agents share the conversation context. Distinguish user constraints from assumptions; do not require a formal brief or consensus before chatting.
- Agents ask substantive questions. An explicit `ask_user` pauses for a response; rhetorical questions do not.
- User input takes priority. Preserve the queue and pending question across pauses, then review stale intentions before speaking.
- Paused and awaiting-user modes start no new model calls or speaking turns. Respect hard usage budgets, including background calls.
- Avatars are hand-drawn assets. Animation runs locally and must not trigger model calls. Keep names and status text readable without color or animation.

## Verification and repository hygiene

- Test meaningful and behavior changes with concise and key deterministic tests and fake model providers. Do not spend API credits in automated tests.
- For interaction changes, also verify in a real terminal; piped subprocess tests cannot prove keyboard or rendering behavior.
- Keep credentials, local sessions, `node_modules/`, and `dist/` out of Git. Never place API keys in source, fixtures, or logs.
- Keep `AGENTS.md` shared and concise. Put personal editor preferences in local configuration.
