# Failure analysis: the three lowest-scoring runs

Sources: `results.json` (judge weaknesses and rationale, rolling summaries,
final recommendations) and `transcripts/`. Scores are relevance + specificity +
rebuttals, out of 15.

## 1. `plan-learning-spanish`, rolling summary: 10/15 (3 / 4 / 3)

**What went wrong:** the final recommendation answered only the last user
message ("How will I know at month 3 and month 6 whether I'm on track?"). It
dropped the 9-month plan, the weekly structure for 45-minute weekdays and
2-hour weekends, and how to spend the $150/month. The full-history
recommendation for the same problem covered all of them and scored 13/15.

**Was information lost?** No. The rolling summary kept every user constraint
word for word: complete beginner, 9 months, 45 min/2 h, Duolingo boredom,
$150/month. It also kept each advisor's weekly structure and budget split
under "Positions". The facts survived; their prominence did not.

**Why:** this debate ran the longest of all 30 (20 agent turns, 47 calls). By
the end, 19 of 24 log events were folded into the summary, and the verbatim
"recent" window held only the checkpoint discussion. The synthesis read the
earlier plan as background and the last question as the task. Full history
showed the plan being built turn by turn, so the plan stayed central.

**Implication:** summaries can lose emphasis even when they keep content.
The risk grows when the last user message is a narrow follow-up to an
earlier broad request. A summary field such as "what the user has asked for
so far" could keep the original request in view.

## 2. `plan-team-offsite`, full history: 11/15 (4 / 4 / 3)

**What went wrong:** the recommendation hedged on the format. It gave an
in-person, one-overnight agenda "only if travel can be humane; otherwise
switch to hybrid", but never gave the hybrid agenda. It also didn't show that
in-person travel for 14 people across 4 time zones fits $20k. The
rolling-summary version committed to remote-first and scored 13/15.

**Why:** Bleu asked factual questions that only the user could answer: can
people travel, how wide is the time-zone overlap, will leadership attend. The
scripted user never answered them; the next scripted message moved on. The
panel never settled the format, and the synthesis carried that open
question into the final answer.

**Was this caused by the history setting?** Not visibly. The summary run hit
the same open questions (its summary lists them) but resolved them by
picking the safer default. Which way a synthesis breaks a tie looks like
run-to-run variation, not an effect of the history setting.

**Implication:** this is partly an artifact of the eval itself. Scripted
users ignore questions, and real users would usually answer "can people
travel?". A final answer should still pick a default and give the fallback
in full when a key question is open.

## 3. `career-manager-track`, rolling summary: 13/15 (5 / 4 / 4)

**What went wrong:** little. The judge preferred the full-history version
because it was more specific about the IC return path: headcount ownership,
and what happens if no matching IC role is open. The summary version asked
for "a guaranteed IC return path ... with an identified landing role" but
skipped those mechanics.

**Was information lost?** No. The rolling summary records Bleu's
"contingency if no senior IC slot exists" and the open question "what if no
senior IC slot is open?". As in case 1, the detail was in the summary but
didn't reach the final answer.

## Patterns

- In neither summary-config failure did the summary drop a user fact. Both
  lost **emphasis**: details that were present in the summary were
  under-used by the final synthesis, which leaned on the verbatim recent
  messages.
- The full-history failure came from **unanswered clarifying questions**.
  The scripted follow-ups make that more likely than with a real user.
- Only one of the three gaps is large (case 1, 3 points). The others are
  within the 1–2 point spread seen between configs on most problems.
  Fifteen problems are too few to treat any single run as a reliable
  signal.
