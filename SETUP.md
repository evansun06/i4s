# Development setup

The Idiots is a local Node.js application. React and Ink render the terminal room; the discussion engine, streaming model adapters, and persistence run in the same process.

## Start the room

Use Node.js 24 and npm:

```sh
nvm use
npm ci
npm run dev
```

Pick a provider or paste an API key, then start a new discussion or resume a saved one. Provider environment variables are supported; keys entered interactively are stored in the OS keychain. Session files and non-secret preferences live under `~/.the-idiots/`, outside the repository.

The default interface shows the conversation, followed by a centered row of Ruby, Lemon, Jade, and Bleu above the input bar. State labels describe their activity. The artwork currently has idle animations only; those run locally at independent random intervals. The ball beside the displayed speaker pulses as text is revealed.

The engine currently runs one batch per user message. Messages submitted during a batch are visibly queued for the next one. An agent question holds older queued messages until you answer or use `/new <message>` to set it aside. Pausing retains the queue and question, freezes playback, and starts no new calls. Queued messages are session-local and are not saved on exit; committed conversation is saved after each batch and when quitting.

## Controls

Type `/` to see commands. Up/Down selects a suggestion, Tab completes it, Escape dismisses suggestions, and Enter submits. `@ruby` and `@red` address the same agent; all four character and color names work. With no suggestions open, Up/Down navigates input history. Left/Right, Home/End, Backspace/Delete, Ctrl+A/E/U, and paste edit the input. Paste line breaks become spaces.

Page Up/Down scroll the transcript. Ctrl+End returns to following live output. Ordinary `q` is text; `/quit` or Ctrl+C saves committed conversation and exits.

| Command                                  | Action                                                 |
| ---------------------------------------- | ------------------------------------------------------ |
| `/help`                                  | Show commands and keys                                 |
| `/pause`, `/resume`                      | Pause or resume the room and text playback             |
| `/budget 20`                             | Add 20 calls; use `/resume` separately if paused       |
| `/temp`, `/temp ruby 0.8`, `/temp reset` | Inspect or change agent boldness                       |
| `/think bleu <message>`                  | Ask an agent to reason deeply; omit names for all four |
| `/new <message>`                         | Set a pending question aside and redirect              |
| `/queue`, `/unqueue`                     | Show queued messages or remove the latest one          |
| `/quit`                                  | Save and exit                                          |

Reading speed defaults to 340 WPM. `npm run dev -- --wpm 0` displays text as it arrives. Use `--call-limit 100` to set the logical model-request ceiling; reviews and summaries count, while rate-limit retries reuse the request reservation. `--provider`, `--model`, and `--base-url` can override setup choices. `--plain` retains the original transcript interface and its existing commands.

Use a true-color terminal at least 76 columns by 24 rows for the full character row. Smaller terminals show compact name/state badges. `NO_COLOR` disables color and animation; names and status text remain available. The TUI uses the exact RGB entries in `src/assets/pallette/idiots.gpl`; sprite pixels retain their hand-drawn colors.

## Development and verification

| Command              | Purpose                                                    |
| -------------------- | ---------------------------------------------------------- |
| `npm run dev`        | Start the working TUI                                      |
| `npm run dev:watch`  | Restart on edits; resets in-memory state                   |
| `npm run demo`       | Run the original plain transcript                          |
| `npm run build`      | Compile into `dist/` and copy runtime assets               |
| `npm start`          | Run the compiled TUI                                       |
| `npm test`           | Build and run deterministic tests with fake providers      |
| `npm run check`      | Typecheck, lint, format check, and tests                   |
| `npm pack --dry-run` | Inspect distributable files, including sprites and palette |

For an interactive test without credentials or API spending:

```sh
npm run build
node tests/fixtures/terminal.mjs
```

This fixture uses a local fake provider and does not save sessions. Send `@ruby ask me` to exercise a question, or send a normal message to watch streaming and queued turns. Check completion, pause/resume, resize, scrolling, and quitting in a real terminal.

`package-lock.json` is committed with dependency changes. Use `npm ci` for fresh checkouts and `npm install` for intentional dependency changes; do not edit the lockfile by hand. `string-width` is a direct dependency for Unicode-aware cursor placement.

## Code boundaries

- `src/cli.tsx` handles arguments, onboarding, provider/session wiring, and shutdown.
- `src/core/` owns room state, the shared log, turn coordination, and call budgets. No React, Ink, provider SDK, or storage imports belong here.
- `src/ui/` renders state and handles input. The chat controller owns queued UI input and paced presentation; it delegates discussion behavior to the engine. Animation never calls models.
- `src/agents/` defines perspectives, prompts, and character/color identities.
- `src/providers/` implements streamed model calls and cancellation.
- `src/storage/` handles sessions and credentials.
- `src/assets/` contains hand-drawn sources, PNG/JSON exports, and the palette. Builds copy only runtime PNGs, JSON, and the palette into `dist/assets/`.

The product designs in `docs/` describe the longer-term continuous discussion room. Autonomous continuation, a structured shared brief, proposal panels, and additional character animations are still future work.
