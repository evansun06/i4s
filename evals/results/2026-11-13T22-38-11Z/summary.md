# Evaluation summary

Run 2026-11-13T22:38:11.537Z at commit `13de313`.
Debates: `gpt-5.5`. Judge: `gpt-5.5`. Pipeline: `gpt-6-luna`.
Problems: 15. All numbers below come from `results.json` in this folder.

## Configurations

| Metric | Full history | Rolling summary |
| --- | ---: | ---: |
| Debates completed | 15 / 15 | 15 / 15 |
| Model calls per debate (mean) | 39.1 | 39.9 |
| Input tokens per call (mean) | 1,750 | 1,729 |
| Input tokens per call (median) | 1,717 | 1,692 |
| Input tokens per call (max) | 3,656 | 3,435 |
| Total tokens per debate (mean) | 77,573 | 79,334 |
| Summary calls per debate (mean) | 0.0 | 1.1 |
| Agent turns per debate (mean) | 15.3 | 15.4 |
| Wall-clock per debate, s (mean) | 83.3 | 99.7 |
| Rate-limited attempts (retried) | 0 | 0 |
| Calls without reported usage | 0 | 0 |
| Judge: relevance (mean, 1-5) | 4.93 | 4.80 |
| Judge: specificity (mean, 1-5) | 4.53 | 4.47 |
| Judge: rebuttals (mean, 1-5) | 4.27 | 4.53 |
| Judge: sum of three (mean, 3-15) | 13.73 | 13.80 |
| Pipeline: passed-first-try | 5 | 8 |
| Pipeline: passed-after-repair | 8 | 6 |
| Pipeline: rejected | 2 | 1 |
| Pipeline: not measured (request failed) | 0 | 0 |

## Head to head

Judge's overall pick: full history 7, rolling summary 8, tie 0. The pick was the response shown first 9 of 15 times.
By summed scores, of 15 judged problems (0 unjudged): full history scored higher on 6, rolling summary on 7, tied on 2.
When one response won, it was the one shown first 8 of 13 times (position-bias check).

## Pipeline rejection and repair reasons

| Problem | Config | Outcome | Reasons | Error codes |
| --- | --- | --- | --- | --- |
| career-startup-offer | full | passed-after-repair | invalid-reference, unsupported-commitment | decision_history, question_state |
| career-startup-offer | summary | passed-after-repair | invalid-reference | decision_history |
| career-manager-track | full | passed-after-repair | invalid-reference | decision_history |
| career-manager-track | summary | passed-after-repair | invalid-reference | decision_history |
| career-grad-school | summary | passed-after-repair | invalid-reference | decision_history |
| tech-monolith-split | full | passed-after-repair | invalid-reference | decision_history, decision_option |
| tech-postgres-vs-dynamo | summary | rejected | invalid-reference | decision_history, selection_relationship, source_reference |
| tech-mobile-framework | full | rejected | invalid-reference | decision_history, source_reference |
| tech-build-vs-buy-auth | full | passed-after-repair | invalid-reference, unsupported-commitment | decision_history, selection_relationship |
| tech-build-vs-buy-auth | summary | passed-after-repair | invalid-reference | decision_history |
| plan-product-launch | full | rejected | invalid-reference | attribution, decision_history |
| plan-team-offsite | full | passed-after-repair | invalid-reference | decision_history |
| plan-migration-cutover | full | passed-after-repair | unsupported-commitment | approval_fidelity, technology_choice |
| plan-migration-cutover | summary | passed-after-repair | invalid-reference, unsupported-commitment | decision_history, technology_choice |
| everyday-roommate | full | passed-after-repair | invalid-reference | attribution |
| everyday-dog | full | passed-after-repair | unsupported-commitment | question_state |
| everyday-dog | summary | passed-after-repair | invalid-reference | decision_history |

## Per run

| Problem | Config | Calls | Input/call | Total tokens | Turns | Time (s) | Rel | Spec | Reb | Pipeline |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| career-startup-offer | full | 38 | 1,662 | 72,442 | 15 | 82.3 | 5 | 4 | 5 | passed-after-repair |
| career-startup-offer | summary | 38 | 1,637 | 72,095 | 13 | 81.7 | 5 | 5 | 5 | passed-after-repair |
| career-manager-track | full | 40 | 1,757 | 79,106 | 16 | 78.1 | 5 | 5 | 4 | passed-after-repair |
| career-manager-track | summary | 37 | 1,613 | 67,466 | 14 | 77.4 | 5 | 4 | 4 | passed-after-repair |
| career-grad-school | full | 40 | 1,802 | 81,590 | 16 | 87.5 | 5 | 5 | 5 | passed-first-try |
| career-grad-school | summary | 36 | 1,605 | 67,218 | 14 | 88.4 | 5 | 4 | 4 | passed-after-repair |
| tech-monolith-split | full | 39 | 1,739 | 75,938 | 15 | 67.7 | 5 | 5 | 4 | passed-after-repair |
| tech-monolith-split | summary | 43 | 1,773 | 87,447 | 17 | 103.6 | 5 | 4 | 5 | passed-first-try |
| tech-postgres-vs-dynamo | full | 36 | 1,608 | 65,540 | 13 | 66.5 | 5 | 5 | 4 | passed-first-try |
| tech-postgres-vs-dynamo | summary | 38 | 1,573 | 69,106 | 14 | 84.9 | 5 | 5 | 5 | rejected |
| tech-mobile-framework | full | 42 | 1,757 | 83,061 | 16 | 84.5 | 5 | 5 | 4 | rejected |
| tech-mobile-framework | summary | 41 | 1,732 | 81,851 | 16 | 102.1 | 5 | 5 | 4 | passed-first-try |
| tech-build-vs-buy-auth | full | 38 | 1,734 | 73,553 | 15 | 68.5 | 5 | 4 | 4 | passed-after-repair |
| tech-build-vs-buy-auth | summary | 42 | 1,775 | 84,526 | 17 | 98.6 | 5 | 5 | 5 | passed-after-repair |
| plan-product-launch | full | 44 | 1,998 | 98,943 | 18 | 98.2 | 5 | 4 | 4 | rejected |
| plan-product-launch | summary | 42 | 1,804 | 88,014 | 17 | 113.6 | 5 | 5 | 4 | passed-first-try |
| plan-team-offsite | full | 43 | 1,880 | 92,861 | 17 | 95.8 | 4 | 4 | 3 | passed-after-repair |
| plan-team-offsite | summary | 42 | 1,829 | 91,938 | 16 | 122.4 | 5 | 4 | 4 | passed-first-try |
| plan-migration-cutover | full | 40 | 1,842 | 82,007 | 16 | 71.5 | 5 | 5 | 4 | passed-after-repair |
| plan-migration-cutover | summary | 41 | 1,797 | 82,990 | 16 | 92.2 | 4 | 4 | 5 | passed-after-repair |
| plan-learning-spanish | full | 41 | 1,907 | 89,623 | 17 | 97.7 | 5 | 4 | 4 | passed-first-try |
| plan-learning-spanish | summary | 47 | 2,095 | 110,318 | 20 | 116.0 | 3 | 4 | 3 | passed-first-try |
| everyday-car | full | 40 | 1,640 | 74,322 | 15 | 74.3 | 5 | 5 | 5 | passed-first-try |
| everyday-car | summary | 41 | 1,701 | 79,454 | 16 | 88.5 | 5 | 4 | 5 | passed-first-try |
| everyday-roommate | full | 36 | 1,635 | 66,270 | 14 | 70.4 | 5 | 4 | 4 | passed-after-repair |
| everyday-roommate | summary | 38 | 1,683 | 72,662 | 14 | 85.3 | 5 | 5 | 5 | passed-first-try |
| everyday-wedding | full | 36 | 1,632 | 67,876 | 13 | 83.3 | 5 | 5 | 5 | passed-first-try |
| everyday-wedding | summary | 38 | 1,627 | 72,836 | 14 | 102.1 | 5 | 4 | 5 | passed-first-try |
| everyday-dog | full | 34 | 1,541 | 60,465 | 13 | 122.7 | 5 | 4 | 5 | passed-after-repair |
| everyday-dog | summary | 35 | 1,542 | 62,085 | 13 | 138.3 | 5 | 5 | 5 | passed-after-repair |

## Lowest-scoring runs

- `plan-learning-spanish` (summary): 10/15
- `plan-team-offsite` (full): 11/15
- `career-manager-track` (summary): 13/15
