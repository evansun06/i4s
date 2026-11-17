# tech-postgres-vs-dynamo · full

Category: technical. Completed: true.
Agent turns: 13. Calls: 36. Wall-clock: 66.5s.
Judge: relevance 5, specificity 5, rebuttals 4. Shown as response 2.
Judge's main weakness: It is very strong overall, but it omits a few caveats raised in the discussion, such as active-active multi-region writes as a possible reason to reconsider DynamoDB and detailed database-level monitoring signals like WAL, IOPS, locks, autovacuum, and replication lag.
Judge's overall pick: summary.
Judge rationale: Both recommendations answer the user's evolving question well and strongly justify managed Postgres/Aurora over DynamoDB for this workload and team. Response 1 is slightly better because it more completely preserves the key exceptions and objections from its discussion—especially active-active multi-region requirements, premature partitioning/search systems, and realistic peak testing with concrete operational metrics. Response 2 adds useful sale-mode guidance, but its rebuttal coverage is a bit less complete.
Pipeline: passed-first-try.

## Transcript

```text
USER: We're building an order-tracking service expected to hit 5k writes per second at peak. Should we use Postgres or DynamoDB?
Jade: Don’t choose on throughput alone. 5k writes/sec is manageable for either, but the safer people choice depends on team fluency and failure modes.

My bias: use Postgres if the team needs rich querying, transactions, easier debugging, and customer-support visibility into “where is my order?” Use DynamoDB if access patterns are simple, scale predictability matters most, and the team is ready to own NoSQL modeling, retries, hot partitions, and eventual-consistency surprises.

Assumption: order status correctness and supportability matter more than theoretical peak headroom. Under that, I’d start with Postgres unless operational expertise strongly favors DynamoDB.
Ruby: Jade is right on supportability, but “team fluency” can’t be the tie-breaker if the data model needs the other tool.

My call: **Postgres by default**. 5k writes/sec is not the deciding constraint; schema/index discipline is. Use Postgres if orders need transactions, flexible lookup, audits, support queries, or reporting. Keep indexes lean, avoid hot aggregate rows, partition when volume requires it, and add read replicas for read load.

Choose **DynamoDB** only if access patterns are fixed, mostly key-based, and you’ll design deliberately around partitions, retries, and consistency.
Bleu (asked the user; not answered yet): Ruby/Jade are directionally right, but “5k writes/sec is manageable” is only true after defining write size, index count, contention, region/HA, and key distribution. My default remains Postgres if order tracking needs transactional status changes, idempotency, support/debug queries, and audits; validate with production-shaped load tests and minimal indexes. DynamoDB wins when every access pattern is known, key-based, and hot-partition risk can be designed out.

QUESTION: Do you need relational/ad hoc queries or multi-row transactions in the primary store?
USER: Queries are mostly by order ID, but customer support needs to search by email, date range, and status.
Ruby: That pushes this firmly toward **Postgres**.

Order-ID lookup alone would fit DynamoDB. But support search by **email + date range + status** means you either need multiple DynamoDB GSIs designed upfront or a second search/indexing system. That’s extra moving parts for a basic operational need.

Use Postgres as primary store. Keep write path lean: minimal indexes, likely indexes on `order_id`, `email`, `status`, `created_at`/`updated_at`, and test 5k writes/sec with real row size. Add partitioning later if volume demands it. Don’t buy Dynamo complexity until access patterns force it.
Jade: Ruby’s direction is right, but I’d be careful with “just add indexes.” Too many or poorly matched indexes can make 5k writes/sec harder and still leave support with slow tools.

My recommendation: **Postgres primary**, but design explicitly for support workflows: reliable email/date/status search, audit trail for status changes, and clear internal tooling. Assumption: support needs timely, trusted answers without waiting on engineers. DynamoDB plus GSIs/search can work, but it adds consistency and ownership friction for a core customer-facing need.
Lemon: Ruby’s conclusion is right, but I’d avoid assuming all support fields deserve primary-store indexes immediately. That’s how “5k writes/sec” quietly becomes harder.

My take: **Postgres as source of truth**, with the support workflow treated as an evolving read experience. Start with the minimum indexes needed for real support queries; if searches get richer or heavier, project into a read model: materialized view, replica, or OpenSearch. Don’t contort DynamoDB around support search, but also don’t overload the write path for every future support idea.
Bleu: Postgres is the better primary-store default here, but Ruby/Jade understate one risk: support search indexes are not “free” at 5k writes/sec. Don’t add broad indexes casually.

Confirmed: order-ID lookup plus support search by email/date/status. Assumption: support needs reasonably current operational visibility, not analytics-scale reporting.

Use Postgres with a deliberately small index set matching actual support predicates—likely composite indexes, not separate indexes everywhere. Include idempotency/audit tables. Validate with production-shaped writes, row sizes, and retention before committing. DynamoDB would need more pre-modeled access paths or a second search system sooner.
USER: The team knows Postgres well and has never run DynamoDB in production. We're already on AWS.
Ruby: That settles it: **use Postgres**.

AWS doesn’t make DynamoDB the right default; team competence matters when this is a core order system. Picking DynamoDB now means learning NoSQL modeling, partition behavior, GSIs, retry semantics, and operational failure modes while building a high-write production service. Bad trade.

Use **RDS Postgres or Aurora Postgres**, keep the write path/indexes disciplined, load-test 5k writes/sec with real data, and add read replicas/read models if support queries grow. Move fast with the tool your team can run safely.
Lemon: That settles the “boring is powerful” path: **use Postgres/Aurora Postgres as the primary store**. Being on AWS is not a good reason to adopt DynamoDB if the team has no production muscle with it.

The opportunity I’d keep open: don’t make this a forever-monolith decision. Use Postgres for correctness and support visibility now, and design an event/outbox stream so you can add DynamoDB, OpenSearch, or a denormalized read model later if specific access patterns outgrow Postgres. Bold move isn’t DynamoDB; it’s keeping optionality without adding premature complexity.
USER: Peak is only during two sales events a year; normal load is about 300 writes per second. Does that change your answer?
Bleu: It strengthens the Postgres recommendation. A system that normally does 300 writes/sec but peaks twice a year should not adopt DynamoDB just for peak capacity, especially with no team experience.

The risk shifts from “can Postgres handle steady 5k?” to “will you be ready for event spikes?” Use RDS/Aurora Postgres sized for peak windows or scaled ahead of events, keep indexes lean, load-test the sale pattern, and consider buffering non-critical writes if bursts exceed DB capacity.

Confirmed peak rarity makes operational familiarity more valuable, not less.
Ruby: No, it strengthens the Postgres answer.

Normal load at 300 writes/sec is easy territory. For two annual peaks, don’t redesign your datastore around rare events—**capacity-plan and rehearse them**.

Use Postgres/Aurora Postgres, then before each sale event:
- run a production-shaped load test at >5k writes/sec
- temporarily scale up DB capacity if needed
- keep indexes tight
- use connection pooling
- make writes idempotent
- have backpressure/queues where acceptable

DynamoDB would be over-optimizing for rare peak throughput while adding year-round operational risk your team doesn’t know.
Lemon: It strengthens Postgres. The missed opportunity is **graceful degradation by workload**, not just bigger capacity.

For sale events, define “sale mode”: critical order-status writes stay synchronous in Postgres; noncritical projections, support-search refreshes, emails, analytics, and exports go through queues/outbox and can lag. That protects the write path without adopting DynamoDB year-round.

So: **Postgres/Aurora primary**, rehearsed peak playbook, and explicit rules for what may be delayed during spikes. DynamoDB is a permanent complexity tax for a twice-a-year problem.
Jade: Lemon’s “sale mode” is the right frame, but it needs a people-facing runbook, not just technical queues.

Still **Postgres/Aurora Postgres**. Twice-a-year peaks are a readiness problem, not a reason to adopt DynamoDB with no production experience. During sales events, define what can lag, who gets alerted, what support sees, and what customers are told if status/search/email updates are delayed. Hidden lag destroys trust faster than a controlled delay.

So: rehearse peak load, scale ahead, protect core order writes, and make degradation visible and explainable.
```

## Final recommendation

Use **Postgres/Aurora Postgres as the primary store**.

Your facts point strongly that way: your team already knows Postgres, has no DynamoDB production experience, normal load is ~300 writes/sec, and the 5k writes/sec peak happens only twice a year. Also, support needs searches by email, date range, and status—not just order ID lookups. That makes Postgres a better fit for correctness, debugging, operational visibility, and flexible support workflows.

DynamoDB’s strongest case is predictable scale for simple, key-based access patterns. But here it would require upfront NoSQL modeling, GSIs or a second search system, retry/consistency handling, and hot-partition awareness—new operational risk for your team. Being on AWS alone is not a reason to choose DynamoDB.

The main Postgres objection is that 5k writes/sec is not automatic if rows are large, indexes are excessive, or writes contend on hot rows. That does not change the recommendation; it means you should design and test the write path carefully.

Concrete next steps:

- Use **RDS Postgres or Aurora Postgres**.
- Keep the write path lean; add only indexes needed for real support queries.
- Prefer well-designed composite indexes over indexing every field separately.
- Include idempotency and audit/status-history records.
- Load-test with production-shaped data at **above 5k writes/sec**.
- Before sales events, scale capacity ahead of time and rehearse the runbook.
- Use connection pooling.
- Define “sale mode”: core order writes stay synchronous; emails, analytics, exports, projections, and support-search refreshes may lag via queues/outbox.
- Make any degraded behavior visible to support and customers.
