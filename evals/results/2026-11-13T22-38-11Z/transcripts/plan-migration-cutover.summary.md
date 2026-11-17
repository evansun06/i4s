# plan-migration-cutover · summary

Category: planning. Completed: true.
Agent turns: 16. Calls: 41. Wall-clock: 92.2s.
Judge: relevance 4, specificity 4, rebuttals 5. Shown as response 2.
Judge's main weakness: It is solid but less tied to the user’s specific low-write 2–5 a.m. window and lacks some concrete cutover gates such as GTID/binlog capture timing, lag criteria, and legal/comms sign-off details.
Judge's overall pick: full.
Judge rationale: Both recommendations are technically sound and correctly reject an unrehearsed cutover or blind rollback after target writes begin. Response 1 is better overall because it more directly incorporates the user's specific facts, including the 2–5 a.m. low-write window, 50 writes/sec context, 1:30 a.m. go/no-go gate, GTID/binlog validation, and legal sign-off. Response 2 has slightly stronger explicit objection handling, but it is less specific to the stated migration scenario.
Pipeline: passed-after-repair (invalid-reference, unsupported-commitment).
Room notices: Condensing earlier rounds

## Transcript

```text
USER: We need to move 2TB of customer data from a self-hosted MySQL to a managed cloud database with under 15 minutes of downtime. Plan the migration.
Lemon: Don’t “move 2TB” during the downtime window; make downtime only the cutover. Assumption: target is MySQL-compatible managed DB.

Plan: provision target, schema/parameter parity, network/private connectivity, then bulk load from backup/snapshot into target while source stays live. Start CDC replication from MySQL binlog using DMS/Debezium/native replication. Run validation continuously: row counts, checksums, key tables, app smoke tests. Do a rehearsal cutover and rollback drill. Final window: freeze writes, wait for replication lag = 0, validate critical checksums, switch connection/DNS, monitor, keep source read-only for rollback. Success = <15 min write outage, no data loss.
Ruby: Use online replication, not dump/restore downtime fantasy.

Plan:
1. Confirm target is MySQL-compatible and provision equal/better capacity.
2. Run schema compatibility checks, fix unsupported features.
3. Take physical backup/snapshot, restore to managed DB.
4. Start binlog replication or cloud migration service from source to target.
5. Let it catch up; load-test target with production-like traffic.
6. Freeze schema changes 24–48h before cutover.
7. Cutover window: stop writes, wait replication lag = 0, point app to target, smoke test, reopen writes.
8. Keep source read-only for rollback. Downtime target: minutes.
Jade: Ruby and Lemon cover the mechanics, but the blind spot is people-facing risk: a technically clean cutover can still fail if app owners, support, and customers are surprised. Confirmed: 2TB MySQL, managed cloud target, <15 min downtime. Assumption: downtime means write outage.

Add: name service owners, freeze schema/app changes, brief support/customer-facing teams, prepare status-page/comms, and define rollback authority before cutover. During cutover, pause writes and drain queues/workers—not just database traffic—then smoke-test customer-critical workflows before reopening. Keep source read-only until trust is earned.
Bleu: Bleu: Lemon’s plan is directionally right, but it under-specifies the failure criteria. Confirm before execution: binlog retention exceeds full-load duration plus replay buffer, CDC tool supports your MySQL version/DDL patterns, and target has tested parameter/charset/collation parity. Do not trust row counts alone; use checksums on critical/high-churn tables and test app writes against staging. Set rollback trigger thresholds: replication divergence, unacceptable lag, failed smoke tests. Freeze DDL well before cutover. Downtime is feasible only if final lag reaches near-zero before write freeze.
USER: Writes come in 24/7 but drop to about 50 per second between 2 and 5 a.m.
Jade: That low-write window is the humane cutover window: fewer failed/retried customer actions, less support load, and easier rollback if trust breaks. But don’t advertise “2–5 a.m. means safe” as a guarantee—treat it as reduced risk.

Plan staffing around that window: DB, app, infra, support, and decision owner awake and reachable. Warn customer-facing teams about possible brief write unavailability. During freeze, show users clear maintenance/retry behavior rather than silent failures. Also drain or pause background jobs/queues so they don’t surprise the target after reopening.
Ruby: Good. Use 2–5 a.m. as the cutover window, not the migration window.

Execution adjustment:
- Start full load + CDC days before.
- Monitor lag during several 2–5 a.m. periods; prove it can stay near zero at ~50 writes/sec.
- Schedule cutover at 2 a.m., with go/no-go by 1:30.
- At cutover: stop writes, drain workers/queues, wait lag = 0, validate critical checks, switch app, smoke test, reopen.
- Abort if lag isn’t near-zero before freeze.

Do a rehearsal in the same traffic window.
Lemon: Ruby’s plan is solid, but “stop writes” is too blunt if the app can do better. Use the 2–5 a.m. window for a controlled write-brownout: keep reads online, pause queues/workers, and either queue or return retryable responses for mutating requests. That makes the outage feel smaller than a full maintenance event.

Also rehearse the exact low-traffic behavior: queued writes, retries, idempotency, and post-cutover replay. Assumption: the app can separate reads from writes; if not, fall back to full write freeze.
Bleu: Lemon, queuing writes can reduce visible outage, but it is only safer if idempotency, ordering, and replay failure handling are proven. Otherwise use a hard write freeze.

Before approving cutover, collect evidence: binlog generation rate, CDC sustained apply rate, lag decay after peak, and checksum duration for critical/high-churn tables. At 50 writes/sec, the target is feasible only if lag is already near-zero before freeze.

Also reduce cutover mechanics risk: lower DNS TTL beforehand and verify app instances/connection pools actually reconnect to the managed DB during smoke tests.
Lemon: Agreed on not doing blind replay. New point: the write-brownout can be implemented as a reversible feature flag, not a migration-only hack. A centralized “write gate” lets us switch between normal writes, retryable maintenance responses, or durable queueing per endpoint. That gives the cutover team a safer throttle during migration and a future operational control for incidents. If they don’t already have this abstraction, use hard freeze now—but consider building it before the next major data move.
USER: We've never done a rehearsal migration and the legal team requires that no data be lost.
Jade: Legal “no data loss” makes a first-time production cutover unacceptable. Do at least one rehearsal on a restored copy with CDC, validation, rollback, and named decision authority. This protects customers and the team from improvising under pressure.

Set expectation: downtime target is flexible only if data safety is not. If rehearsal exposes uncertainty, delay cutover.

Also define who can approve go/no-go, who notifies support/legal, and what evidence proves no loss: CDC lag zero, critical checksums, audit counts, and successful customer-critical write tests after cutover.
Ruby: Jade is right on rehearsal, but “at least one” is the floor, not the comfort zone. Legal no-loss means we optimize for RPO=0, not elegance.

Execution decision:
- No production cutover until a rehearsal completes successfully.
- Use hard write freeze, not queued/replayed writes, unless that path is already proven.
- Rehearse full load + CDC + lag-to-zero + checksum validation + rollback.
- Define abort triggers before the window.
- Keep source read-only after cutover until validation passes.

If rehearsal fails, the schedule slips. Data loss is not an acceptable trade.
Lemon: Ruby/Jade are right to block production until rehearsal, but don’t waste the rehearsal as a checkbox. Make it a full dress rehearsal that produces reusable artifacts: timed runbook, validation report, cutover/rollback scripts, owner checklist, and legal evidence pack.

Given “no data loss,” assumption: RPO must be 0. So no unproven write queue/replay path. Hard write freeze, drain workers, CDC lag zero, validate, then switch. If rehearsal timing exceeds 15 minutes, improve automation—not the risk tolerance.
Bleu: Ruby’s direction is right, but “rehearsal succeeded” needs objective acceptance criteria, not confidence. Legal no-loss means RPO=0 with evidence: source write freeze timestamp, CDC position/GTID captured, lag zero, checksum/audit reconciliation for critical and high-churn tables, and verified app writes on target after cutover.

Do not use queued replay unless exactly-once/idempotent behavior has already been proven. Production cutover is no-go if the rehearsal cannot complete freeze → lag zero → validation → app switch inside 15 minutes, or if rollback steps are untested.
USER: What is the rollback plan if we find problems an hour after cutover?
Jade: An hour after cutover, rollback is risky because the target may now contain new customer writes. Do not simply point the app back to the old source unless reverse replication/reconciliation is already proven.

Plan should be:

- Keep old source read-only, not writable.
- If severe issue appears: immediately freeze writes again.
- Decide: fix-forward on target, or rollback only after syncing target changes back to source.
- Have legal/support/customer comms ready before cutover.
- Name one rollback authority.

For trust: tell teams “rollback after writes requires data reconciliation,” not “instant switchback.”
Ruby: One hour after cutover, “rollback” is no longer simple unless we planned reverse replication. Once writes hit the target, switching back to the old source without copying those writes back violates no-data-loss.

Plan:

- Keep old source intact and read-only after cutover.
- Start reverse CDC from target → old source immediately, if supported.
- If serious issue appears: freeze writes, drain workers, confirm reverse lag = 0, validate critical checksums/audit counts, switch app back, smoke test, reopen writes.
- If reverse CDC is not proven, do not roll back blindly. Freeze writes and fix forward or export/apply target delta with validation.

No proven reverse path = rollback is manual incident recovery, not a plan.
Bleu: Jade is right, but “sync target changes back” is not a plan unless it is engineered before cutover.

Define rollback as conditional:

- Keep old source intact and read-only.
- If problems appear: freeze writes immediately.
- If issue is app/config/performance, prefer fix-forward on target.
- If data corruption/divergence: stop, preserve evidence, do not switch.
- Roll back only if reverse CDC/back-sync was rehearsed: target → old source, validate GTID/binlog position plus checksums/audit counts, then repoint app.
- If reverse sync is unproven, rollback means data loss. Don’t do it.
```

## Rolling summary (folded through message 11)

Objective: what the user is trying to achieve.  
Migrate 2TB of customer data from a self-hosted MySQL database to a managed cloud database with under 15 minutes of downtime, using a plan that avoids moving the full dataset during the downtime window.

Confirmed by the user: constraints, facts, preferences, and decisions the user stated or agreed to.  
- Source database: self-hosted MySQL.  
- Data volume: 2TB of customer data.  
- Target: a managed cloud database.  
- Downtime requirement: under 15 minutes.  
- Writes occur 24/7.  
- Write volume drops to about 50 writes/second between 2 a.m. and 5 a.m.  
- No target cloud/provider or exact managed database engine has been confirmed.

Assumptions: things raised but not confirmed by the user.  
- Target is MySQL-compatible.  
- “Downtime” means write outage, with reads potentially remaining online.  
- The app may be able to separate reads from writes.  
- The app may support either hard write freeze, retryable maintenance responses, or durable queueing.  
- Binlog-based CDC/native replication/cloud migration tooling is available and compatible.  
- DNS or connection-string cutover is part of the switch.  
- Queues/workers/background jobs exist and must be paused or drained.  
- A rehearsal environment and production-like load testing are possible.

Positions: what each advisor has argued, including disagreements and changes of mind.  
Ruby: Do not attempt dump/restore during downtime. Use online replication: provision target with equal/better capacity, check schema compatibility, restore physical backup/snapshot, start binlog replication/cloud migration service, catch up, load-test, freeze schema changes 24–48h before cutover, then stop writes, drain queues/workers, wait for replication lag = 0, validate, switch app, smoke test, reopen writes. Use 2–5 a.m. as the cutover window, not the migration window. Schedule go/no-go by 1:30 a.m.; abort if lag is not near-zero. Rehearse in the same low-traffic window.

Lemon: Make downtime only the final cutover. Bulk-load while source stays live, then CDC. Suggested a controlled write-brownout instead of blunt stop-writes if the app can support it: reads stay online, queues/workers pause, mutating requests are queued or receive retryable responses. Later agreed with Bleu that blind replay is dangerous; proposed a reversible centralized “write gate” feature flag that can switch between normal writes, retryable maintenance, or durable queueing per endpoint. If that abstraction does not exist, use hard freeze now.

Jade: Emphasized people and operational risk. Name service owners, freeze schema/app changes, brief support/customer-facing teams, prepare status-page/customer comms, and define rollback authority before cutover. Treat 2–5 a.m. as reduced-risk but not safe by default. Staff DB, app, infra, support, and decision owner during the window. Ensure clear maintenance/retry behavior for users and smoke-test customer-critical workflows before reopening.

Bleu: Focused on evidence and failure criteria. Confirm binlog retention exceeds full-load duration plus replay buffer; CDC tool supports MySQL version and DDL patterns; target has parameter/charset/collation parity. Do not trust row counts alone—use checksums on critical/high-churn tables and staging write tests. Collect binlog generation rate, CDC apply rate, lag decay after peak, and checksum duration. Set rollback/abort triggers: divergence, unacceptable lag, failed smoke tests. Lower DNS TTL and verify app instances/connection pools reconnect. Warned that write queueing is only safer if idempotency, ordering, and replay failure handling are proven; otherwise use hard freeze.

Open questions: questions marked not answered yet, and who asked them.  
- Is the managed cloud target MySQL-compatible? Asked by Lemon/Ruby implicitly.  
- What cloud provider/managed database product is being used? Not yet answered.  
- Does downtime mean write outage only, or full read/write unavailability? Raised by Jade/Lemon.  
- Can the app separate reads from writes? Raised by Lemon.  
- Are queued writes/idempotency/ordering/replay failure handling already proven? Raised by Bleu/Lemon.  
- What MySQL version, binlog settings, DDL patterns, charset/collation, and unsupported features exist? Raised by Bleu/Ruby.  
- Is binlog retention long enough for full load plus replay buffer? Raised by Bleu.  
- How will app connections switch—DNS, config, service discovery—and will pools reconnect cleanly? Raised by Bleu.

## Final recommendation

Panel recommendation: use an online full-load + CDC migration with a hard write freeze for cutover, but do not attempt production cutover until you have rehearsed the full process, including rollback. For one-hour-after-cutover rollback, do not simply point the app back to the old MySQL source unless reverse sync from target back to source has been built, tested, and validated.

Why: you have 2TB of data, 24/7 writes, under-15-minute downtime, and a legal “no data loss” requirement. That rules out dump/restore during downtime and rules out improvised rollback after new writes have landed on the managed target. After cutover, the target becomes the system of record. Switching back without preserving those writes would violate RPO=0.

Strongest objections:  
- “Can we queue writes and replay them?” Only if exactly-once/idempotency, ordering, and replay failure handling are already proven. Otherwise use hard freeze.  
- “Can we instantly roll back?” Not after an hour of target writes unless reverse CDC/back-sync has been rehearsed. Otherwise rollback is manual incident recovery, not a safe plan.  
- “Can we skip rehearsal?” No. Legal no-loss makes first-time production execution unacceptable.

Concrete next steps:  
1. Confirm target engine/provider and MySQL compatibility.  
2. Build full load + binlog/CDC replication to target.  
3. Run dress rehearsal: freeze writes, drain workers, lag to zero, validate checksums/audit counts, switch app, smoke test, and test rollback.  
4. Keep old source intact and read-only after cutover.  
5. If post-cutover issue occurs: freeze writes immediately; prefer fix-forward. Roll back only after rehearsed target→source sync reaches zero lag and validation passes.
