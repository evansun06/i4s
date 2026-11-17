# tech-postgres-vs-dynamo · summary

Category: technical. Completed: true.
Agent turns: 14. Calls: 38. Wall-clock: 84.9s.
Judge: relevance 5, specificity 5, rebuttals 5. Shown as response 1.
Judge's main weakness: It is very strong overall, but it treats sale-event degradation mostly as capacity/rehearsal and monitoring; it is less explicit than response 2 about defining which noncritical workflows may lag and communicating that to support/customers.
Judge's overall pick: summary.
Judge rationale: Both recommendations answer the user's evolving question well and strongly justify managed Postgres/Aurora over DynamoDB for this workload and team. Response 1 is slightly better because it more completely preserves the key exceptions and objections from its discussion—especially active-active multi-region requirements, premature partitioning/search systems, and realistic peak testing with concrete operational metrics. Response 2 adds useful sale-mode guidance, but its rebuttal coverage is a bit less complete.
Pipeline: rejected (invalid-reference).
Room notices: Condensing earlier rounds

## Transcript

```text
USER: We're building an order-tracking service expected to hit 5k writes per second at peak. Should we use Postgres or DynamoDB?
Jade: Don’t choose on write rate alone. At 5k writes/sec both can work, but the human cost differs.

If your team already runs Postgres well and needs relational queries, audits, support tooling, and easy debugging for customer issues, I’d start with Postgres—likely partitioned, tuned, and maybe with a queue/buffer. It keeps operations understandable.

Choose DynamoDB if the access patterns are stable, the team accepts AWS-specific operations, and you need predictable horizontal scaling with less database maintenance.

My bias: pick the system your on-call team can safely explain at 3am.
Ruby (asked the user; not answered yet): Jade is right on ops, but “team comfort” can’t be the whole decision. My execution default: **Postgres first** unless there’s a specific scaling/topology reason not to. 5k writes/sec is manageable with disciplined indexes, pooling, partitioning, and avoiding chatty transactions.

Pick **DynamoDB** only if access is mostly predictable key-based lookups/updates and you’re willing to design around its query limits from day one.

QUESTION: Do you require active-active multi-region writes with low-latency local writes?
USER: Queries are mostly by order ID, but customer support needs to search by email, date range, and status.
Jade: That support requirement pushes me harder toward **Postgres first**, assuming no unmet multi-region write requirement.

“Mostly by order ID” fits DynamoDB, but customer support searching by **email, date range, and status** is exactly where DynamoDB designs get brittle unless you add GSIs, duplicate access-pattern tables, or a separate search system. That increases places data can disagree, which hurts trust during customer incidents.

For an order-tracking service, support needs reliable, explainable answers fast. Postgres gives them safer ad hoc investigation, audits, and simpler escalation paths. Don’t optimize away the humans debugging unhappy orders.
Ruby: That pushes me harder toward **Postgres**.

Order ID lookup is easy in both. The support searches are the deciding factor: email + date range + status are natural in Postgres with proper indexes/partitioning. In DynamoDB, you’ll likely end up adding GSIs, duplicating records, or bolting on OpenSearch—more moving parts for a support workflow.

Assuming no active-active multi-region write requirement: use **Postgres first**. Design for 5k writes/sec with lean rows, minimal indexes on the hot write table, partition by time, connection pooling, and async pipelines for noncritical derived/search data.
Lemon: Jade’s right on Postgres, but the missed opportunity is architectural: don’t force one datastore to satisfy both transactional truth and every support/search need.

My recommendation: **Postgres as system of record**, optimized for order writes and core lookups, then stream events/CDC into **OpenSearch, ClickHouse, or Redshift** if support search grows beyond indexed operational queries.

Assumption: support search can tolerate slight lag. That keeps current complexity low while preserving a path to richer search without contorting DynamoDB around secondary access patterns.
Bleu: Lemon’s path is feasible, but don’t add OpenSearch/ClickHouse/Redshift until indexed Postgres queries fail a measured need. Each extra store adds lag, reconciliation, and incident complexity.

My view: **Postgres as system of record now**, assuming no active-active multi-region write requirement. Keep the write table lean: partition by time, index order ID, and add only the minimum composite indexes for support searches such as email/date/status. At 5k writes/sec, every index is write amplification, so support convenience must be deliberate, not unlimited.
USER: The team knows Postgres well and has never run DynamoDB in production. We're already on AWS.
Ruby: That settles it: **use Postgres**.

“Already on AWS” is not a reason to adopt DynamoDB when the team has zero production experience and the query needs fit Postgres. Use **RDS/Aurora Postgres**, not self-managed.

Assumption: no hard active-active multi-region write requirement.

First steps:
1. Model orders leanly.
2. Partition by time.
3. Index `order_id`; add only necessary support indexes for email/date/status.
4. Use connection pooling.
5. Load test to 5k writes/sec plus peak headroom.
6. Add search/analytics store later only if Postgres support queries actually fail.
Lemon: Postgres is the right primary choice, but Ruby’s “settles it” risks under-designing the future path. Don’t add OpenSearch/ClickHouse now—but do make orders emit clean events from day one, ideally via an outbox or CDC pattern.

Assumption: no active-active multi-region writes.

Use RDS/Aurora Postgres for the transactional system. Keep support search in Postgres initially. The creative move is preserving optionality: if support later wants fuzzy search, dashboards, or long-range analytics, you can project from events instead of reworking the core order store.
Jade: Ruby’s conclusion is right, but “partition by time” shouldn’t become automatic complexity before testing proves it’s needed. The people risk is the deciding factor: a team fluent in Postgres and new to DynamoDB will support customers better on Postgres.

Use **managed Postgres on RDS/Aurora**. Start with a simple, measured design: lean schema, minimal indexes, pooling, load tests, and clear runbooks. Add partitioning/search systems when evidence justifies the extra operational burden.
Bleu: Jade is right: don’t make partitioning a reflex. The decision is **managed Postgres on AWS**, with DynamoDB rejected unless a hard multi-region/key-value scaling requirement appears.

What I’d insist on before launch: a load test using real row sizes, retention assumptions, exact indexes, connection pool limits, and expected support-query concurrency. “5k writes/sec” is not enough evidence by itself.

Keep indexes minimal; every support index taxes writes. Start simple, prove headroom, then add partitioning or a search projection only when measurements justify it.
USER: Peak is only during two sales events a year; normal load is about 300 writes per second. Does that change your answer?
Ruby: No, it makes Postgres even more obvious.

300 writes/sec normal is routine. Two planned 5k spikes mean you don’t need DynamoDB’s operational model; you need **event prep**.

Do this:
1. Use managed Postgres/Aurora.
2. Load test to 5k+ before each sale.
3. Pre-scale instance/storage/IOPS ahead of events.
4. Keep write path lean: minimal indexes, pooled connections, no unnecessary transactions.
5. Add buffering/backpressure if upstream can burst above 5k.

Don’t adopt DynamoDB for two weekends a year unless Postgres fails a realistic peak test.
Jade: No, it strengthens the Postgres answer. A twice-yearly spike is a capacity-planning and rehearsal problem, not a reason to move an inexperienced team onto DynamoDB.

I’d avoid designing the whole system around rare peak complexity. Use managed Postgres, prove 5k writes/sec in load tests, and create an event playbook: pre-scale instance/storage/IOPS if needed, verify connection pools, pause risky deploys, monitor queues/errors, and staff support during the sales window.

The human risk is preventable: practice the spike before customers experience it.
Bleu: No. It strengthens **managed Postgres**.

Ruby’s event-prep framing is right, but “pre-scale” is not proof. Before each sale, run a production-like load test with real row sizes, exact indexes, connection pool limits, retention volume, and expected support-query concurrency. Watch WAL rate, IOPS, lock waits, checkpoint/autovacuum behavior, and replication lag if applicable.

300 writes/sec normal is routine. Two planned 5k spikes do not justify DynamoDB unless Postgres fails realistic peak testing or you have an unconfirmed hard multi-region/low-latency write requirement.
Lemon: No—it makes Postgres even more attractive. Bleu’s testing discipline is necessary, but testing alone misses the bigger opportunity: treat sale days as a distinct operating mode.

Use managed Postgres as primary. For events, prioritize order creation over everything else: throttle noncritical writes, defer expensive support/reporting queries if needed, and let secondary projections lag briefly. Add an outbox/order-event stream now—not OpenSearch now—so future search, dashboards, or analytics can be built without disturbing checkout when peak traffic hits.
```

## Rolling summary (folded through message 8)

Objective:
The user is choosing between Postgres and DynamoDB for an order-tracking service expected to reach **5k writes/second at peak**, with both high write throughput and support/debugging query needs.

Confirmed by the user:
- The service is an **order-tracking service**.
- Expected peak load is **5k writes/second**.
- The datastore options under consideration are **Postgres** and **DynamoDB**.
- Queries are **mostly by order ID**.
- Customer support needs to search by **email, date range, and status**.

Assumptions:
- No confirmed requirement yet for **active-active multi-region writes** or low-latency local writes.
- Advisors are assuming 5k writes/sec is achievable in Postgres with disciplined design: lean rows, minimal indexes, connection pooling, partitioning, and tuned write paths.
- Advisors are assuming DynamoDB is viable if access patterns are stable and mostly key-based, but more complex for support search.
- Lemon assumes support/search use cases might tolerate slight lag if eventually served by a derived/search system.
- Bleu cautions that support convenience should not imply unlimited indexes, because every index adds write amplification at 5k writes/sec.

Positions:
- **Jade**: Do not choose on write rate alone; both Postgres and DynamoDB can handle 5k writes/sec. The human/operational cost matters. Initially favored Postgres if the team already runs it well and needs relational queries, audits, tooling, and debugging. After the user stated support needs email/date/status search, Jade argued this pushes harder toward **Postgres first**, because DynamoDB would likely require GSIs, duplicate access-pattern tables, or a separate search system, increasing inconsistency and incident/debugging burden.
- **Ruby**: Defaulted to **Postgres first** unless there is a specific scaling/topology reason not to. 5k writes/sec is manageable with disciplined indexes, pooling, partitioning, and avoiding chatty transactions. Ruby said DynamoDB should be chosen only if access is mostly predictable key-based lookups/updates and the team accepts DynamoDB query limits from day one. After support search requirements were given, Ruby argued more strongly for **Postgres**, since email/date/status searches are natural with proper indexes/partitioning, while DynamoDB would add GSIs, duplicated records, or OpenSearch.
- **Lemon**: Agreed Postgres is favored but emphasized architecture: avoid forcing one datastore to satisfy both transactional truth and all search needs. Recommended **Postgres as system of record**, optimized for writes/core lookups, with a future path to stream events/CDC into **OpenSearch, ClickHouse, or Redshift** if support search grows beyond indexed operational queries.
- **Bleu**: Agreed with Postgres as system of record but warned not to add OpenSearch/ClickHouse/Redshift until measured Postgres indexed queries fail. Extra stores add lag, reconciliation, and incident complexity. Recommended partitioning by time, indexing order ID, and adding only minimal composite indexes for email/date/status support searches.

Open questions:
- **Ruby asked**: Do you require **active-active multi-region writes with low-latency local writes**? This has not been answered.

## Final recommendation

Recommendation: use managed Postgres on AWS, preferably RDS/Aurora Postgres, as the primary order-tracking datastore. Do not choose DynamoDB unless a hard active-active multi-region / low-latency local-write requirement appears, or Postgres fails realistic peak testing.

Why: your team already knows Postgres and has never run DynamoDB in production. Your normal load is about 300 writes/sec, with planned 5k writes/sec peaks only twice a year. That is a capacity-planning and rehearsal problem, not a reason to adopt a new operational model. Your queries are mostly by order ID, plus support searches by email, date range, and status; those fit Postgres naturally with careful indexing. In DynamoDB, those support queries would likely require GSIs, duplicated access patterns, or a separate search system, adding complexity and debugging burden.

Strongest objections: DynamoDB can be excellent for predictable key-value access and very high scale, but your workload is not just simple key lookup, and your team lacks production experience with it. Postgres partitioning or external search may eventually help, but they should not be added reflexively before measurement. Every index or extra datastore adds write amplification or operational complexity.

Next steps:
1. Build on RDS/Aurora Postgres.
2. Keep the order schema lean and the write path simple.
3. Index `order_id`; add only necessary support indexes for email/date/status.
4. Use connection pooling.
5. Run production-like load tests to 5k+ writes/sec with real row sizes, exact indexes, retention volume, and support-query concurrency.
6. Before sales events, pre-scale as needed, rehearse, freeze risky deploys, and monitor IOPS, WAL, locks, autovacuum/checkpoints, errors, and lag.
7. Consider an outbox/CDC event stream for future search or analytics, but add OpenSearch/ClickHouse/Redshift only if Postgres support queries actually fail.
