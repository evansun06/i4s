# Development setup

The Idiots is one local Node.js application. Ink renders its React terminal UI; the discussion engine, model adapters, and persistence run in the same process. There is no hosted backend to start.

## First run

Use Node.js 24 and npm. `.nvmrc` selects the supported major version if you use nvm.

```sh
nvm use
npm ci
npm run dev
```

Skip `nvm use` if Node 24 is already installed. The current app is a development shell showing the four characters' names and perspectives. Press `q` or Ctrl+C to quit. It does not make model calls, accept topics, or implement a discussion yet.

`package.json` declares dependencies and commands. `package-lock.json` records the exact resolved dependency tree and is committed alongside it. Use `npm ci` for fresh checkouts and CI. Use `npm install` when intentionally changing dependencies, and commit the updated lockfile. Let npm generate the lockfile; do not hand-edit it or introduce a second package manager's lockfile.

Run `npm run check` before pushing. Shared coding-agent guidance lives in [AGENTS.md](AGENTS.md); product and state-machine decisions live in `docs/`.

## Daily commands

| Command                | Purpose                                                                                            |
| ---------------------- | -------------------------------------------------------------------------------------------------- |
| `npm run dev`          | Run TypeScript directly in the terminal.                                                           |
| `npm run dev:watch`    | Restart the app when source files change. This resets in-memory state; it is not React hot reload. |
| `npm run typecheck`    | Check TypeScript without writing JavaScript.                                                       |
| `npm run lint`         | Check code correctness, async handling, and React hook usage.                                      |
| `npm run lint:fix`     | Apply automatic ESLint fixes.                                                                      |
| `npm run format`       | Format source and configuration with Prettier. Existing design docs are excluded.                  |
| `npm run format:check` | Check formatting without changing files.                                                           |
| `npm test`             | Build and run CLI smoke tests with Node's test runner.                                             |
| `npm run check`        | Run type checking, linting, formatting checks, and tests.                                          |
| `npm run build`        | Compile into `dist/`.                                                                              |
| `npm start`            | Run the compiled app after building.                                                               |
| `npm pack --dry-run`   | Inspect what would be included in a distributable package.                                         |

TypeScript catches type errors. ESLint checks code patterns, including unhandled promises. Prettier handles formatting. `tsx` runs TS/TSX during development without a separate build, but does not replace type checking. Production builds use `tsc`; this app does not need a browser bundler.

For VS Code, install the ESLint and Prettier extensions, enable formatting on save, and select the workspace TypeScript version. `.vscode/` settings are local and ignored by Git. Other editors can run the same npm scripts.

## Code separation

Start with one package. The following layout distinguishes existing files from directories to create as their features arrive:

```text
src/
  cli.tsx                 # Entry point: arguments, terminal checks, startup/shutdown
  ui/
    app.tsx               # Ink root; rendering and keyboard interaction
  core/
    types.ts              # Shared room/agent vocabulary
  agents/
    panel.ts              # Four agent definitions
  providers/              # Planned: model adapters and streaming/cancellation
  storage/                # Planned: sessions, configuration, credential storage
  exports/                # Planned: Markdown and Excalidraw writers
assets/
  avatars/                # Planned: hand-drawn sprite sources and exported frames
tests/
  cli.test.mjs            # Tests of the compiled executable
  core/                   # Planned: room transitions, queue and budget behavior
docs/
  architecture.md         # State diagrams and architectural decisions
  brainstorm.md           # Product behavior and ideas
```

Create additional files when there is actual behavior to put in them. Avoid empty service layers or a catch-all `utils` folder.

- **`ui/` displays state and sends commands.** Keep model calls, queue management, and budget calculations out of React components. Animation timers live here and do not generate model calls.
- **`core/` owns discussion rules.** Add room transitions, queue scheduling, brief review, transcript updates, and budget enforcement here. It must not import Ink, React, provider SDKs, or storage implementations.
- **`agents/` owns personality definitions and prompts.** Shared clarification instructions belong alongside the four individual perspectives. Agents are roles managed by the engine, not four separate applications.
- **`providers/` implements model access.** Give the engine a small interface for requests, streamed responses, usage, and cancellation. Keep authentication and provider-specific request formats out of UI components.
- **`storage/` handles disk and credentials.** Keep actual sessions and secrets outside the source repository. Add schema validation when persisted files and model responses enter the app.
- **`exports/` converts a saved session into an artifact.** It should not need terminal components or call a model just to write a file.
- **`cli.tsx` wires the pieces together.** As startup grows, move dependency wiring into a dedicated bootstrap file rather than expanding the entry point indefinitely.

The intended flow is: user input → engine command → state update → UI render. The engine requests model work through an injected interface; provider results return as engine events. This allows tests to use a fake provider without credentials or API spending.

Use `.tsx` for files containing JSX and `.ts` for other TypeScript. Use `.js` extensions for relative imports in TypeScript so emitted ESM runs directly in Node. Prefer explicit names such as `room.ts`, `scheduler.ts`, and `budget.ts` as those responsibilities emerge.

## Testing and packaging

The initial smoke tests cover help, version, invalid arguments, and noninteractive launch. Add deterministic engine tests when transitions and scheduling are implemented, especially pause/resume with a pending question, stale queued intentions, and hard usage limits. Tests should use fake providers.

When CI is added, it should run `npm ci` and `npm run check` on Node 24. Add a real-terminal smoke check for input, quitting, and watch-mode restarts; a subprocess test with piped output cannot validate terminal rendering.

The package exposes `i4s` and `idiots` through `dist/cli.js`. `private: true` keeps this scaffold unpublished while the package name and release details are unsettled. `prepack` builds before packing. Add exported avatar assets to the package allowlist when they exist.

## References

- [Ink: React for terminal interfaces](https://github.com/vadimdemedes/ink)
- [TypeScript JSX](https://www.typescriptlang.org/docs/handbook/jsx.html)
- [TypeScript ESLint setup](https://typescript-eslint.io/getting-started/)
