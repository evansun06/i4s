# The Idiots

> Four perspectives. One discussion. Your decision.

## The idea

**The Idiots is a terminal-based AI discussion panel that helps you make decisions by putting different ways of thinking in the same room.**

You bring a question, dilemma, or half-formed idea. Four agents—Red, Yellow, Green, and Blue—discuss it with you and each other. They challenge assumptions, offer alternatives, notice tradeoffs, and revise their positions as the conversation develops. You decide which recommendations deserve to move forward.

Inspired by *Surrounded by Idiots*, the project takes the idea of understanding different communication styles and turns it into a collaborative decision-making experience. The colors serve as deliberately simplified design lenses, rather than a way to diagnose or categorize real people.

## The pitch

When everyone approaches a problem the same way, important considerations go missing. A decision can look efficient but damage trust, feel exciting but lack evidence, or be thoroughly researched without ever turning into action.

The Idiots makes those tensions visible. You can watch different perspectives respond to the same problem, hear what each one values, and choose with a clearer understanding of the tradeoffs.

**Thirty-second pitch:** “The Idiots is an AI discussion room in your terminal. You bring a decision, and four opinionated agents debate it from different angles: action, possibility, people, and evidence. They hear each other, push back, and adapt. They ask you the questions that matter, help you discover alternatives, and work toward a useful outcome with you.”

## The default panel

These are the personalities we want to build, with strengths and blind spots that create useful tension.

| Agent | Primary lens | What they contribute | Potential blind spot | Typical question |
| --- | --- | --- | --- | --- |
| **Red** | Action and results | Directness, prioritization, decisive recommendations, momentum | Moving too quickly or overlooking people and details | “What gets us to the outcome fastest?” |
| **Yellow** | Possibility and enthusiasm | Creative alternatives, big-picture connections, optimism | Underestimating effort or getting distracted by novelty | “What else could this become?” |
| **Green** | People and continuity | Empathy, cooperation, trust, sustainable change | Avoiding necessary conflict or holding onto the familiar | “How will this affect the people involved?” |
| **Blue** | Evidence and precision | Structured reasoning, feasibility checks, risks, explicit assumptions | Overanalyzing or waiting for certainty | “What supports this, and what are we missing?” |

Each agent should be capable of good judgment. Red can ask for evidence; Blue can recommend taking a risk. Their priorities differ, but they should never become caricatures that disagree just to perform a personality.

## The experience

**A continuous room with natural checkpoints.** Bring a decision, dilemma, or half-formed idea. The agents establish a shared understanding of what matters, then follow the questions and disagreements that emerge. Clarifying, exploring, challenging, comparing, and summarizing are available behaviors, not mandatory stages.

The user can participate whenever they want: answer an agent's question, introduce a constraint, challenge an argument, pause to ask something, or address an agent directly with `@blue`. A mention gives that agent the next turn after the current contribution; pausing lets the user stop the room and steer it immediately.

Proposals emerge and change within the conversation. Comparing, selecting, and combining them are optional actions available whenever useful. Continuing never requires selecting a proposal card. A checkpoint preserves the feed and queue rather than replacing the conversation with a decision screen.

Every discussion should earn its direction from the problem and the user's answers. Sometimes the useful outcome is a decision and next action; sometimes it is a clearer question, an exposed assumption, or an unresolved tradeoff worth investigating.

### Establish a shared brief

Before recommending solutions, all four agents review the objective, hard constraints, preferences, discussion guidelines, and definition of a useful outcome. Each checks the understanding against the other three. Require agreement about the working brief while allowing disagreement about recommendations.

Keep that brief visible and editable. Distinguish user-confirmed requirements from assumptions and unresolved questions. Agent consensus cannot turn an invented constraint into a user requirement. New information can reopen the brief at any time.

Every agent's system prompt should include this common instruction, alongside its individual perspective:

> Before proposing solutions, establish the user's objective, hard constraints, preferences, discussion guidelines, and definition of a useful outcome. Read what the user and other agents have already established. Ask only about missing information that could materially change the discussion. Distinguish confirmed constraints from assumptions. Review the shared brief and flag conflicts or omissions. Proceed once all four agents have reviewed it and blocking ambiguities are resolved or explicitly deferred. Revisit the brief when new information changes it. Do not require consensus on recommendations.

Review does not require four public “I agree” messages. Track each agent's review of the current brief; agents speak when they have something to clarify. If a requirement is ambiguous or contradictory, ask the user rather than holding an endless agreement loop.

For example:

> **Blue:** Before we recommend anything, does the 36-hour deadline include deployment?  
> **You:** Yes, and only two of us can code.  
> **Red:** Then a working demo takes priority over feature breadth.  
> **Green:** Agreed on scope. Who needs to understand the demo?  
> **Yellow:** I have two ideas, but that answer will change which one I suggest.

### Agents own the questions

Red, Yellow, Green, and Blue identify the uncertainties and ask the user. The coordinator manages turns, duplicate questions, and pausing; it does not become a fifth personality asking generic questions on their behalf.

An explicit `ask_user` contribution pauses the room for an answer. Questions between agents and rhetorical questions do not. Ask only what could materially affect the discussion, and check whether another contribution already answered it. Skipping preserves the uncertainty instead of silently promoting an assumption to a fact.

### Budgets and natural checkpoints

Budget autonomous activity without forcing a decision every fixed number of turns. If the implementation retains “rounds,” they are internal work windows, not a mandatory user journey.

- **Attention budget:** After roughly 6–8 substantive contributions without user involvement, an agent offers a short checkpoint. This is an initial tuning value, not a universal rule. Preserve the conversation and let the user answer, redirect, request a summary, or continue.
- **Usage budget:** Set a configurable hard ceiling on calls or tokens, including background coordination and brief review. Reserve enough for a closing summary. Never silently extend the ceiling; continuing beyond it requires the user to increase it.
- **Progress check:** Pause earlier when agents repeat themselves, need the user's answer, or have nothing useful to add. Agreement alone does not require manufacturing another objection.

Time spent waiting for the user does not consume an active-time allowance. A soft attention checkpoint can resume within the remaining usage budget; a hard usage limit cannot. The coordinator enforces these limits even if the prompts fail to do so.

A checkpoint might sound like: “We've narrowed this to two approaches. The remaining difference is how much demo risk you'll accept.” The user can respond naturally without choosing a card. No new autonomous work starts while the room is paused, and pending intentions are reviewed against updated context on resume.

## How the discussion should behave

- **A shared conversation:** Every agent sees user messages and other agents’ contributions. A response should build on what has already happened.
- **Selective participation:** Agents can speak, ask a question, challenge a claim, suggest an option, or stay silent. Everyone does not need to answer every message.
- **Meaningful interjections:** An agent can request a turn when it notices a relevant objection or opportunity. Contributions are presented clearly enough to follow.
- **Visible activity:** Simple states such as listening, considering, and speaking make the room feel alive. Useful explanations appear in messages; private internal reasoning does not need to be exposed.
- **Changing minds:** Agents can revise a recommendation, acknowledge a strong argument, or support another agent’s proposal.
- **Bounded autonomy:** A lightweight coordinator manages turns, enforces usage limits, and detects repetition. Agents provide natural checkpoints and summaries; the user can pause or finish at any time.
- **Honest disagreement:** A discussion can end with unresolved tradeoffs. The user retains the final decision; a panel vote is not required.

## Optional proposal comparison

When useful, the user can open a comparison of proposals that have emerged so far. Cards are optional tools for steering the continuous discussion. Each includes:

- A concrete recommended action and the agent proposing it.
- A short rationale and its main tradeoff.
- Important assumptions or unanswered questions.
- Other agents’ support or objections, where useful.

Choices belong to proposals, not permanently to colors. Multiple agents may support one option, and one agent may offer more than one. Users can select cards or give plain-language direction, including revisiting an earlier alternative. No fixed number of proposals is required, and a discussion with no proposals can still produce a useful summary.

For example, Red proposes shipping one polished workflow, Yellow proposes adding a memorable live debate moment, Blue calls for a reliable scripted fallback, and Green recommends a simple experience a first-time user can follow. The user selects Red’s scope and Yellow’s demo idea, then asks the panel to reconcile them within the time limit. Blue and Green still participate in refining that direction.

## The TUI at a glance

- **Panel status:** Four named, color-coded agents and their current activity.
- **Shared discussion:** A readable conversation feed showing who is responding to whom.
- **Shared brief:** The objective, confirmed constraints, guidelines, assumptions, and open questions.
- **User input:** Always accessible for context, questions, `@mentions`, pause/resume, and finishing the discussion.
- **Optional decision view:** Compare or combine proposals, request refinement, or record a decision without losing the feed.

Names and labels should carry meaning alongside color so the interface remains readable without color cues.

## Hackathon MVP

Support one complete, continuous discussion:

- Four fixed agents with distinct priorities.
- One shared conversation that all four can observe.
- A shared brief reviewed by all four agents before recommendations.
- A turn coordinator that supports speaking or passing, natural checkpoints, and hard usage limits.
- Agent-led questions and user participation through messages, `@mentions`, and pause/resume.
- Optional proposal comparison and refinement within the same conversation.
- A summary of the outcome, unresolved questions, and a next action where appropriate.

The first demo should prove that **agents respond to each other and that the user’s answers and interventions change the discussion**. Those two moments make the core idea tangible.

Save custom personalities, additional agents, external research, persistent memory, and elaborate autonomous scheduling for later.

## What success looks like

The panel surfaces a consideration the user had missed. Its agents make recognizably different contributions, engage with each other’s arguments, and help turn an open-ended question into a concrete choice. When a decision is reached, the user can explain why they chose it and what tradeoff they accepted. A clearer question or an identified missing fact can also be a useful outcome.

Try a concrete decision, a vague idea, and a disagreement about priorities. If all three follow the same conversational sequence, the orchestration is too prescriptive. Distinctive discussions should come from what the agents notice and how they respond to the user.

## Open design questions

- How much should the user control speaking order versus letting the panel coordinate itself?
- What is the shortest discussion that still feels useful and collaborative?
- How playful should the personalities be while keeping the recommendations credible?
- How should optional proposal cards and plain-language direction work together when the user revises a choice?

## The 36-hour ambition

Ship a local, open-source terminal app that someone can install, connect to their own model access, and use to reach a decision. Installation and onboarding are part of the demo: launch the app, connect an account, ask a question, watch a real exchange, select two proposals, and see the panel reconcile them.

**Proposed direction:** TypeScript + Node.js + Ink, our own small discussion coordinator, direct model API adapters, npm distribution first, and a Homebrew tap if the core experience is finished. Ink provides React components for terminal interfaces. This stack is a recommendation, not a committed implementation. [Ink](https://github.com/vadimdemedes/ink)

### Authentication and the agent harness are separate choices

Authentication determines whose model access is used. A harness manages model calls, tools, sessions, and execution. The Idiots also needs its own discussion rules: who hears what, who gets a turn, and how proposals are narrowed.

**OpenAI now documents the login path we want.** Sign in with ChatGPT lets open-source/local apps request permission to use a user's ChatGPT plan for eligible Responses API requests. Its dynamic registration flow does not require a client secret or partner API key. This is distinct from an ordinary OpenAI API key, and identity sign-in alone does not authorize inference. [Plan usage overview](https://developers.openai.com/siwc/token-sharing-open-source) · [Registration](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)

Proposed onboarding offers:

- **Continue with ChatGPT:** Browser sign-in and consent using the documented open-source flow. Keep the issued client ID, stable installation host ID, and protected credentials locally; support refresh and logout.
- **Use an OpenAI API key:** Bring an existing key through an environment variable or masked session input. API billing applies to this route.
- **Use an Anthropic API key:** A second provider once the first complete discussion loop works.

The ChatGPT plan route currently requires streaming with `store: false`, explicit conversation history for HTTP requests, and a restricted set of request parameters. We must implement it as a distinct authentication/request mode, even if it shares most of the OpenAI adapter. A successful login is only proven when a model response finishes. [Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)

### Which runtime should we build on?

| Approach | Fit for The Idiots | Proposed decision |
| --- | --- | --- |
| Direct model APIs + our coordinator | Full control over speaking order, shared context, streaming, and proposal selection; enough for a discussion-focused product | **Primary path.** Build the smallest harness specific to this experience. |
| Codex TypeScript SDK | Starts and resumes Codex threads; useful if panelists later need to perform engineering tasks | Keep as a possible adapter. |
| Codex app-server | Designed for custom clients with auth, history, approvals, and streamed events | Prefer over the basic SDK if we specifically want the Codex runtime embedded in our TUI. |
| Claude Agent SDK | Provides Claude Code's agent loop, tools, permissions, and sessions | Useful for a later panel that researches or acts on files; additional machinery for the initial discussion. |
| Fork an open-source harness | Potentially reuses provider integrations and terminal features, but requires understanding and maintaining the inherited architecture | Only choose after a short spike proves it saves time on our exact flow. |

The Codex SDK documentation explicitly points custom-client builders toward app-server. The Claude Agent SDK provides a broader tool-using runtime. Neither removes the need for our shared discussion coordinator. [Codex SDK](https://learn.chatgpt.com/docs/codex-sdk) · [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview)

For Claude subscription login, the official sources currently conflict: the SDK overview restricts third-party login without approval, while the help center's October 7 update says third-party apps can still use subscription limits. Keep Anthropic API keys as the planned integration until the applicable login path is clarified. [SDK guidance](https://code.claude.com/docs/en/agent-sdk/overview) · [Subscription update](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)

### The discussion engine

Keep four independent role contexts, each with its own instructions and evolving position. They can share one model and one credential; four perspectives do not require four providers. Our app owns the canonical transcript and delivers other agents' messages to each role.

Start with this coordination model:

1. Establish the shared brief through agent-led clarification. All four agents review the current brief before recommending solutions; record unresolved assumptions explicitly.
2. Once the brief is ready, agents can offer a perspective, ask a relevant question, or pass. Do not require four opening speeches.
3. Each completed message creates a context-update boundary. Available agents receive the latest transcript and can request a turn, identify the message they want to address, or pass. Busy agents finish their current work and catch up afterward; there is no requirement to wait for every agent.
4. The coordinator grants one speaking turn, balancing relevance and participation. That agent generates its contribution against the current transcript. Reevaluate pending requests after new contributions so replies do not become stale.
5. User messages take priority at the next completed-message boundary. `@mentions` direct the next turn; pause, resume, finish, and cancellation controls keep the discussion manageable.
6. Pause for agent questions, attention checkpoints, lack of progress, or usage limits. Preserve the transcript and queue. A checkpoint does not force proposal selection or imply a decision.
7. Maintain emerging proposals with stable IDs and supporting-message references. Apply user selections and plain-language refinements within the same conversation. All four agents remain involved; material changes reopen review of the shared brief.

Avoid asking all four models to react after every streamed token; use completed messages as context-update boundaries. These scheduling boundaries are separate from user-facing attention checkpoints. Grant turns to agents with relevant contributions and allow silence; no fixed speaking sequence is required.

Keep provider adapters small: supply role instructions and conversation context; receive streamed text, structured decisions, usage information when available, and cancellation. The UI listens to discussion events without depending on a specific SDK. Store sessions locally so a restart does not lose the decision.

### Distribution

**npm is the release target.** Publish a package exposing an `idiots` executable through `package.json`'s `bin` field. Ship compiled JavaScript and declare the supported Node version. The intended commands, subject to package-name availability, are `npx <package-name>` and `npm install -g <package-name>`, followed by `idiots`. [npm executable packages](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#bin)

**Homebrew is the second installation route.** Maintain our own tap and formula pointing at a versioned release, with Node as a dependency. The intended command is `brew install <owner>/tap/idiots`. A custom tap gives us a distribution route we control. [Homebrew taps](https://docs.brew.sh/How-to-Create-and-Maintain-a-Tap) · [Node formula guidance](https://docs.brew.sh/Language-Specific-Formulae)

Before release, install an `npm pack` tarball in a clean directory and verify launch, onboarding, one complete discussion, proposal selection, and graceful exit. Check the Codex/Claude binary installation separately if we choose an adapter that depends on one.

### Time budget

| Hours | Deliverable |
| --- | --- |
| 0–2 | Prove API-key inference and attempt ChatGPT login through one completed streamed response. If login is blocked, keep API keys working and record the blocker. |
| 2–6 | CLI entry point, TUI shell, provider interface, four roles, and a shared transcript. |
| 6–14 | Working discussion loop: agents hear each other, speak or pass, accept user input, and stop within a budget. |
| 14–20 | Optional proposal comparison, in-conversation refinement, and outcome summaries. |
| 20–26 | Streaming polish, turn requests/interjections, session save/resume, and clear errors. Complete login lifecycle if the initial spike succeeded. |
| 26–30 | Package and clean-install verification; add the second provider or Homebrew tap if the core is stable. |
| 30–36 | Exercise real dilemmas, tune repetition and pacing, fix failures, rehearse the demo, and leave contingency time. |

**Protect:** distinct perspectives, shared constraints, reactions to other agents, agent-led questions, and user control. **Stretch:** mixed providers on one panel, richer interjections, and Homebrew. One convincing end-to-end discussion carries the pitch; provider breadth can grow afterward.

Technical options above were checked against official documentation on October 15, 2026. Login and runtime details should be rechecked when implementation begins.

## Room and agent states

See [architecture.md](architecture.md) for the room-state diagram, agent-state diagram, and contribution/question lifecycle, including pause and resume behavior.

## How agents observe the conversation

**Completed messages act like clock edges.** The app records each new message and makes it available to all four agents. Each agent works independently against a snapshot of the conversation. Updating its inbox does not change the context of a model call already in progress.

### Shared log and per-agent state

Keep one canonical conversation log with monotonically increasing message IDs. Completed user messages and agent contributions enter this log. Streamed text can appear in the TUI as it arrives, but other agents receive the contribution after it finishes.

Track these fields for each agent:

| Field | Meaning |
| --- | --- |
| State | Listening, Thinking, Waiting, Reviewing, Speaking, or Researching. |
| Last-read position | The latest shared message included in the agent's model context. |
| Active call | At most one model call per agent, tagged with the message ID its snapshot ends at. |
| Pending messages | Shared messages after the last-read position; these can be derived from the log rather than copied into separate inboxes. |
| Pending intention | A brief proposed contribution and the message it addresses, tagged with the snapshot it was based on. This is not a finished speech. |

For example:

```text
Conversation: through message #12

Red:    read through #12 — listening
Blue:   read through #12 — waiting
Green:  read through #10 — thinking
Yellow: read through #11 — researching
```

### Update rules

1. **Commit a completed message.** Append it to the shared log. Animation frames, streamed tokens, and internal state changes do not create conversation edges.
2. **Notify available agents.** A listening agent can start a short decision call using the updated conversation: request a turn, research, or pass. Different agents can run these calls concurrently.
3. **Let busy agents finish.** Thinking or researching agents accumulate pending messages. Do not interrupt their work or launch a duplicate call just because another message arrived. Batch all missed messages into their next context update.
4. **Record intentions with their context version.** An agent finishing against an older snapshot may request a turn, but its result is provisional. A pass does not mean it has evaluated newer messages; it catches up before deciding again.
5. **Keep waiting agents queued.** New messages remain pending until review; agents do not need to regenerate a speech after every message. Preserve their queue position while they wait.
6. **Review before speaking.** When an agent reaches the front and the floor is free, reserve the floor, deliver all missed context, and let it revise or withdraw its intention. If it proceeds, generate its contribution against that updated context. Reserving the floor prevents another agent from speaking during this review.
7. **Give user input priority.** A user message arriving during review must be included before the agent starts speaking. An explicit pause or interruption can cancel the active contribution; ordinary agent messages do not cancel another agent's thinking.

Conversation updates are event-driven rather than timer-driven. After the shared brief has been reviewed, there is no global barrier requiring every agent to finish each contribution. Within the active discussion budget, the coordinator advances ready work while other agents continue thinking or researching. If all agents are idle, none has unread messages, and the queue is empty, wait for the user instead of polling the models. Paused and awaiting-user states prevent new calls; usage limits apply to every call, including background decisions.

### Example: Green catches up

Green starts thinking through message **#10**. While it works, Red contributes **#11**, then the user adds **#12**. Green finishes with an intention based on #10 and joins the queue. Before Green speaks, it receives #11–12 and checks whether the idea still adds value. It can revise its contribution, withdraw because Red covered it, or proceed with a response that incorporates the user's update.

With persistent SDK sessions, append the missing messages to the agent's existing context. With stateless API calls, resend the necessary conversation history alongside its personality and pending intention. Sending only the missing messages to a fresh stateless call would lose earlier context.

The TUI reflects real activity: **Listening** means available for the next update, **Thinking** means a decision call is running, and **Waiting** means an intention is queued. Idle animations run locally without model calls. Research findings become visible to the other agents when published as a contribution to the shared log.

## Relationship to the UX PDF

This direction revises the fixed journey in *The Idiots: Full User Experience (install to Excalidraw)*. Keep the room controls, `@mentions`, pause/resume, visible speaking queue, and explicit agent questions. Replace mandatory round-end selection, locked framing, and automatic refinement rounds with a continuous discussion, a revisable shared brief, and optional proposal comparison.

Exports should follow the actual discussion: constraints discovered, alternatives considered, positions revised, unresolved questions, and any decision reached. A session need not have numbered rounds or a final decision to be worth saving or exporting.
