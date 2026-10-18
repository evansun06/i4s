# Development setup

The Idiots is a local Node.js application. React and Ink render the terminal room; the discussion engine, streaming model adapters, and persistence run in the same process.

## Start the room

Use Node.js 24 and npm:

```sh
nvm use
npm ci
npm run dev
```

With no API key yet, a welcome screen asks you to paste one; the provider is detected from the key (or asked for, when it can't be), and the key is shown only as dots. The lobby then shows the title, the four characters idling (on terminals at least 76×34), and a list to start a new discussion or resume a saved one: Up/Down and Enter choose, Escape or Ctrl+C quits. Ctrl+K opens the key list: Enter chooses the key new chats use, Backspace removes a saved key, "+ Add a key" pastes another, and Escape returns. (Ctrl+M can't be used: terminals send it as Enter.) `/lobby` saves the discussion and returns there, with the list refreshed. `--provider` makes chats use that provider's key, asking for it if missing. `--plain` skips the lobby and keeps the original prompts. Provider environment variables are supported; keys entered interactively are stored in the OS keychain. Session files and non-secret preferences live under `~/.the-idiots/`, outside the repository.

The default interface shows the conversation, followed by a centered row of Ruby, Lemon, Jade, and Bleu above the input bar. State labels describe their activity. The artwork currently has idle animations only; those run locally at independent random intervals. The ball beside the displayed speaker pulses as text is revealed.

The engine currently runs one batch per user message. Messages submitted during a batch are visibly queued for the next one. An agent question holds older queued messages until you answer or use `/new <message>` to set it aside. Pausing retains the queue and question, freezes playback, and starts no new calls. Queued messages are session-local and are not saved on exit; committed conversation is saved after each batch and when quitting.

## Controls

Type `/` to see commands. While suggestions are open, Up/Down selects one, and Tab or Enter completes it; Enter submits once the text already matches the selection, so a fully typed `/help` runs on the first Enter. Escape dismisses suggestions; with none open, it interrupts: drafting calls stop at once, nobody else takes the floor, and the round ends. A reply cut off mid-stream is not saved and stays on screen marked interrupted, showing only what had appeared; replies already said appear in full. Finished drafts waiting their turn are kept for next round, and agents cut off redraft after your next message. While Korg is drawing, Escape cancels `/draw` instead: the maps are discarded, Korg says so, and the room stays paused. Drawing results and errors come from Korg (silver ●) rather than the Room. Calls used and reading speed sit on the right of the line above the input, where "Next: …" names the queued speakers in their own colors ("Paused" while drawing). `@ruby` and `@red` address the same agent; all four character and color names work. Ctrl+P/Ctrl+N step through input history. Left/Right, Home/End, Backspace/Delete, Ctrl+A/U, and paste edit the input. Paste line breaks become spaces.

With no suggestions open, Up/Down scroll the transcript a line at a time, the mouse wheel three lines, and Page Up/Down a page; the input bar and characters stay in place. Ctrl+End returns to following live output, as does scrolling back to the bottom. The app turns on terminal mouse reporting (SGR) for the wheel and turns it off on exit; most terminals still select text with Shift held. Agents' `**bold**` Markdown is shown in bold without the asterisks. Ctrl+Q/Ctrl+E (or Alt+Q/Alt+E) lower or raise reading speed by 40 WPM, between 100 and 1000, at any time including mid-reply; the top bar shows the current speed. Terminals don't pass the Command key to applications, so there is no Cmd binding. Ordinary `q` is text; `/quit` or Ctrl+C saves committed conversation and exits.

| Command                                  | Action                                                 |
| ---------------------------------------- | ------------------------------------------------------ |
| `/help`                                  | Show commands and keys                                 |
| `/pause`, `/resume`                      | Pause or resume the room and text playback             |
| `/budget 20`                             | Add 20 calls; use `/resume` separately if paused       |
| `/temp`, `/temp ruby 0.8`, `/temp reset` | Inspect or change agent boldness                       |
| `/about`, `/about @ruby`                 | Who the advisors are, or one of them                   |
| `/think bleu <message>`                  | Ask an agent to reason deeply; omit names for all four |
| `/new <message>`                         | Set a pending question aside and redirect              |
| `/queue`, `/unqueue`                     | Show queued messages or remove the latest one          |
| `/lobby`                                 | Save and return to the lobby                           |
| `/quit`                                  | Save and exit                                          |

Reading speed starts at 340 WPM, or at `--wpm`; Ctrl+Q/Ctrl+E adjust it during the session. `npm run dev -- --wpm 0` displays text as it arrives. Use `--call-limit 100` to set the logical model-request ceiling; reviews and summaries count, while rate-limit retries reuse the request reservation. `--provider`, `--model`, and `--base-url` can override setup choices. `--plain` retains the original transcript interface and its existing commands.

Use a true-color terminal at least 76 columns wide for the character sprites. They resize with the terminal's height, taking at most about a quarter of it: 14 pixels square (7 rows) at most, down to 10 (5 rows), sampled from the 16-pixel art by nearest neighbor so they stay crisp. Below that, or when narrower, the row shows names and states only. `NO_COLOR` disables color and animation; names and status text remain available. The TUI uses the exact RGB entries in `src/assets/pallette/idiots.gpl`; sprite pixels retain their hand-drawn colors.

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
- `src/drawing/` runs `/draw`: `pipeline.ts` starts the Excalidraw pipeline in `src/drawing/excalidraw/` as a child process with the session's OpenAI key; the rest serves the edit link. `npm run pipeline` runs it standalone ([docs/drawing-pipeline.md](docs/drawing-pipeline.md)); its tests are `tests/pipeline-*.test.mjs`.
- `src/assets/` contains hand-drawn sources, PNG/JSON exports, and the palette. Builds copy only runtime PNGs, JSON, and the palette into `dist/assets/`.

The product designs in `docs/` describe the longer-term continuous discussion room. Autonomous continuation, a structured shared brief, proposal panels, and additional character animations are still future work.
