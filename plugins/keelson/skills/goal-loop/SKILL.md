---
name: goal-loop
description: "Use when the user gives a goal and hard limits instead of a task and expects the agent to find the way itself: reduce a metric, find why a number does not move, reach a target by any allowed means. A charter only the user edits, hypotheses with kill criteria written before the test, cheap checks first, a separate evaluator, an append-only ledger."
---

# Goal Loop

## Core Principle

A goal without a number turns search into guessing, and an agent that changes the
rules and judges itself finds what it wants to find. So three things are kept
apart: the goal and the prohibitions are written only by the human, the approach
is changed by the agent, and the verdict is given by someone other than the one
who proposed the hypothesis. Most ideas should die before any code is written,
at a desk check, otherwise the loop burns tokens on curve fitting.

Running example below: reduce the p95 latency of a web API from 480 ms to under
250 ms without raising the error rate.

## Files

Everything lives in the task repository, in `goal-loop/`:

- `charter.md`: the goal as numbers a machine can check ("p95 of `GET /orders`
  under 250 ms on the replay benchmark, error rate not above the baseline, at
  least 10,000 requests per run"), hard prohibitions ("no caching of
  per-user data", "no schema changes"), and budgets (cycles per day, tokens per
  cycle, heavy runs per week). Only the user writes and changes it.
- `rules.md`: the agent's approach, which it may change. Every edit links to the
  ledger line it follows from.
- `hypotheses.jsonl`: the hypothesis, its mechanism ("why should this work"),
  the test tier T0-T3, and the kill criterion. The criterion is written before
  the test and never changed afterwards.
- `ledger.jsonl`: append only. The attempt, parameters, data, the metric against
  the current winner, a label accept / watch / reject / needs-replay, and a
  running attempt number.
- `holdout/`: held-out data on which every candidate is checked once.

List `charter.md`, `holdout/` and the evaluation script in the repository's
`.agent/protected` file: the `protect-guard.mjs` hook then stops the agent from
editing them.

## The Loop

0. Once, at the start: baselines. The current system against the simplest
   alternative (the unmodified service; a trivial change with the same scope),
   with the result split into signal, overhead and noise. If the system does not
   beat the trivial change, tuning its parameters is pointless and the search
   belongs elsewhere.
1. Generation: a subagent gets the charter, the rules and the last 20 ledger
   lines and proposes 5-10 hypotheses, including inconvenient ones ("the time is
   in the database, not the handler", "the benchmark is the problem"). At a
   turning point, use a panel of three fresh subagents instead of the generator:
   a skeptic, a pragmatist, a critic, each up to 300 words with a mandatory
   "strongest disagreement".
2. T0, no code: is the effect known and still current, is there enough data, does
   the expected gain exceed the overhead. About half the ideas are dropped here.
3. T1: a quick check on training data, one hypothesis per subagent, in parallel,
   one variable per variant.
4. Evaluation: a deterministic script first. An evaluator in a clean context
   reviews the ones that pass: peeking at the answer, a benchmark that is not
   representative, hidden overhead, how many attempts came before this one.
5. T2: a shifted-window check and one run on the holdout, then two independent
   reviewers with one rubric, both must say yes. T3: a staged rollout with an
   emergency stop.
6. A real action (production, spending) only after the user says yes to the exact
   configuration.
7. The agent edits `rules.md` from the outcome and records the result, with a
   number, in the task record.

## When to Kill

- Not better than the baseline after overhead.
- Holds on one or two samples or one period only.
- More than three parameter sets were tried.
- The significance threshold rises with the running attempt number: a hundred
  attempts give a random winner almost surely.

## When to Stop the Loop

- Two cycles with no new watch or accept: convene a panel.
- Three turning points without progress: stop and report "no gain found". This
  is an honest result, not a failure.
- Any budget from the charter is exhausted.

## Saving Tokens

Most hypotheses die at T0, without code. Subagents get digests, not the
conversation. The evaluator, the reviewers and the panel work only at the gates.
Each cycle runs in a new session with a handoff (`handoff.mjs`), and a long
background run is picked up when its notification arrives.

## Prohibitions Are Held by Code, Not by the Prompt

A prohibition such as "no caching of per-user data" is checked in code and
covered by a test: a response that carries a per-user key into the shared cache
fails the test. The benchmark applies the same rule, otherwise ideas that break
it would look profitable. The `protect-guard.mjs` hook keeps the agent from
weakening the check or the charter.

## Completion

The loop is finished when the charter goal is met, a budget is exhausted, or
three turning points find no gain. In every case the result goes into the task
record: before, after, how many attempts, what was killed and why.
