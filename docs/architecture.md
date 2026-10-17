# The Idiots architecture

The room has one mode at a time. Each of the four agents has its own activity state. The local app coordinates both; switching speakers does not change the room mode.

## Room states

```mermaid
stateDiagram-v2
    state "Initial prompt" as InitialPrompt
    state "Discussion running" as Running
    state "Waiting for your response" as AwaitingUser
    state "Paused" as Paused

    [*] --> InitialPrompt
    InitialPrompt --> Running: Submit topic
    Running --> Running: Next agent thinks or speaks
    Running --> AwaitingUser: Agent delivers ask_user
    AwaitingUser --> Running: Answer or skip within budget
    Running --> Paused: User pauses, checkpoint, no progress, or usage limit
    AwaitingUser --> Paused: User pauses
    Paused --> AwaitingUser: Resume with unanswered question
    Paused --> Running: Resume with no pending question and budget available

    note right of Running
        Includes clarification, thinking, reviewing, and speaking.
        Only one agent speaks at a time.
        Back-to-back speakers stay in this mode.
        User input and @mentions can steer the discussion.
    end note

    note right of Paused
        Preserve the feed, queue, and pending question.
        Start no new model calls or speaking turns.
        A hard usage limit requires a budget increase to continue.
        Summaries and proposal comparisons are panels, not room modes.
    end note
```

| Room mode | Interface behavior |
| --- | --- |
| Initial prompt | Enter the topic, goals, and known constraints. |
| Discussion running | Show agent activity, the shared brief, and the conversation; accept input, `@mentions`, and pause. |
| Waiting for your response | Highlight the asking agent's question and focus input; offer answer or skip. |
| Paused | Preserve the conversation and allow the user to contribute, steer, inspect, or resume. |

Pausing while a question is pending preserves that question. Resume returns to waiting for the answer unless the user has answered or skipped it while paused. User input alone does not automatically resume a manually paused room. If an answer or skip exhausts the remaining usage allowance, enter Paused instead of starting another call.

In Paused and AwaitingUser, no new model calls or speaking turns start. In-flight work may finish provisionally; it must be reviewed against current context before being used. An explicit interruption may cancel an active contribution.

Finishing a discussion leaves the room paused with an outcome summary available. Starting a new session opens Initial prompt. Connection errors and budget notices appear as banners within the appropriate mode; proposal comparisons and summaries remain optional panels.

## Agent states

The TUI should feel like a live discussion room, with pixel-art characters and animations that communicate their current activity. Red, Blue, Green, and Yellow share the same states; their personality influences when they speak and what they contribute.

```mermaid
stateDiagram-v2
    [*] --> Listening

    Listening --> Thinking: New message or own turn
    Thinking --> Listening: Pass
    Thinking --> Waiting: Queue intention, conversation point or user question
    Waiting --> Reviewing: Next in queue and floor is free
    Waiting --> Reviewing: User grants next turn
    Reviewing --> Speaking: Point or question still relevant, revise if needed
    Reviewing --> Listening: Withdraw, point covered or question answered
    Speaking --> Listening: Conversation point finished, discussion continues
    Speaking --> Listening: User question finished, room enters AwaitingUser

    Thinking --> Researching: Needs evidence
    Researching --> Thinking: Findings ready

    note right of Waiting
        Both types share the same queue.
        Store an intention, not a finished speech.
        Keep listening while queued.
        First request gets the next turn.
        Ties favor whoever spoke least recently.
        Current speaker finishes first.
        User can pause or choose the next speaker.
    end note

    note right of Reviewing
        Read all new conversation messages.
        Keep, revise, or withdraw the intention.
        Generate final wording only after this check.
    end note
```

## Contribution and question lifecycle

The room has its own state, separate from each agent's activity. **Waiting** above means an agent is queued to speak. **AwaitingUser** below means the room is paused for your answer.

```mermaid
flowchart TD
    Thinking[Thinking: form an intention] --> Kind{What do I want to contribute?}
    Kind --> Point[Conversation point]
    Kind --> Question[Question requiring user input]
    Kind -->|Pass| Listening[Listening]
    Point --> Waiting[Waiting: same speaking queue, intention only]
    Question --> Waiting
    Waiting -->|Floor granted| Reviewing[Reviewing: read latest conversation]
    Reviewing --> Relevant{Is the point or question still relevant?}
    Relevant -->|Already covered or answered| Listening
    Relevant -->|Needs updating| Revise[Revise intention]
    Relevant -->|Yes| Speaking[Speaking: generate and deliver final wording]
    Revise --> Speaking
    Speaking --> Commit[Commit completed message to shared log]
    Commit --> Type{Contribution type?}
    Type -->|Conversation point| Continue[Room: continue discussion]
    Type -->|ask_user| AwaitingUser[Room: AwaitingUser; focus user input]
    AwaitingUser -->|Answer or skip| Record[Record response linked to question in shared log]
    Record --> Resume[Resume existing queue; agents review updated context]
    Resume --> Continue
    AwaitingUser -->|Finish discussion| Summary[Outcome summary]
    Continue -->|Finish discussion| Summary
    Continue -->|Attention checkpoint or no useful progress| Paused[Room paused; preserve feed and queue]
    Continue -->|Usage limit reached| Limited[Room paused; usage ceiling enforced]
    Paused -->|User continues or redirects within budget| Resume
    Limited -->|User increases budget and resumes| Resume
    Paused -->|Finish discussion| Summary
    Limited -->|Finish discussion| Summary
    Continue -->|User contributes at message boundary| Input[Append user message to shared log]
    Input --> Resume
```

An agent requests input with a structured `ask_user` contribution. It joins the normal speaking queue and reviews the latest conversation before asking, so a question already answered can be withdrawn. The coordinator records the asking agent and question message ID as the single pending question. A normal contribution containing a rhetorical question does not pause the room.

While the room is `AwaitingUser`, the asking agent returns to Listening, no turns are granted, and no new model calls start. In-flight calls may finish, but their results stay provisional. Existing queue positions are preserved. Answering resumes those existing agent states and the queue; skipping leaves the question unresolved. All agents receive the shared-log update before their next contribution.

The flowchart shows the lifecycle of one intention and its effect on the room; the four agents retain their independent activity states. Ordinary user input still takes priority at the next completed-message boundary; an explicit pause or interruption can cancel an active contribution.

- **Listening:** Idle animation, observing the discussion.
- **Thinking:** Considering a response.
- **Waiting:** Hand raised in a visible speaking queue, still listening. An interjection requests the next turn.
- **Reviewing:** Brief thinking pose while checking the latest conversation; revise the contribution or withdraw before speaking.
- **Speaking:** Active character animation and dialogue.
- **Researching:** Looking something up.

Agreement, disagreement, and surprise can be short reactions layered onto these states.

Only one agent speaks at a time. When two agents raise their hands, both enter the queue. The next agent reviews everything said while it waited before taking the floor. User input takes priority: the user can pause the discussion, contribute, or choose who speaks next.

