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

| Command                           | What it does                                                                             |
| --------------------------------- | ---------------------------------------------------------------------------------------- |
| `/think [agents] <message>`       | Have advisors think deeply before answering, e.g. `/think bleu how should I price this?` |
| `/temp [agent\|all] [0–1\|reset]` | Boldness: 0 is generic, 0.5 is normal, 1 is full personality                             |
| `/new <message>`                  | Set a pending question aside and talk to everyone                                        |
| `/pause`, `/resume`               | Pause and resume the room                                                                |
| `/budget <calls>`                 | Raise the call limit for this session                                                    |
| `/queue`, `/unqueue`              | Show or remove queued messages                                                           |
| `/help`                           | Commands and keyboard controls                                                           |
| `/quit`                           | Save and exit                                                                            |

| Key             | What it does                                                                      |
| --------------- | --------------------------------------------------------------------------------- |
| Enter or Tab    | Complete a `/` command or `@name` suggestion; Enter sends once it's complete      |
| ↑ ↓             | Scroll the chat (or pick a suggestion while the list is open)                     |
| Mouse wheel     | Scroll the chat                                                                   |
| PgUp / PgDn     | Scroll a page; Ctrl+End jumps back to live                                        |
| Ctrl+Q / Ctrl+E | Slower / faster reading speed, any time, even mid-reply (Alt+Q / Alt+E also work) |
| Ctrl+P / Ctrl+N | Previous / next message you sent                                                  |
| Ctrl+R          | Raise your hand: you speak after the current speaker                              |
| Ctrl+C          | Save and quit                                                                     |

The reading speed shows in the top bar. Terminals never pass the Command key through to apps, so the speed keys use Ctrl (or Alt) on every platform. While the app is open it handles the mouse wheel itself, so in most terminals hold Shift to select text with the mouse.

## Options

```text
--provider <id>      Skip the menu: gemini | anthropic | openrouter | openai | custom
--model <name>       Use a specific model for every call
--base-url <url>     Any OpenAI-compatible endpoint (with --provider custom)
--call-limit <n>     Hard limit on model calls per session (default: 100)
--wpm <n>            Starting reading speed (default: 340; 0 for instant);
                     Ctrl+Q / Ctrl+E change it while you chat
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
