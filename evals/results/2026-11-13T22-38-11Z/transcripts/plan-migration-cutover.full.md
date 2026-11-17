# plan-migration-cutover · full

Category: planning. Completed: true.
Agent turns: 16. Calls: 40. Wall-clock: 71.5s.
Judge: relevance 5, specificity 5, rebuttals 4. Shown as response 1.
Judge's main weakness: Rollback is handled correctly but somewhat compressed; it could more explicitly spell out the one-hour incident sequence and reverse target-to-source sync steps in the final recommendation.
Judge's overall pick: full.
Judge rationale: Both recommendations are technically sound and correctly reject an unrehearsed cutover or blind rollback after target writes begin. Response 1 is better overall because it more directly incorporates the user's specific facts, including the 2–5 a.m. low-write window, 50 writes/sec context, 1:30 a.m. go/no-go gate, GTID/binlog validation, and legal sign-off. Response 2 has slightly stronger explicit objection handling, but it is less specific to the stated migration scenario.
Pipeline: passed-after-repair (unsupported-commitment).

## Transcript

```text
USER: We need to move 2TB of customer data from a self-hosted MySQL to a managed cloud database with under 15 minutes of downtime. Plan the migration.
Jade: I’d protect customer trust by making this a rehearsed, reversible cutover—not a heroic weekend move. Confirmed: 2TB MySQL, managed cloud target, <15 min downtime. Assumptions: schema-compatible MySQL, app can briefly enter read-only/maintenance mode.

Plan must include: stakeholder comms, customer-facing maintenance notice, dry-run restore and replication test, data validation owners, rollback criteria, and staffed war room. Use online replication/CDC to sync while production runs, then freeze writes, verify replica lag is near zero, cut app over, monitor errors/performance, keep old DB read-only until confidence is high.
Bleu: Confirmed: 2TB MySQL migration, downtime <15 min. Assumptions: target is MySQL-compatible, binlogs available, stable network/VPN, app can be briefly write-paused.

Plan: enable row-based binlogs/GTID; provision target; migrate schema/users/parameters; run full load with parallel dump/restore or cloud DMS; start CDC from binlog; validate row counts/checksums and replication lag; rehearse cutover with timing. Final cutover: freeze writes, wait for CDC lag=0, run final validation, switch connection/DNS, unfreeze. Rollback: keep source authoritative until post-cutover checks pass.
Ruby: Confirmed: 2TB MySQL, managed cloud target, downtime <15 min. Direct path: online migration, not dump/restore cutover.

Plan:
1. Pick compatible managed MySQL version/config; provision oversized target.
2. Enable binlog/GTID on source; take backup via Percona XtraBackup/cloud migration tool.
3. Restore seed to target.
4. Start continuous CDC replication source→target.
5. Run validation: row counts/checksums, app smoke tests, performance tests.
6. Freeze risky writes, stop app briefly, let replication hit zero lag.
7. Point app/DNS/secrets to target; verify; keep source read-only rollback window.

Assumption: schema fits managed MySQL without unsupported features.
Lemon: Bleu/Jade are right on CDC, but both underplay cutover mechanics: DNS/connection-string flips can burn the 15 minutes through TTLs, stale pools, and rollback confusion. I’d design this as blue/green DB access: put a proxy or config-controlled DB endpoint in front now, rehearse switching it before migration day, and make app instances recycle connections on command. Opportunity: provision target deliberately oversized for migration/catch-up, then scale down after stability. That buys speed without making it permanent cost.
USER: Writes come in 24/7 but drop to about 50 per second between 2 and 5 a.m.
Jade: That write pattern makes 2–5 a.m. the cutover window, but it doesn’t remove the need for a controlled write freeze. Low volume is not zero volume; customers still need predictable behavior.

I’d schedule a rehearsed cutover inside that window with on-call support staffed, not exhausted. Put the app into read-only/maintenance for the final sync, show a clear customer message, and have support prepared for “can I still view data?” issues. Success means no lost writes, clear customer expectations, and a rested team able to monitor after reopening.
Lemon: 50 writes/sec is a gift, not a downtime window by itself. Use 2–5 a.m. for the final cutover, but don’t rely on “low traffic” to save a weak plan.

I’d add a write-gate option: during cutover, temporarily queue writes at the app/API layer instead of failing them or forcing full maintenance. Reads can continue if safe; writes drain after target is live. That can turn “15 minutes downtime” into “brief write latency,” which customers may tolerate better. Rehearse that queue/drain behavior, not just DB replication.
Bleu: 50 writes/sec helps, but it is not the key metric. The key is binlog volume and replication apply rate on the target. If CDC can sustain peak traffic and catch up from full-load lag, the 2–5 a.m. window is enough for cutover.

I’d schedule cutover at 2 a.m., block writes/read-only, wait for `Seconds_Behind_Master=0` or equivalent confirmed LSN/GTID alignment, then switch. Also freeze schema changes and long-running batch jobs before cutover; those are more likely to break the 15-minute limit than 50 small writes/sec.
Ruby: Lemon’s write-queue idea is useful only if it already exists or can be rehearsed safely. Building a new queue for cutover can create duplicate/lost-write risk—worse than 15 minutes read-only.

Execution gates:
- Use 2–5 a.m. for cutover only.
- Full load done earlier; CDC running.
- By 1:30 a.m., lag must be consistently near zero.
- At cutover, pause writes/read-only, wait lag=0, flip endpoint/config, restart pools, smoke-test writes, reopen.

Hard rule: if lag isn’t near zero before freeze, abort. Don’t improvise.
USER: We've never done a rehearsal migration and the legal team requires that no data be lost.
Ruby: No rehearsal history changes the plan: production cutover is not allowed until at least one full rehearsal passes. Legal “no data lost” means we prioritize correctness over the 15-minute target if forced.

Immediate actions:
- Build staging target and run full 2TB rehearsal using production-like backup/CDC.
- Prove restore, CDC catch-up, validation, cutover timing, and rollback.
- Define loss checks: GTID/binlog position match, row counts/checksums for critical tables, app write smoke tests.
- During real cutover, block writes. No unproven queue.
- Abort if validation or lag gates fail.
Jade: Ruby’s gate is right, but it misses the trust/audit layer legal will care about. “No data lost” needs named accountability, not just technical checks.

Add: documented dry-run results, validation owner sign-offs, legal/compliance approval before cutover, and a customer/support comms plan for read-only behavior. Keep the old source read-only, retained, and auditable after cutover until reconciliation passes and legal agrees it can be decommissioned.

If rehearsal fails, the team must be empowered to delay—even if the downtime target or launch date suffers.
Lemon: Ruby’s gates are right, but they prove migration mechanics more than legal defensibility. “No data lost” needs an independent evidence trail.

Add a temporary application-side write audit/intent log before cutover: every attempted write gets an ID, timestamp, payload hash, and final status. During validation, reconcile source binlog/GTID, target data, and this audit log. That catches writes blocked, retried, or lost outside MySQL replication.

Bold but necessary: if the audit trail and full rehearsal aren’t ready, delay the migration. Fifteen minutes matters less than provable zero loss.
Bleu: Lemon’s audit log is useful only if it is passive or already safely deployable; adding new write-path behavior right before migration can itself create loss/duplication risk.

Legal-grade RPO=0 needs database-level proof:
- At write-block, record exact source GTID/binlog position.
- Confirm target has applied through that position before reopening.
- Preserve source backups/binlogs until sign-off.
- Keep source read-only during rollback window.
- Validate checksums plus recent-write sampling.

If rehearsal cannot demonstrate these gates, do not cut over.
USER: What is the rollback plan if we find problems an hour after cutover?
Ruby: Rollback after an hour is not “flip back.” Source is stale once target accepts writes.

Plan:
1. Keep source read-only after cutover, never writable.
2. Pre-build and rehearse reverse replication/CDC from target → source, or have a proven replay path from target binlogs/audit log.
3. If major issue appears: immediately freeze writes on target.
4. Decide: fix-forward if possible; rollback only if reverse sync/replay can preserve all post-cutover writes.
5. Apply target changes back to source, validate GTID/checksums/recent writes.
6. Switch app back, smoke test, reopen.

Hard rule: no rehearsed reverse path = no rollback after reopening writes; only read-only/fix-forward.
Bleu: Ruby is right: after reopening writes, source is stale. The missing precision is rollback evidence.

Before cutover, enable target binlogs/GTID and record source/target positions. If problems appear an hour later: freeze target writes, capture the exact target GTID/binlog position, and assess whether reverse CDC/replay has applied every post-cutover transaction to source. Validate with GTID coverage plus checksums/recent-write samples before switching back.

If reverse replay was not rehearsed successfully, rollback violates “no data lost”; fix-forward or go read-only while repairing.
Jade: Ruby and Bleu are right technically, but rollback also needs a human decision protocol. In a live incident, ambiguity causes bad flips.

Add before cutover: named incident commander, legal/comms contacts, severity triggers, and customer/support messaging templates. If problems appear after an hour, immediately choose one mode: fix-forward, read-only containment, or validated failback. Do not let teams debate in production while writes continue.

Old source stays read-only and auditable. Failback only after post-cutover writes are preserved and validated. Trust is protected by clear status updates, not silence.
Lemon: Ruby/Bleu are right that post-cutover rollback needs reverse replay proof, but that framing is too binary. An hour-later “problem” may not require failback.

Define escape hatches by failure type before cutover:
- Performance/config: scale target, tune, fix-forward.
- App compatibility: feature-flag bad paths or put writes read-only while patching.
- Data corruption/migration defect: freeze writes, use rehearsed target→source CDC/replay, validate, then switch back.

Rehearse the decision tree, not just the mechanics. No reverse path means rollback is unavailable after writes reopen.
```

## Final recommendation

Recommendation: use an online CDC/binlog-based migration with a rehearsed, controlled cutover in the 2–5 a.m. low-write window, but do not proceed to production until a full rehearsal proves RPO=0 and the cutover fits within 15 minutes.

Why: you have 2TB of customer data, 24/7 writes, legal requires no data loss, and the downtime target is under 15 minutes. A dump/restore cutover is too risky. Low traffic at ~50 writes/sec helps, but it is not zero; the safe pattern is full load first, continuous replication, then a brief write freeze/read-only period while replication reaches exact GTID/binlog alignment.

Strongest objections:
- A write queue could reduce visible downtime, but if it is not already proven, it adds duplicate/lost-write risk. Do not build new write-path behavior for this migration.
- Rollback after one hour is not a simple flip back. Once the target accepts writes, the source is stale. Failback is allowed only if reverse CDC/replay from target to source has been rehearsed and validated; otherwise use read-only containment or fix-forward.

Concrete next steps:
1. Provision compatible managed MySQL target, oversized for migration.
2. Enable row-based binlogs/GTID; freeze schema changes and risky batch jobs.
3. Run full 2TB rehearsal: seed load, CDC catch-up, validation, endpoint switch, rollback/failback path.
4. Define gates: lag near zero by 1:30 a.m.; exact GTID/binlog capture at write freeze; target applied through that position; checksums/row counts/recent-write validation pass.
5. Prepare comms, legal sign-off, incident commander, war room, support messaging.
6. During cutover: block writes, wait lag=0, switch endpoint/restart pools, smoke test, reopen.
7. Keep source read-only, backups/binlogs retained, until reconciliation and legal approval.
