# tech-build-vs-buy-auth · full

Category: technical. Completed: true.
Agent turns: 15. Calls: 38. Wall-clock: 68.5s.
Judge: relevance 5, specificity 4, rebuttals 4. Shown as response 1.
Judge's main weakness: It gives a solid portability plan, but the lock-in mitigation is somewhat less operationally concrete than the discussion suggested: it mentions a migration tabletop but not a bounded proof, exit-path duration, or detailed contract gates/customer migration controls.
Judge's overall pick: summary.
Judge rationale: Both recommendations are highly relevant and correctly advise buying rather than building while packaging SSO/SCIM into Enterprise pricing. Response 2 is stronger overall because it turns the CTO’s lock-in concern into concrete signing gates, a one-day migration proof, and a 30–60 day exit path, making the risk mitigation more actionable and testable.
Pipeline: passed-after-repair (invalid-reference, unsupported-commitment).

## Transcript

```text
USER: For our B2B SaaS, should we build our own authentication or use a provider like Auth0 or Clerk?
Lemon: Use a provider by default. Don’t spend scarce product energy rebuilding login, SSO, MFA, SCIM, audit trails, password resets, session security, and compliance stories unless auth is your differentiator.

The bolder move isn’t “own auth”; it’s “make enterprise access feel effortless.” Pick Auth0/Clerk/WorkOS/etc. based on your B2B needs, then build value around onboarding, roles, tenant management, and admin UX.

Assumption: you sell to companies, not just individual users. If enterprise SSO/SCIM is near-term, prioritize that over a pretty developer experience. Build only if you have unusual security/control requirements or provider lock-in would be existential.
Jade: Lemon’s right on provider-default, but the blind spot is treating this as mostly a feature checklist. Auth failures become trust failures: locked-out users, confused admins, broken SSO rollouts, and support escalations land on your team and customer champions.

Confirmed: B2B SaaS. Assumption: auth isn’t your differentiator. Use a provider, but evaluate admin experience, support tooling, incident history, export/portability, enterprise onboarding, and pricing at scale. Build only if customer trust or regulatory duties genuinely require control you cannot get externally.
Bleu: Provider-default is still the right answer, but don’t decide by brand reputation or developer ergonomics. Run a hard constraint matrix first: required SSO protocols, SCIM depth, MFA policy control, tenant/org model, audit-log retention, SLA/support terms, data residency/DPA, migration/export path, and projected pricing at customer scale.

My decision rule: buy unless a provider fails a non-negotiable requirement or makes unit economics untenable. Build only if auth control is strategically necessary, not because login “seems simple.”
USER: Enterprise customers are starting to ask for SAML SSO and SCIM provisioning.
Jade: That moves this from “nice-to-have auth” to “enterprise trust infrastructure.” I would not build SAML/SCIM yourself unless you have a dedicated security/platform team ready to own outages, edge cases, and customer admin handholding.

Use a provider with strong B2B onboarding flows, clear SCIM diagnostics, admin-friendly error messages, and support tooling your CS team can actually use. The overlooked users are customer IT admins and your own support team; if setup is opaque, your champion absorbs the pain.

Assumption: these requests are near-term sales blockers. If so, prioritize provider-backed SSO/SCIM now.
Lemon: That shifts this from “login” to “enterprise readiness.” Don’t build SAML/SCIM yourself now; use a provider with strong B2B primitives—Auth0, WorkOS, Clerk if its enterprise features fit, Stytch, etc.

Opportunity: turn this into a paid Enterprise tier, not just a cost center. Bundle SAML SSO, SCIM, audit logs, domain capture, RBAC/admin roles, and onboarding support. Build your own tenant/admin experience around the provider so customers feel you own the workflow, while the protocol complexity stays outsourced.
Ruby: That moves this from “maybe later” to “buy now.” Don’t build SAML + SCIM unless you want a roadmap sink and enterprise rollout pain.

Fast path:
1. Pick provider with strong B2B enterprise support: WorkOS, Auth0, Stytch, Clerk if it fits your org model.
2. Ship SAML SSO first for one design-partner customer.
3. Add SCIM next with a narrow supported set: create, deactivate, update role/group mapping.
4. Put it behind enterprise pricing.

Success metric: unblock signed enterprise deals, not “perfect auth architecture.”
Bleu: Ruby’s fast path is right, but “SCIM next” is only safe if SAML alone unblocks the deal. Some enterprises require provisioning/deprovisioning before production access.

Do not build SAML/SCIM. Buy, then test against the actual IdPs customers use: Okta, Entra ID, Google Workspace, OneLogin. “Supports SCIM” is insufficient—verify PATCH behavior, deactivation semantics, group/role mapping, JIT provisioning, audit logs, metadata/cert rotation, tenant isolation, and support SLA.

Assumption: enterprise requests are tied to revenue. If so, choose the provider that clears these checks fastest.
USER: Auth0's quote for our expected 50k monthly active users is about $2,400/month. Our total infrastructure bill is $6k/month.
Lemon: $2,400/month feels huge beside infra, but wrong benchmark. Compare it to enterprise revenue unblocked and engineering time not spent babysitting SAML/SCIM. One enterprise deal can justify this.

But don’t let Auth0 anchor the market. Use the quote as leverage and evaluate WorkOS/Stytch/Clerk/Ory/Descope on B2B pricing shape: per MAU can punish growth; per org/connection may fit enterprise better.

My move: buy, but negotiate and make SSO/SCIM a paid Enterprise package. Don’t absorb this cost silently.
Ruby: Lemon’s right, but “one deal can justify it” is too loose. Do the margin math.

$2.4k/month is not build-vs-buy proof. It is a pricing/procurement input. Set a rule: if SSO/SCIM unlocks at least one enterprise contract with margin comfortably above provider cost, buy now. If not, your Enterprise packaging is underpriced.

Action: get 3 competing quotes this week, reject pure MAU pricing if it scales badly, and charge SSO/SCIM as Enterprise. Don’t burn engineers recreating brittle protocol plumbing to save a line item.
Jade: Ruby’s margin rule is necessary, but too narrow: the cost isn’t only $2.4k/month versus revenue. It’s also who absorbs failed SSO setup, deprovisioning mistakes, lockouts, and escalations when a customer’s IT team is under pressure.

I’d still buy, negotiate, and compare providers—but include CS/admin support usability in the decision, not just pricing. A cheaper provider with opaque diagnostics can quietly cost more in trust and team burnout.

Assumption: enterprise customers will fund this via packaging, not expect it in the base plan.
Bleu: Ruby’s margin rule is necessary, but incomplete: the quote may exclude costs that matter more than MAU. Auth0-style pricing can hinge on SSO connections, SCIM, orgs/tenants, machine tokens, log retention, support SLA, and overages.

My position: still buy, not build—but compare vendors on your actual enterprise shape. Model 50k/100k/250k MAU plus required SAML, SCIM, audit logs, support, and tenant count. If the fully loaded cost breaks margins, negotiate or switch pricing models before reconsidering build.
USER: Our CTO worries about vendor lock-in above everything else. How do we address that concretely?
Ruby: Treat lock-in as a risk to manage, not a reason to build auth.

Concrete plan:
1. Keep your own canonical user/org/role tables.
2. Use provider for auth flows, SAML, SCIM, sessions—not core customer identity logic.
3. Wrap provider calls behind an internal auth interface.
4. Store external provider IDs as mappings, not primary IDs.
5. Require contract terms for data export, SLA, breach notice, and price caps.
6. Avoid proprietary features unless they unblock revenue.
7. Run a migration drill before launch.

Decision rule: buy now, architect exit paths now, don’t build prematurely.
Lemon: Ruby’s exit-plan is right, but the trap is building a giant abstraction that becomes its own lock-in. Keep it thin.

Concrete anti-lock-in plan:
- Own canonical users/orgs/roles/entitlements.
- Store provider IDs only as mappings.
- Use OIDC/SAML/SCIM standards, not proprietary workflows.
- Wrap only critical provider calls behind a small adapter.
- Require export rights, price protections, SLA, breach terms.
- Document a migration runbook before signing.
- Test annually by exporting data and mapping it to another provider.

Goal: provider as replaceable plumbing, not your identity brain.
Jade: Ruby’s plan handles technical exit paths; the missing piece is customer continuity. Lock-in risk is not just “can we migrate data?”—it’s whether customers lose trust during a forced switch.

Add:
- Maintain an admin-facing identity map customers can understand.
- Keep customer SSO/SCIM configuration metadata documented outside the vendor.
- Create support runbooks for provider outage, cert rotation failure, and migration.
- Contract for transition assistance and advance notice on pricing/API changes.
- Test migration with one internal tenant annually.

Buy, but prove you can leave without breaking customer access.
Bleu: Ruby’s plan is right, but “wrap it” can create false comfort. Some assets are not cleanly portable: password hashes, active sessions, SAML connection configs, SCIM state, audit logs, MFA enrollments, and IdP metadata/cert rotation history.

Concrete addition: create a portability checklist before signing. For each object, mark: exportable via API, export format, downtime needed, customer action required, and replacement path. Then run a tabletop migration to WorkOS/Stytch/Clerk/Auth0 alternative.

Target is not zero lock-in. It is quantified lock-in with known switching cost.
```

## Final recommendation

Recommendation: buy authentication/enterprise identity now; do not build SAML SSO and SCIM yourself.

Your facts point strongly that way: you are a B2B SaaS, enterprise customers are already asking for SAML and SCIM, and those features are now part of enterprise readiness, not just “login.” Building them would likely consume engineering and support time on brittle protocol edge cases, IdP quirks, deprovisioning, cert rotation, admin troubleshooting, and trust-damaging access failures.

Auth0’s $2,400/month quote feels large against a $6k/month infra bill, but infra is the wrong benchmark. Compare it to enterprise revenue unblocked, margins, and the cost of engineers and CS handling auth complexity. That said, do not let Auth0 anchor the decision. Compare providers such as Auth0, WorkOS, Stytch, Clerk, Descope, or Ory on your actual B2B shape: SAML, SCIM, tenant/org model, support SLA, audit logs, log retention, data terms, pricing at 50k/100k/250k MAU, and number of enterprise connections.

The strongest objections are cost and lock-in. They are real, but they do not justify building now. Manage them directly: negotiate, package SSO/SCIM into an Enterprise tier, and architect for portability.

Next steps:
1. Get 3 competing quotes this week.
2. Test against actual customer IdPs: Okta, Entra ID, Google Workspace, OneLogin.
3. Ship SAML first unless SCIM is required for production.
4. Add SCIM with narrow scope: create, update, deactivate, role/group mapping.
5. Keep your own canonical users/orgs/roles/entitlements.
6. Store provider IDs as mappings, not primary IDs.
7. Use standards, keep wrappers thin, require export/price/SLA terms, and run a migration tabletop before signing.
