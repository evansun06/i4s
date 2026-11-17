# tech-build-vs-buy-auth · summary

Category: technical. Completed: true.
Agent turns: 17. Calls: 42. Wall-clock: 98.6s.
Judge: relevance 5, specificity 5, rebuttals 5. Shown as response 2.
Judge's main weakness: It is slightly more prescriptive about the evaluation set and drill than may be warranted, and it does not mention testing against specific customer IdPs like Okta, Entra ID, Google Workspace, or OneLogin.
Judge's overall pick: summary.
Judge rationale: Both recommendations are highly relevant and correctly advise buying rather than building while packaging SSO/SCIM into Enterprise pricing. Response 2 is stronger overall because it turns the CTO’s lock-in concern into concrete signing gates, a one-day migration proof, and a 30–60 day exit path, making the risk mitigation more actionable and testable.
Pipeline: passed-after-repair (invalid-reference).
Room notices: Condensing earlier rounds

## Transcript

```text
USER: For our B2B SaaS, should we build our own authentication or use a provider like Auth0 or Clerk?
Bleu: Use a provider unless authentication is your product differentiator or you have unusually strict data/control requirements. For B2B SaaS, “auth” quickly becomes SAML/OIDC SSO, SCIM, MFA, RBAC, audit logs, tenant isolation, session security, compliance evidence, and incident response. Building that safely is expensive and failure-prone.

Confirmed: you need B2B SaaS auth. Assumption: speed, reliability, and enterprise readiness matter more than avoiding vendor lock-in.

Recommendation: buy now, design an abstraction around it, and revisit only at scale or with hard regulatory constraints.
Jade: Bleu is right on feasibility, but I’d emphasize the trust/adoption side: enterprise customers and their IT teams expect familiar, well-documented auth flows, SSO setup, MFA, recovery, and auditability. A weak or homegrown auth experience creates friction for buyers, support teams, and admins—even if it technically works.

Use a provider by default, but protect continuity: define who owns identity data, document an exit path, and avoid scattering provider-specific logic through the product. Build only if auth is core to your differentiation or a hard constraint demands it.
Lemon: Bleu is right on “buy,” but too generic on provider choice. Auth can be a GTM feature, not just risk reduction.

If you sell self-serve/dev-first, Clerk can speed onboarding and UX polish. If you sell mid-market/enterprise, Auth0/Okta-style maturity around SAML, SCIM, policies, procurement comfort, and compliance evidence matters more. Don’t build login/session/MFA/SSO plumbing; build your product-specific authorization: tenants, roles, permissions, entitlement logic, and audit semantics. Keep that portable so the provider doesn’t define your product model.
Ruby: Lemon’s “auth as GTM” is useful, but don’t let that turn into a selection rabbit hole. Decide against building.

My take: use a provider, ship fast, keep abstraction thin. Don’t build a fake auth layer “for portability”; isolate provider calls and own your tenant/org, roles, permissions, entitlements, and audit model.

Default picks: Clerk for self-serve speed, Auth0/Okta for enterprise breadth, WorkOS for B2B SSO/SCIM focus.

This week: define required flows, integrate one provider, launch MFA/invites/orgs, and roadmap SSO.
USER: Enterprise customers are starting to ask for SAML SSO and SCIM provisioning.
Bleu: That changes this from “generic auth” to “enterprise identity lifecycle.” Do not build SAML/SCIM yourself unless you can staff ongoing protocol, IdP, security, and support work.

Minimum requirement now: provider with proven SAML SSO, SCIM 2.0, JIT provisioning, domain/org mapping, role/group mapping, audit logs, and IdP-specific setup docs. SCIM is where many integrations fail: deprovisioning, group sync, duplicate users, and tenant boundaries need explicit tests.

Assumption: these are revenue-linked enterprise asks. If so, prioritize Auth0/Okta or WorkOS-style B2B identity over a self-serve-first provider.
Jade: Bleu’s requirements are right, but too integration-centric. The risk isn’t just protocol failure; it’s customers losing trust when onboarding/offboarding is messy.

Treat SAML/SCIM as an enterprise adoption workflow: pilot with 1–2 requesting customers, write clear admin setup/recovery docs, and assign internal ownership for provisioning failures, deprovisioning delays, duplicate users, and role/group mapping disputes. Your support and customer success teams need runbooks before this is broadly sold.

Assumption: these requests are tied to real enterprise deals. If so, buy this capability now; don’t build it.
Lemon: That changes this from “nice auth” to “enterprise identity workflow.” Don’t build SAML/SCIM yourself.

Use this as a packaging opportunity: make SSO/SCIM part of an Enterprise plan, with admin-facing setup docs, domain verification, IdP metadata handling, just-in-time provisioning rules, deprovisioning behavior, and audit events.

I’d now bias toward WorkOS or Auth0/Okta over a purely self-serve UX provider, unless Clerk already covers your exact SAML/SCIM needs. The product value is not the protocol—it’s making IT admins confident they can onboard/offboard users safely.
Ruby: Bleu’s checklist is right, but the risk is turning this into a platform evaluation project. Move now.

Do not build SAML/SCIM. Pick WorkOS for fastest focused B2B SSO/SCIM delivery; pick Auth0/Okta if you need a broader identity suite. Then implement only the revenue-blocking flows first: tenant SAML, SCIM create/update/deactivate, domain/org mapping, and audit events.

Keep roles/permissions/entitlements inside your app. Treat SSO/SCIM as enterprise-plan capability and pilot with the customer asking loudest.
USER: Auth0's quote for our expected 50k monthly active users is about $2,400/month. Our total infrastructure bill is $6k/month.
Jade: That quote feels high relative to your infra, but don’t compare it only to servers—compare it to trust, enterprise revenue, support load, and the cost of a botched deprovisioning/security incident.

I would not build just to avoid $2.4k/month. I would pressure-test pricing, negotiate, and compare WorkOS/Auth0/Okta on SAML/SCIM fit and support quality. Also package SSO/SCIM into Enterprise pricing so the customers creating this complexity help fund it.

Protect your team: avoid turning auth into an under-owned internal burden.
Bleu: Jade is right on benchmark, but the key feasibility issue is pricing shape. $2,400/month is $28.8k/year—well below one fully loaded engineer, so it doesn’t justify building SAML/SCIM. But 50k MAU pricing can be a bad fit if only a small subset needs enterprise identity.

Validate: number of SSO orgs, SCIM-managed users, connections, MFA needs, and overage terms. Compare WorkOS especially, because per-connection/org pricing may map better. Buy, but don’t let MAU-based pricing silently tax your whole user base.
Ruby: Bleu’s pricing-shape point is right, but don’t turn this into another evaluation loop.

Set a one-week decision window. Compare only Auth0, WorkOS, Clerk B2B, and Stytch on: SAML, SCIM create/update/deactivate, tenant/domain mapping, audit events, overage terms, and time-to-ship. Ignore nice-to-haves.

$2.4k/month is not a build trigger. Buy if SSO/SCIM unblocks enterprise revenue and package it into Enterprise pricing. If no customer/deal pays for it, don’t build—defer it.
USER: Our CTO worries about vendor lock-in above everything else. How do we address that concretely?
Ruby: Address lock-in with **exit controls**, not by building auth.

Do this:

1. Own your **user/org IDs, roles, permissions, entitlements, audit schema** in your DB.
2. Keep provider-specific code behind a small auth adapter: login callback, token validation, SCIM webhook/API handlers.
3. Export/test quarterly: users, orgs, identities, SAML connections, SCIM mappings.
4. Use standard protocols only: OIDC, SAML, SCIM 2.0.
5. Put contract terms in place: data export, termination assistance, price caps, SLA.

Do **not** build a giant portability layer. That’s fake safety and real delay.
Jade: Ruby’s controls are right, but too engineering-only. Lock-in also means customers lose trust if SSO breaks during a provider change.

Add two concrete safeguards:
- Write a customer-impact migration runbook: notice period, admin reconfiguration steps, rollback plan, support owner, and expected downtime target.
- Keep enterprise identity configuration understandable in your product: org domains, IdP metadata, role/group mappings, SCIM status, and audit history should not live only inside the vendor console.

The CTO should accept “controlled exit with customer continuity,” not “zero dependency.”
Lemon: Ruby’s exit controls are necessary, but too defensive. Add a **lock-in drill**: before signing, require your team to prove a sandbox migration path to a second provider.

Concretely: use a custom auth domain, avoid provider-specific frontend SDK sprawl, model identities as `provider_id + external_subject` links, and document how one enterprise tenant would move SAML/SCIM connections elsewhere.

Your CTO gets evidence, not reassurance. The bar: “Could we migrate one customer without rewriting authorization or changing product permissions?” If yes, buy.
Ruby: Good, but cap the drill hard. A “sandbox migration path” can become a stealth second implementation.

Make it a one-day proof: export one tenant’s users/org mappings, recreate one SAML connection in a second provider sandbox, validate subject mapping, and confirm product roles still come from our DB. No polished tooling. No dual-provider architecture.

If that passes, lock-in is controlled enough to buy. If it fails, fix the data model before signing—not build auth.
Bleu: Ruby, the one-day drill is right for preventing overengineering, but it is not sufficient evidence of low lock-in. It proves technical remapping, not exit feasibility.

Add a lightweight signing checklist: export rights, termination assistance, price-increase caps, audit/log retention, SAML/SCIM config inventory, and rollback runbook. The CTO should accept provider dependency only if both are true: one-day tenant migration proof passes, and the contract preserves a 30–60 day exit path without losing identity/audit history.
Ruby: Agreed, but make the checklist a signing gate, not a research project.

New point: define a kill criterion now. If a vendor won’t give export rights, termination help, and sane price-increase limits, they’re out—regardless of feature polish. That keeps CTO lock-in concern from becoming endless debate.

Decision package should be: one-day migration proof + contract exit terms + owned internal auth model. If all three pass, buy. If one fails, fix that specific failure—not default to building auth.
```

## Rolling summary (folded through message 10)

Objective: what the user is trying to achieve.
- Decide whether a B2B SaaS should build authentication in-house or use an auth provider.
- Address new enterprise customer requests for SAML SSO and SCIM provisioning.
- Choose an approach/provider that supports enterprise readiness without overbuilding.

Confirmed by the user: constraints, facts, preferences, and decisions the user stated or agreed to.
- The product is a B2B SaaS.
- The user is considering build-vs-buy for authentication.
- Enterprise customers are starting to ask for SAML SSO and SCIM provisioning.
- No provider decision has been confirmed.
- No decision to build or buy has been explicitly confirmed by the user.

Assumptions: things raised but not confirmed by the user.
- Speed, reliability, and enterprise readiness matter more than avoiding vendor lock-in. Raised by Bleu.
- SAML SSO and SCIM requests are tied to real enterprise deals or revenue blockers. Raised by Bleu, Jade, and Ruby.
- Enterprise plan packaging is relevant. Raised by Lemon and Ruby.
- The company may need SAML/OIDC SSO, SCIM, MFA, RBAC, audit logs, tenant isolation, session security, compliance evidence, and incident response. Raised by Bleu.
- The company should own its tenant/org, roles, permissions, entitlements, audit model, and product-specific authorization rather than letting an auth provider define those. Raised by Lemon and Ruby.
- Provider options under consideration include Auth0/Okta, Clerk, and WorkOS. Raised by advisors, not confirmed by user.

Positions: what each advisor has argued, including disagreements and changes of mind.
- Bleu: Strongly recommends using a provider unless auth is a differentiator or there are unusually strict data/control requirements. With SAML/SCIM requests, Bleu says this is now “enterprise identity lifecycle,” not generic auth. Do not build SAML/SCIM unless able to staff ongoing protocol, IdP, security, and support work. Minimum provider capabilities: proven SAML SSO, SCIM 2.0, JIT provisioning, domain/org mapping, role/group mapping, audit logs, IdP-specific setup docs, and explicit testing for deprovisioning, group sync, duplicate users, and tenant boundaries. Biases toward Auth0/Okta or WorkOS-style B2B identity if revenue-linked.
- Jade: Agrees with buying, but emphasizes trust, adoption, support, and admin experience. Enterprise IT expects familiar, documented auth flows, SSO setup, MFA, recovery, and auditability. For SAML/SCIM, treat this as an enterprise adoption workflow, not just an integration. Pilot with 1–2 requesting customers, write setup/recovery docs, and assign ownership for provisioning failures, deprovisioning delays, duplicate users, and mapping disputes.
- Lemon: Initially framed auth as a GTM feature. Clerk may fit self-serve/dev-first onboarding; Auth0/Okta may fit mid-market/enterprise maturity. After SAML/SCIM appeared, Lemon shifted toward WorkOS or Auth0/Okta over purely self-serve UX providers unless Clerk covers exact needs. Recommends packaging SSO/SCIM in Enterprise, with domain verification, IdP metadata handling, JIT provisioning rules, deprovisioning behavior, and audit events.
- Ruby: Most action-oriented: decide against building and avoid a long selection rabbit hole. Use a provider, ship fast, keep abstraction thin, and do not create a fake portability layer. Default picks: Clerk for self-serve speed, Auth0/Okta for enterprise breadth, WorkOS for focused B2B SSO/SCIM. After SAML/SCIM ask, Ruby recommends moving now: WorkOS for fastest focused B2B delivery, Auth0/Okta for broader identity suite. Implement revenue-blocking flows first: tenant SAML, SCIM create/update/deactivate, domain/org mapping, and audit events.

Open questions: questions marked not answered yet, and who asked them.
- Are SAML SSO and SCIM requests tied to real enterprise deals/revenue? Raised by Bleu, Jade, and Ruby.
- Is the product primarily self-serve/dev-first, mid-market, or enterprise-focused? Raised by Lemon.
- Are there strict regulatory, data residency, or control requirements that would justify building auth? Raised by Bleu and Jade.
- Which provider best matches exact SAML/SCIM needs: WorkOS, Auth0/Okta, Clerk, or another option? Raised by Lemon and Ruby.

## Final recommendation

Recommendation: **buy authentication/enterprise identity; do not build SAML SSO and SCIM in-house.** But address the CTO’s lock-in concern with concrete exit controls before signing.

Why: you are a B2B SaaS now getting SAML SSO and SCIM requests. That moves this from “basic login” to enterprise identity lifecycle: SSO setup, provisioning, deprovisioning, tenant mapping, auditability, and support. Auth0’s quoted **$2,400/month** is meaningful relative to your **$6k/month infra bill**, but it is still far below the cost and risk of owning SAML/SCIM long term. The better comparison is against enterprise revenue, support burden, and security/customer-trust risk—not just server spend.

The strongest objection is vendor lock-in. It is valid, but it does not justify building auth by default. The right mitigation is **controlled exit**, not zero dependency. Another objection is pricing shape: MAU-based pricing may be a bad fit if only a few enterprise orgs need SSO/SCIM. That argues for comparing providers and negotiating—not building.

Next steps:

1. Run a **one-week provider decision** across Auth0/Okta, WorkOS, Clerk B2B, and Stytch.
2. Compare only: SAML, SCIM create/update/deactivate, tenant/domain mapping, audit events, overage terms, support, and time-to-ship.
3. Require a **one-day lock-in drill**: export one tenant, recreate one SAML connection in another provider sandbox, validate subject mapping, and confirm roles/permissions remain in your DB.
4. Own internally: user/org IDs, roles, permissions, entitlements, audit schema, and product authorization.
5. Make contract gates mandatory: export rights, termination assistance, price-increase limits, SLA, audit/log retention, and a 30–60 day exit path.
6. Package SSO/SCIM into Enterprise pricing.
