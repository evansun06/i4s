# The Idiots

Four perspectives.

The Idiots is a terminal app where four AI advisors talk your problem through with you, and with each other. Each has its own angle and personality, they argue when they disagree, and you lead: they reply to you, ask you when your answer matters, and stop when it is your turn.

| Advisor            | Angle                                      |
| ------------------ | ------------------------------------------ |
| **Ruby** (red)     | Action, priorities, and results            |
| **Lemon** (yellow) | Possibilities, creativity, and opportunity |
| **Jade** (green)   | People, trust, and continuity              |
| **Bleu** (blue)    | Evidence, precision, and feasibility       |

## Install

Requires [Node.js](https://nodejs.org) 24 or later.

```sh
npm install -g idiots
idiots            # or: i4s
```

Or try it without installing:

```sh
npx idiots
```

## Getting started

You need an API key from one of these providers:

| Provider         | Key starts with | Environment variable |
| ---------------- | --------------- | -------------------- |
| Gemini           | `AIza`          | `GEMINI_API_KEY`     |
| Claude           | `sk-ant-`       | `ANTHROPIC_API_KEY`  |
| ChatGPT (OpenAI) | `sk-`           | `OPENAI_API_KEY`     |
| OpenRouter       | `sk-or-`        | `OPENROUTER_API_KEY` |

On first launch, paste your key when asked; the provider is detected from it, and the key is saved to your system keychain. Next time, pick a saved key from the menu or add another. If a provider's environment variable is set, that key is used directly.

Then pick a new discussion or continue a previous one, and say what you're working on.

## In a discussion

- **Talk normally.** Each round, the advisors who have something to add reply in turn, listening to each other as they go, and may argue a point back and forth briefly.
- **Answer questions.** When an advisor needs something only you know, the discussion waits for your answer.
- **`@name`** in a message (`@bleu`, `@ruby @jade`) means only those advisors reply that round.
- **Type while they talk** to queue your next message.

| Command                           | What it does                                                                                  |
| --------------------------------- | --------------------------------------------------------------------------------------------- |
| `/think [agents] <message>`       | Have advisors think deeply before answering, e.g. `/think bleu how should I price this?`      |
| `/temp [agent\|all] [0–1\|reset]` | Boldness: 0 is generic, 0.5 is normal, 1 is full personality                                  |
| `/new <message>`                  | Set a pending question aside and talk to everyone                                             |
| `/pause`, `/resume`               | Pause and resume the room                                                                     |
| `/draw`                           | Pause and generate Decision/Implementation maps from this saved session (repository checkout) |
| `/budget <calls>`                 | Raise the call limit for this session                                                         |
| `/queue`, `/unqueue`              | Show or remove queued messages                                                                |
| `/help`                           | Commands and keyboard controls                                                                |
| `/quit`                           | Save and exit                                                                                 |

Keyboard: Tab completes, ↑↓ browse suggestions and history, PgUp/PgDn scroll, Ctrl+End jumps back to live, Ctrl+C quits.

## Drawing maps (repository checkout)

From a checkout, install both components with `npm ci` at the repository root and
`npm ci --prefix excalidraw-pipeline`. Configure `OPENAI_API_KEY` in your shell or
`excalidraw-pipeline/.env`. Drawing uses the existing OpenAI pipeline and its
`gpt-6-luna` default, independently of the discussion provider; a saved Gemini or
Claude key does not configure drawing. The published npm package does not yet
bundle this experimental pipeline.

In the full TUI, type `/draw`. The app pauses the agents and playback, saves the
session, and passes that file's `discussion.log` to the pipeline. Only committed
messages are included; a partial streaming reply is held until you resume.
Loading text reports the active pipeline stage. Draw calls count against the
session budget: six available calls are reserved, actual requests are charged,
and unused capacity is released. `/budget <calls>` can add capacity if needed.
An unchanged conversation can reuse its previously validated Step 1 extraction;
the pipeline checks the exact snapshot, specification, model and schema and
revalidates the saved knowledge before skipping that call. Graphs are still rebuilt
independently: decisions/options are projected from canonical facts without a model;
implementation and readable presentation use the LLM. Fresh runs normally use three
calls; unchanged retries use two. Relationship-category hints are warnings, while
invalid references, cycles and false commitments still block export. Per-request timings/token counts are saved in
`timings.json` so slow stages are visible.

When finished, the TUI adds **Go online to edit** directly to the chat, opening
both maps in excalidraw.com. No separate results screen replaces the discussion.
The link is a short HTTP address bound only to `127.0.0.1`, not a `file://` link
that an IDE may open as source code. Each drawing has a random private path; only
its edit handoff and native drawing download are served, never session logs or
arbitrary files. Links remain available while this TUI process is open; shutdown
closes the local listener. `edit.html` and the native file remain saved on disk.
There is no terminal diagram rendering, image export, or browser process during
generation. Cmd/Ctrl+click opens links in terminals supporting OSC 8.
The discussion stays paused on success or failure;
`/resume` explicitly continues it. Pending questions and queued input are retained.
Repeated `/draw` commands during generation start no extra calls; Ctrl+C cancels
generation and saves/exits.

Each run is saved separately under
`~/.the-idiots/sessions/<session-id>-draws/<run>/`, including
`project-plan.excalidraw`, `edit.html`, `terminal-maps.json`, and pipeline diagnostics.
The editor handoff passes only drawing elements through Excalidraw's `#url=data:…`
importer, with no sharing-service upload or raw conversation. The online app can
read that drawing, and browser history may retain the URL. Online edits do not
overwrite local runs. Import the native file manually if a browser blocks the handoff.
The link needs no additional dependencies or model calls. Old run files are retained.
The existing standalone pipeline command still works. `/draw` is
not sent to the discussion agents and is not available in `--plain` mode.

Session storage is `~/.the-idiots/sessions/` (a hidden directory). On macOS, open it
with `open ~/.the-idiots/sessions`, or use Finder → Go → Go to Folder and paste that
path. This local checkout also has a visible, Git-ignored `local-sessions` shortcut
to the same folder, including session JSON and per-session draw results. It does
not copy or move your data, and is not included in commits or other checkouts.

## Options

```text
--provider <id>      Skip the menu: gemini | anthropic | openrouter | openai | custom
--model <name>       Use a specific model for every call
--base-url <url>     Any OpenAI-compatible endpoint (with --provider custom)
--call-limit <n>     Hard limit on model calls per session (default: 100)
--wpm <n>            Reading speed for replies (default: 340; 0 for instant)
--temperature <t>    Starting boldness, e.g. 0.7 or "yellow=0.9,blue=0.2"
--angry              Angry mode: the advisors take offense and trade insults
--plain              A plain-text transcript instead of the full interface
--forget-key         Remove a saved key
```

Run `idiots --help` for the full list.

## Your data

- **API keys** stay on your machine: in your system keychain, or in environment variables. They are sent only to the provider you choose. If no keychain is available (some Linux setups), keys are used for that session only; set the provider's environment variable to skip the prompt.
- **Discussions** are saved after every round as JSON files in `~/.the-idiots/sessions/`, so you can continue them later. Delete a file to forget a discussion.
- **Model calls** cost money on your provider account. Each session has a call limit (`--call-limit`, `/budget`) that the app never exceeds.

## Development

See [SETUP.md](SETUP.md) for working on The Idiots itself.

## License

MIT
