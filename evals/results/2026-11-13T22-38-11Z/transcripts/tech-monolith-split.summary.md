# tech-monolith-split · summary

Category: technical. Completed: true.
Agent turns: 17. Calls: 43. Wall-clock: 103.6s.
Judge: relevance 5, specificity 4, rebuttals 5. Shown as response 2.
Judge's main weakness: Its main weakness is that the 90-day plan is a bit less leadership-ready: it has fewer numeric targets or success thresholds, so it is less concrete about what improvement should be achieved by the end of the quarter.
Judge's overall pick: full.
Judge rationale: Both recommendations are highly relevant and correctly advise against a microservices migration this quarter. Response 2 handles safety and objections slightly better, but Response 1 gives a more concrete quarter plan with day ranges, measurable baselines, ownership steps, and an explicit deploy-time target, which better fits the user’s request for what to do in the next 90 days, in order.
Pipeline: passed-first-try.
Room notices: Condensing earlier rounds

## Transcript

```text
USER: Our Rails monolith serves 40k daily users and 8 engineers work in it. Deploys take 45 minutes and teams step on each other. Leadership wants to move to microservices. Is that the right fix?
Bleu: Not enough evidence that microservices are the fix. Confirmed: 40k daily users, 8 engineers, 45-minute deploys, coordination pain. None of that proves service boundaries are the bottleneck.

With only 8 engineers, microservices can worsen the problem: more repos, CI pipelines, observability, incident paths, data consistency issues, versioning, and deployment choreography.

I’d first test cheaper hypotheses: slow CI, manual release gates, weak code ownership, tangled domain boundaries, flaky tests, oversized PRs, shared database coupling. Likely first move: modularize the monolith, define ownership boundaries, improve CI/deploy automation, and measure lead time/failure rate.

Microservices only make sense if specific domains need independent scaling, deploy cadence, or ownership.
Ruby: Bleu’s caution is right, but “test cheaper hypotheses” needs a hard execution plan or it becomes another study.

Decision: do not start a microservices migration now. Set 30-day targets: deploy time under 15 minutes, clear code ownership for top conflict areas, CI bottlenecks ranked and fixed, release process automated where possible. Assign owners, not committees.

Only consider extracting a service after one domain has clear ownership, stable boundaries, and a proven need for independent deploys. Otherwise leadership is buying complexity, not speed.
Jade: Bleu is right that the evidence doesn’t justify microservices yet, but the bigger risk is trust: if leadership frames this as “architecture will fix collaboration,” engineers may inherit more operational burden without solving unclear ownership.

I’d make success explicit: faster, safer deploys; fewer merge/release conflicts; clearer accountability; sustainable on-call. Start by assigning durable domain ownership inside the monolith, improving deploy flow, and setting team working agreements. If a boundary remains stable and painful after that, extract it deliberately—not as a morale-draining rewrite.
USER: About 70% of the deploy time is the test suite. Most merge conflicts are in the billing and notifications code.
Ruby: That points away from microservices and straight at two workstreams.

1. Cut test time first. 45 min deploy with 70% tests means ~31 min in tests. Target: under 10. Parallelize, quarantine flakes, split unit/integration/system tests, run only required suites pre-merge, keep full suite post-merge/nightly if needed.

2. Stop conflicts in billing/notifications. Assign explicit owners, freeze drive-by edits, create smaller PRs, and refactor those areas into internal modules with clear APIs.

Do this for 30 days before extracting anything. Microservices won’t fix slow tests or chaotic ownership.
Bleu: Ruby’s plan is directionally right, but “run only required suites pre-merge” is unsafe unless test selection is backed by reliable dependency mapping. Otherwise you trade 45-minute deploys for escaped regressions.

Confirmed: tests are the main deploy bottleneck; billing/notifications are conflict hotspots. Recommendation: don’t migrate yet. First profile the suite, parallelize high-value tests, remove flakes, and separate slow integration/system tests from fast unit tests. For billing/notifications, create internal module boundaries and owners. Extract later only if those boundaries stay stable and still need independent deploys.
Ruby: Fair correction on unsafe test selection. But don’t let “reliable dependency mapping” become a blocker. Start with low-risk wins: parallelize the full suite, kill flakes, move obviously slow end-to-end tests out of the critical deploy path only if covered by faster lower-level tests, and measure escaped defects. The execution risk is analysis paralysis; 31 minutes of tests is concrete waste. Cut it aggressively, but with rollback criteria.
Jade: Bleu’s safety concern is important, but I’d make it explicit for billing/notifications: these are trust-sensitive areas. A faster deploy is not a win if invoices, payments, or customer messages become less reliable.

Set a rule: reduce test time through profiling, parallelization, isolation, and flake repair before deleting coverage. Any removed slow test in billing/notifications needs replacement coverage or a documented risk owner.

Also, ownership cannot be “whoever touched it last.” Make billing and notifications review paths visible and durable so engineers stop negotiating every change ad hoc.
Lemon: Ruby’s urgency is right, but “conflict areas” aren’t equal. Use Billing and Notifications as boundary experiments, not just cleanup targets.

Notifications is the safer decoupling candidate: async, event-driven, lower consistency risk. Billing is the trap: money, audits, reconciliation, edge cases—stabilize it inside the monolith first.

So: modularize both with owners and APIs, but only treat Notifications as a possible extraction path. Add test impact analysis around these modules; you may get microservice-like deploy speed without buying microservice operations.
Ruby: No, I still disagree with treating Notifications as an extraction path yet. “Async” doesn’t mean cheap—delivery guarantees, retries, idempotency, observability, and support queues become real work fast.

Make it an internal boundary first: event interface, owner, contract tests, fewer conflicts, faster deploys. If that holds for a month and Notifications still blocks independent changes, then extract. Until then, service talk is a distraction from cutting the 31-minute test bottleneck.
USER: We have no dedicated platform or SRE people. One engineer knows Kubernetes.
Ruby: That’s the nail in the coffin for microservices right now.

With no platform/SRE support and one Kubernetes-capable engineer, a migration creates a single-person bottleneck and a new failure mode. You’ll slow deploys, not speed them up.

Recommendation: keep the monolith, modularize billing/notifications, and attack the test suite. Avoid Kubernetes as a required path. If you need infrastructure changes, use boring managed services and Rails-friendly tooling first.

Success target: faster deploys and fewer conflicts without adding 24/7 distributed-systems ownership to 8 engineers.
Bleu: Ruby is right on the conclusion; the extra risk is bus factor. But “managed services” are not automatically safe—someone still owns deploys, monitoring, incidents, secrets, data migrations, and rollback.

Confirmed constraints now make microservices infeasible as a primary fix: 8 engineers, no platform/SRE, one Kubernetes-capable person, test-heavy deploy bottleneck, conflicts in two code areas.

Recommendation: no migration. Define an operational readiness checklist for any future extraction: owner, on-call, alerts, rollback, runbooks, CI under control, and stable module boundary proven inside the monolith.
Jade: Bleu covered the readiness checklist; I’d add the people boundary: leadership must not quietly turn the one Kubernetes-capable engineer into the platform team.

Make “no hero operations” explicit. No extraction unless support is spread across multiple engineers, incident expectations are written, and the team has time allocated to learn—not squeezed between feature work. Otherwise the migration creates dependency, burnout, and slower delivery disguised as modernization.

Right now, the humane and practical fix is monolith modularization plus test/deploy improvement.
Lemon: Bleu’s operational checklist is necessary, but a pure “no migration” answer may squander leadership’s appetite to fix structure. Redirect that energy into microservice-like benefits without service sprawl.

Make Billing and Notifications internal products: named owners, explicit APIs/events, contract tests, module-level CI timing, and dashboards showing change volume/conflicts. That creates autonomy and boundary proof inside the monolith.

Assumption: no platform team is coming soon. Under that, extraction is not a plan; it’s a future option only after the boundary works operationally inside Rails.
USER: Leadership needs a one-quarter plan. What do we do in the next 90 days, in order?
Ruby: 90-day plan, in order:

**Weeks 1–2: Freeze the microservices push. Measure first.**
- Declare: no service extraction this quarter.
- Baseline deploy time, test time by suite/file, flaky tests, failed deploy causes, conflict hotspots.
- Name owners for **billing** and **notifications**.
- Require owner review for those areas.

**Weeks 3–5: Cut CI/deploy waste.**
- Parallelize the full test suite.
- Fix or quarantine flaky tests with named owners.
- Identify top 20 slow tests; rewrite, split, or move only where replacement coverage exists.
- Target: reduce deploy from **45 min to under 30 min**.

**Weeks 6–8: Reduce stepping on each other.**
- Create internal boundaries for billing/notifications: clear APIs, folders/modules, ownership rules.
- Stop drive-by edits: small PRs, explicit reviewers, no mixed billing+unrelated changes.
- Add contract/module tests around billing and notifications.

**Weeks 9–11: Make releases boring.**
- Automate manual release steps.
- Add rollback checklist.
- Track escaped defects, deploy frequency, conflict count, and CI failure reasons.
- Target: deploy under **20–25 min**, fewer recurring conflicts.

**Week 12: Leadership decision gate.**
- If deploy time/conflicts improved: keep investing in monolith modularization.
- If not: identify the actual blocker.
- Microservices only re-enters discussion if there’s a proven boundary, multiple trained operators, and written ownership/on-call.
Jade: Ruby’s order is right, but the flaw is assuming teams can absorb this alongside normal feature pressure. Leadership must fund the plan with capacity, not slogans.

Add to Week 1: publish “no hero ops / no hidden platform team.” The Kubernetes-capable engineer is not the migration strategy.

Add throughout: reserve explicit engineering time for CI, modularization, reviews, and learning; otherwise conflicts continue.

Add Week 12 gate: success includes no new single-person dependencies, no expanded on-call burden, and engineers agreeing ownership rules are workable—not just faster deploy metrics.
Lemon: Ruby’s order is right, but the blind spot is leadership optics: “no microservices” can sound like “no modernization.” Package the quarter as a **service-readiness program inside the monolith**.

Add three deliverables:
- **Boundary scorecards** for Billing/Notifications: owners, APIs/events, dependency count, conflict count, CI time.
- **Internal product contracts**: documented extension points plus contract tests so teams stop editing internals.
- **Extraction readiness rubric** for Week 12: not “should we do microservices?” but “which boundary, if any, is operationally mature enough?”

That keeps momentum without creating service sprawl.
Bleu: Ruby’s sequence is usable, but the Week 9–11 “20–25 minutes” target is unsupported. Promise outcomes only after Week 1–2 baseline; otherwise leadership may pressure unsafe test removal.

Lemon’s “service-readiness” framing is useful, but the rubric must be strict: no extraction candidate unless CI is controlled, ownership is written, multiple operators are trained, rollback/alerts/runbooks exist, and the boundary has worked inside Rails.

Quarter plan should be metric-gated: baseline → safe CI gains → module boundaries → release automation → Week 12 decision from evidence, not modernization optics.
```

## Rolling summary (folded through message 11)

Objective: what the user is trying to achieve.  
Determine whether moving a Rails monolith to microservices is the right way to reduce 45-minute deploys and team coordination/conflict problems, or whether lower-cost fixes should be tried first.

Confirmed by the user: constraints, facts, preferences, and decisions the user stated or agreed to.  
- The system is a Rails monolith.  
- It serves 40k daily users.  
- 8 engineers work in it.  
- Deploys take 45 minutes.  
- Teams “step on each other.”  
- Leadership wants to move to microservices.  
- About 70% of deploy time is the test suite, implying roughly 31 minutes of test time.  
- Most merge conflicts are in billing and notifications code.  
- The user has not confirmed any decision to migrate, not migrate, modularize, or change CI/test strategy yet.

Assumptions: things raised but not confirmed by the user.  
- Microservices may add more complexity than benefit with only 8 engineers: more repos, CI pipelines, observability, incident paths, data consistency issues, versioning, deployment choreography, and operational burden.  
- Current pain may be caused by slow CI/tests, manual release gates, weak ownership, tangled domain boundaries, flaky tests, oversized PRs, or shared database coupling rather than monolith architecture itself.  
- Billing is higher-risk than notifications because it involves money, audits, reconciliation, and edge cases.  
- Notifications may be more naturally async/event-driven, but extraction would still require delivery guarantees, retries, idempotency, observability, and support workflows.  
- Internal modularization may deliver many microservice-like benefits without service-level operational cost.  
- Reducing test time through unsafe test selection could increase escaped regressions unless backed by reliable dependency mapping or replacement coverage.

Positions: what each advisor has argued, including disagreements and changes of mind.  
- Bleu: Microservices are not justified by the evidence. The confirmed facts show deploy and coordination pain, not that service boundaries are the bottleneck. First profile and improve the test suite, parallelize, remove flakes, separate slow integration/system tests from faster unit tests, and create owned internal module boundaries for billing/notifications. Warned that running only selected pre-merge tests is unsafe without reliable dependency mapping. Extract services only if stable boundaries still need independent deploys.  
- Ruby: Strongly recommends not starting a microservices migration now. Wants a concrete 30-day execution plan: reduce deploy/test time, assign owners, rank/fix CI bottlenecks, automate release process, stop drive-by edits in billing/notifications, create smaller PRs, and modularize with clear APIs. Initially suggested running only required pre-merge suites, then accepted Bleu’s safety correction and narrowed to low-risk wins: parallelize full suite, kill flakes, move obviously slow end-to-end tests out of the critical path only with replacement lower-level coverage, and measure escaped defects. Disagrees with treating notifications as an extraction path yet.  
- Jade: Focuses on trust, ownership, and sustainable collaboration. Warns that “architecture will fix collaboration” may dump operational burden on engineers without solving unclear accountability. Success should mean faster/safer deploys, fewer conflicts, clearer accountability, and sustainable on-call. Billing/notifications need visible, durable review paths. Test reduction must not reduce reliability, especially in billing/notifications; removed slow tests need replacement coverage or a documented risk owner.  
- Lemon: Suggests using billing and notifications as boundary experiments. Argues notifications is a safer possible decoupling candidate because it is more async/event-driven, while billing should be stabilized inside the monolith. Recommends modularizing both with owners/APIs and adding test impact analysis. Ruby explicitly disagrees with treating notifications as an extraction path before proving an internal boundary works.

Open questions: questions marked not answered yet, and who asked them.  
- None explicitly asked by the advisors and left unanswered.

## Final recommendation

Recommendation: do not start a microservices migration this quarter. Run a 90-day “service-readiness inside the monolith” program: reduce deploy time, modularize billing/notifications, clarify ownership, and create an evidence-based Week 12 decision gate.

Why: your deploy bottleneck is mostly the test suite—about 31 of 45 minutes—not proven service boundaries. Conflicts are concentrated in billing and notifications, which suggests ownership and modularity problems. With 8 engineers, no platform/SRE team, and only one Kubernetes-capable engineer, microservices would add operational load, bus-factor risk, deployment complexity, monitoring, rollback, incidents, and on-call burden before solving the known problems.

Strongest objections:
- “Leadership wants modernization.” Reframe this as modernization without service sprawl: internal products, explicit APIs/events, contract tests, boundary scorecards, and extraction-readiness criteria.
- “Notifications might be extractable.” Maybe later, but first prove the boundary inside Rails. Extraction is not justified until ownership, CI, alerts, rollback, runbooks, and multiple trained operators exist.
- “We need faster deploys now.” That points to CI/test/deploy work first, not microservices.

90-day plan:
1. Weeks 1–2: pause extraction. Baseline deploy time, test timing, flaky tests, conflict hotspots, failed deploy causes. Name billing/notifications owners. State “no hero ops”: the Kubernetes engineer is not the platform team.
2. Weeks 3–5: parallelize the full suite, fix/quarantine flakes, attack the slowest tests safely, without removing coverage blindly.
3. Weeks 6–8: define billing/notifications APIs, ownership rules, small-PR rules, and contract/module tests.
4. Weeks 9–11: automate release steps, add rollback checklist, track defects/conflicts/CI failures.
5. Week 12: decide from evidence whether to continue modularization or consider any extraction candidate.
