---
name: production-debugging
description: "Use when a running service misbehaves: incidents, degraded services, hangs, timeouts, failed deploys, suspicious errors in logs, falling availability."
---

# Production Debugging

## Core Principle

Production debugging is evidence-driven incident investigation.

Do not confuse:

- suspicious logs with service failure;
- correlation with root cause;
- mitigation with permanent repair;
- historical similarity with current evidence;
- implementation with verified recovery.

Use a systematic-debugging workflow if one is installed: reproduce, isolate, form hypotheses, test them one at a time.

Before declaring an incident fixed or resolved, run a verification pass: re-check the original symptom with fresh evidence.

When project-local durable memory exists, use `project-memory` for targeted
historical retrieval.

## Contract

- **Needs**: a precisely stated symptom, the affected time window, and the real runtime identified from project metadata rather than guessed
- **Produces**: observed facts separated from hypotheses, and a status in the fixed vocabulary — observed / hypothesis / mitigated / root cause confirmed / fix implemented / production verified / unresolved
- **After**: —
- **Before**: project-memory
- **Done when**: the original user-visible symptom was re-checked after the change, and mitigation is not reported as a fix

## Establish the Actual Runtime

Before issuing infrastructure-specific commands, identify the real runtime from:

- project-local `AGENTS.md`;
- `.agent/project.yaml`;
- `.agent/context.md`;
- `.agent/runbooks/production.md`;
- `.agent/runbooks/deploy.md`;
- actual repository configuration.

Never guess systemd, Docker, Kubernetes, cloud provider, service names,
deployment mechanism, hosts, ports, or process layout.

Unknown infrastructure remains `NEEDS_VERIFICATION`.

## Investigation Order

Start with current evidence.

1. Define the symptom precisely.
2. Establish the affected time window.
3. Determine actual process/service health using the project's runtime.
4. Inspect bounded logs around the incident.
5. Check resources, network, dependencies, queues, schedulers, storage, or
   external APIs only when evidence points there.
6. Form competing hypotheses.
7. Seek evidence that discriminates between them.
8. Retrieve historical incidents only after current symptoms establish relevance.

Do not load all historical memory at incident start.

Historical incidents are hypotheses and comparison material, not proof that the
same root cause has returned.

## Health Versus Logs

Process/runtime health is not equivalent to log cleanliness.

A traceback, exception, timeout, retry, RuntimeError, HTTP error, network
warning, or API failure can be handled while the service remains healthy.

Likewise, a process may be alive while functionally unhealthy.

Determine separately:

- process state;
- readiness/liveness if available;
- actual user-facing behavior;
- dependency health;
- error handling/recovery behavior.

Do not declare an outage solely from generic error-pattern matching.

Do not declare health solely because a process exists.

## Facts, Hypotheses, Proof

Keep three categories explicit:

**Observed facts**
Fresh evidence from commands, metrics, logs, runtime state, or reproduction.

**Hypotheses**
Possible causal explanations consistent with the facts.

**Confirmed root cause**
A causal explanation supported by discriminating evidence.

Root-cause confirmation does not require an arbitrary number of repeated
incidents.

A single controlled reproduction, counterfactual test, dependency isolation,
configuration reversal, or other decisive causal observation may be sufficient.

Repeated correlation without causal discrimination is not sufficient.

### One pass, one verdict

A request like "find out why it is slow" is a request for the whole analysis, not for a status after each step. Explore broadly first, including sources the request did not name. Keep every competing hypothesis with a confidence (high, medium, low) and the check that would kill it, in a notes file under `.agent/` or the scratchpad, not in chat. Run the cheapest discriminating check for each hypothesis, then report once: verdict, the hypothesis that survived with its evidence, the ones ruled out and why, what remains unknown. Stop early only when a decision is the user's to make.

## Containment Versus Fix

Label actions accurately.

**Containment / mitigation**
Reduces impact or restores service without proving or removing the root cause.

Examples include restart, failover, disabling a feature, reducing load,
switching dependency endpoints, or rollback.

**Root-cause fix**
Removes the demonstrated causal mechanism.

Do not call mitigation a permanent fix.

A reversible containment action may occur before complete RCA when:

- impact justifies it;
- risk is understood;
- rollback is known;
- project/user authorization permits it.

Continue RCA afterward unless the user explicitly stops investigation.

## Production Changes

Observation should normally precede mutation.

Do not:

- restart;
- deploy;
- edit production configuration;
- kill processes;
- clear data;
- modify infrastructure;
- rotate credentials;
- perform destructive actions

unless current user instructions and project-local policy authorize them.

When a production change is justified:

1. state the hypothesis or operational reason;
2. identify expected effect;
3. identify rollback;
4. make the smallest appropriate change;
5. verify actual production behavior afterward.

Cross-component fixes are allowed when evidence requires them. Scope alone is
not a reason to reject a fix.

## Verification

Before claiming recovery or resolution, verify the relevant observable outcome.

Examples:

- service/process state;
- health endpoint;
- original user-visible symptom;
- scheduler execution;
- queue progression;
- dependency connectivity;
- post-change error rate;
- bounded fresh logs.

Use project runbooks for concrete commands.

"Deployed successfully" does not imply "production problem fixed."

"Service active" does not imply "user-facing behavior healthy."

## Durable Memory

After a meaningful incident, record durable memory only when it improves future
investigation.

Useful incident memory includes:

- symptom;
- affected component;
- confirmed evidence;
- root cause or explicitly unresolved status;
- mitigation;
- permanent fix if any;
- verification;
- recurrence indicators.

Do not store raw log dumps, secrets, speculative hypotheses, or routine
successful executions.

A confirmed root cause with its fix gets `node ${CLAUDE_PLUGIN_ROOT}/scripts/agent-context.mjs incident "Title"`: the file lands in `.agent/incidents/` and the next session sees its name in the startup injection. Update `.agent/memory/index.md` only when a durable memory entry is actually created in a repository that still uses it.

## Common Failure Modes

| Failure | Correct response |
|---|---|
| Generic traceback found | Check whether it was handled and whether service/user behavior failed |
| Similar old incident exists | Compare symptoms; do not assume same cause |
| Service restarted successfully | Mark mitigated unless root cause was removed |
| Process is running | Verify functional health separately |
| One incident sample | Can still prove root cause if causal evidence is decisive |
| Fix touches multiple components | Judge evidence, risk, rollback, and verification — not component count |
| Production command unknown | Read project metadata/runbook; do not guess |

## Completion Language

Use precise status:

- `observed`
- `hypothesis`
- `mitigated`
- `root cause confirmed`
- `fix implemented`
- `production verified`
- `unresolved`

Never upgrade one status into another without fresh evidence.