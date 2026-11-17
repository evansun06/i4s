# tech-monolith-split · full

Category: technical. Completed: true.
Agent turns: 15. Calls: 39. Wall-clock: 67.7s.
Judge: relevance 5, specificity 5, rebuttals 4. Shown as response 1.
Judge's main weakness: Its main weakness is that it does not fully carry forward the discussion’s caution about unsafe test-gate weakening/risk-based test selection, and its extraction gate is somewhat less explicit about runbooks, alerts, multiple trained operators, and release automation.
Judge's overall pick: full.
Judge rationale: Both recommendations are highly relevant and correctly advise against a microservices migration this quarter. Response 2 handles safety and objections slightly better, but Response 1 gives a more concrete quarter plan with day ranges, measurable baselines, ownership steps, and an explicit deploy-time target, which better fits the user’s request for what to do in the next 90 days, in order.
Pipeline: passed-after-repair (invalid-reference).

## Transcript

```text
USER: Our Rails monolith serves 40k daily users and 8 engineers work in it. Deploys take 45 minutes and teams step on each other. Leadership wants to move to microservices. Is that the right fix?
Lemon: Microservices are a possible destination, not the first fix. With 40k users and 8 engineers, the opportunity is probably to create *service-like boundaries inside the monolith* first: modular Rails, clearer ownership, CI/deploy pipeline cuts, feature flags, and maybe extracting only the one or two domains causing the most coordination pain.

Confirmed pain: 45-minute deploys, team collisions. Assumption: reliability and delivery speed matter more than “being microservices.”

Success should be measurable: deploy under 10 minutes, fewer blocked PRs, domain ownership, rollback confidence. Microservices only win if they improve those—not because leadership likes the architecture.
Ruby: Lemon is right that microservices aren’t the first fix, but “service-like boundaries” can become another slow architecture project if you don’t attack the 45-minute deploy first.

My recommendation: assume load is not the problem. Spend 2 weeks profiling CI/deploy and cut the biggest delays: tests, assets, migrations, manual approvals, flaky checks. Set a hard target: deploy under 15 minutes.

In parallel, assign domain ownership to reduce collisions. Only extract a service when one domain has a proven need for independent deploy, scaling, or data ownership.
Jade: Ruby’s 2-week deploy push is useful, but it risks treating symptoms while the team keeps colliding. I’d pair deploy profiling with explicit ownership and working agreements immediately, not “in parallel someday.”

Microservices are not the humane default for 8 engineers: they add on-call, incident coordination, distributed debugging, and more negotiation over contracts/data. If ownership is already unclear, services can harden mistrust.

Assumption: scaling isn’t the constraint. Success: faster deploys, fewer cross-team conflicts, clear domain owners, sustainable support load. Extract only where a team can own it long-term.
USER: About 70% of the deploy time is the test suite. Most merge conflicts are in the billing and notifications code.
Ruby: That data makes the first move obvious: don’t start with microservices.

1. Cut test time first: identify slowest 20% of tests, parallelize CI, split unit/integration/system suites, quarantine flakes, stop running full suite on every tiny change if risk-based selection is feasible.
2. Put billing and notifications under explicit ownership now. CODEOWNERS, review rules, clear interfaces, and separate test boundaries.
3. Consider extraction only after billing/notifications have clean seams and a team ready to own deploys/on-call.

Target: test/deploy time under 15 minutes before any service migration.
Lemon: Ruby’s plan is right on priority, but too CI-centric. The opportunity is to turn billing and notifications into clear product seams, not just faster tests.

Run two time-boxed experiments: make each a Rails module with owners, public APIs/events, and contract tests; then reshape CI around those boundaries with fast PR gates plus slower full-suite runs. If conflicts fall and deploys shrink, stop there. If billing or notifications still needs independent release cadence or isolation, extract only that domain—surgically, not as a “microservices migration.”
Jade: Ruby’s plan is right on sequence, but the blind spot is adoption: faster tests won’t stop collisions if billing and notifications remain “everyone’s code.”

Make those areas owned and legible before extraction: named maintainers, change guidelines, internal APIs/events, and review expectations. Also don’t win test speed by making engineers afraid coverage vanished—split suites, quarantine flakes, and assign owners for slow/brittle tests.

Microservices should wait until a domain has stable ownership and a team ready to support incidents, contracts, and long-term maintenance.
Bleu: Ruby’s direction is right, but risk-based test selection is unsafe until dependency boundaries are known; in a tangled Rails monolith it can create false confidence.

Known: ~31 minutes of deploy time is tests. So microservices are not the first fix; they may add contract/integration tests and distributed failure modes.

I’d prioritize: test timing/flake data, parallelization, suite classification, and reducing deploy-blocking tests. For billing/notifications, prove seams inside Rails first: owners, interfaces, isolated test subsets, and fewer shared edits. Extract only if conflicts persist after measurable modularization.
USER: We have no dedicated platform or SRE people. One engineer knows Kubernetes.
Bleu: That sharply weakens the microservices case. Kubernetes knowledge in one person is not operational capacity; it is a bus-factor risk.

Confirmed: no platform/SRE team. So microservices would add deployment orchestration, observability, incident response, networking, secrets, versioned APIs, and data consistency work to the same 8 engineers already slowed by tests and ownership conflicts.

Recommendation: do not adopt Kubernetes/microservices as the fix. Optimize the monolith first: parallel tests, modular billing/notifications, CODEOWNERS, service-like interfaces, and deploy under 15 minutes. Extract only if you also fund operational ownership.
Ruby: Bleu’s right on the operational risk, but I’d make the decision harder: put a temporary freeze on “microservices migration” unless leadership funds platform capacity.

Your next 30 days should be execution, not architecture debate:

- Parallelize/split the test suite; target deploys under 15 minutes.
- Assign billing and notifications owners with CODEOWNERS.
- Create internal APIs/events around those areas.
- Track merge conflicts and deploy time weekly.

Microservices come back on the table only with dedicated ops ownership or a managed deployment path. Otherwise it’s self-inflicted drag.
Jade: Bleu is right on feasibility; I’d sharpen the people risk. “One engineer knows Kubernetes” means one person becomes the gatekeeper, trainer, incident escalator, and likely burnout point. That damages trust and slows everyone.

Make this a hard constraint: no microservice extraction unless operational ownership is staffed, documented, and shared by more than one person. For now, protect the team: modularize billing/notifications inside Rails, assign maintainers, improve test time, and reduce conflicts without creating a new ops burden.
Lemon: Ruby’s freeze is right, but don’t make this sound like “no modernization.” That invites leadership to keep pushing microservices as the only bold option.

Offer a better modernization path: “service readiness without service sprawl.” Billing/notifications get owners, internal APIs/events, contract tests, observability, rollback paths, and faster CI. If extraction later proves necessary, avoid Kubernetes by default—use boring managed infrastructure first. One Kubernetes-capable engineer is not a platform strategy.

Microservices should be earned by readiness and operational funding, not aspiration.
USER: Leadership needs a one-quarter plan. What do we do in the next 90 days, in order?
Lemon: 90-day plan: sell this as “microservice readiness without operational debt.”

**Days 1–15: Measure and unblock**
- Profile test suite; identify slow/flaky top offenders.
- Parallelize CI if not already.
- Create deploy-time dashboard.
- Freeze broad microservice work unless ops funding appears.
- Assign owners for billing and notifications.

**Days 16–45: Create seams**
- Add CODEOWNERS and review rules for billing/notifications.
- Define internal APIs/events for both domains.
- Split tests by domain where feasible.
- Add contract tests around billing/notifications boundaries.

**Days 46–70: Modernize delivery**
- Target deploys under 15 minutes.
- Introduce fast PR gates plus slower full-suite/nightly checks.
- Add feature flags/rollback playbooks for risky changes.
- Track merge conflicts in billing/notifications weekly.

**Days 71–90: Decide with evidence**
- If deploys/conflicts improved, keep modular monolith path.
- If one domain still blocks independent delivery, propose one extraction candidate.
- But extraction requires named owners, observability, incident process, and preferably managed infrastructure—not Kubernetes by default.
Bleu: Lemon’s plan is directionally right, but one risk: “fast PR gates plus nightly full suite” can hide regressions until boundaries are proven. Don’t weaken deploy gates prematurely.

**Days 1–15:** Baseline test timing, flakes, deploy stages, conflicts, rollback time. Set targets: deploy <15 min, CI tests <10–12 min.

**Days 16–45:** Parallelize/split suites, quarantine flakes, fix slowest tests. Add billing/notifications CODEOWNERS and maintainers.

**Days 46–75:** Create Rails-internal seams: APIs/events, isolated test subsets, contract tests.

**Days 76–90:** Decide: continue modular monolith unless one domain proves extraction-worthy and ops ownership is funded.
Ruby: Lemon’s plan is directionally right, but too soft on deadlines. Make leadership commit to measurable gates:

Days 1–10: freeze microservices work; baseline deploy time, test time, PR cycle time, billing/notifications conflicts.  
Days 11–35: attack tests: parallelize, split suites, quarantine flakes with owners. Gate: deploy under 20 minutes.  
Days 36–60: CODEOWNERS, named maintainers, owner review required, internal APIs/events.  
Days 61–80: isolate billing/notifications tests, add contract tests, remove top shared conflict files.  
Days 81–90: decide: continue modular monolith or fund one extraction with ops ownership.
Jade: Lemon’s plan is solid, but it underplays adoption. If billing/notifications ownership is just a chart, conflicts continue.

Add in Days 1–15:
- publish working agreements: review expectations, escalation path, and who can approve urgent changes
- protect capacity for maintainers so ownership is real, not extra unpaid labor
- baseline review delays and conflict hotspots, not just deploy/test time

Hard constraint: no extraction this quarter unless operational ownership is staffed beyond the one Kubernetes engineer. Otherwise you create a burnout bottleneck.
```

## Final recommendation

Recommendation: **do not start a microservices migration this quarter.** Treat the next 90 days as “microservice readiness without service sprawl”: speed up deploys, create ownership boundaries in the Rails monolith, and only consider extraction later with evidence and operational funding.

Why: your biggest known bottleneck is not scale; it is delivery. Deploys take 45 minutes, and about 70% of that is tests. Conflicts cluster in billing and notifications. You also have 8 engineers, no platform/SRE team, and only one engineer who knows Kubernetes. Microservices would add deployment orchestration, observability, incident response, networking, contracts, and data consistency work to a team already slowed by tests and ownership collisions.

Strongest objections:  
- “Microservices will reduce team conflicts.” Maybe, but unclear ownership inside a monolith often becomes unclear ownership across services, plus harder debugging and operations. Prove seams first.  
- “We need modernization.” Yes—but modernization can be modular Rails, CODEOWNERS, internal APIs/events, contract tests, faster CI, rollback paths, and observability.  
- “Kubernetes is available.” One knowledgeable engineer is a bus-factor and burnout risk, not a platform strategy.

90-day plan:

**Days 1–10:** Freeze broad microservices work. Baseline deploy time, test time, flakes, PR cycle time, rollback time, and billing/notifications conflict hotspots.

**Days 11–35:** Attack tests: parallelize CI, split suites, quarantine flakes with owners, fix slowest tests. Target deploy under 20 minutes.

**Days 36–60:** Assign billing/notifications maintainers, add CODEOWNERS, review rules, working agreements, and escalation paths.

**Days 61–80:** Create Rails-internal seams: APIs/events, isolated test subsets, contract tests, reduce shared conflict files.

**Days 81–90:** Decide with evidence. Continue modular monolith unless one domain still blocks delivery and leadership funds real operational ownership.
