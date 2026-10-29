---
name: critic
description: "Use before an irreversible or expensive decision, and when asked to judge a plan, an answer, or a choice between options: one pass, every objection carried by external evidence, never by rephrased doubt."
---

# Critic

## Core Principle

Criticism without an external signal makes an answer worse, not better. A model
does not find its own mistake because it was asked to think again. It finds it
when a fact appears that the first pass did not have. An objection without
brought evidence is not an objection but noise, and it costs the same as a real
one.

## What Is Forbidden

These phrasings break correct answers and are never used:

- "Are you sure?"
- "Think again."
- "Double-check yourself" with no new input.
- "I think there is a mistake here" without saying where.

The reason is in the sources below: a doubt prompt flips a correct answer to a
wrong one in up to 86% of cases, and stating the asker's opinion lowers accuracy
to 27%. Doubt is not verification, it is pressure.

## LEVEL 1: a critic with evidence

One pass. Not a loop, not an argument, not a second round.

Order:

1. State the decision in one line: what exactly is proposed and what becomes
   irreversible.
2. Bring something external. Acceptable: a test run, a documentation line with
   its address, a repository file with its path, a measurement, a bill, an API
   reply, a log entry. Not acceptable: reasoning, analogy, "this is usually
   done", confidence.
3. Produce the blocks below and stop.

Output format:

```
Strongest objection: ...
Evidence:            <test | documentation | file | number>
Hidden assumption:   ...
Alternative:         ...
What is missing:     ...
```

If no external evidence can be brought, say so: "no evidence, this is opinion".
An opinion called an opinion is cheap and does not damage the decision. An
opinion passed off as an objection does.

## LEVEL 2: a council

Only when the decision is irreversible or expensive: a production change, an
architecture choice, significant money, a large volume of work ahead.

Two independent answers, then an anonymous comparison: the second participant
does not know whose answer it judges and gets different input, not a different
mask. Independence comes from different material, not from "pessimist" and
"optimist" roles.

Do not fix the number of participants. Ensemble accuracy is not monotonic in the
number of calls: an extra participant helps on an easy question and hurts on a
hard one. Start with two.

## When Criticism Is Not Needed

- The question is simple and the answer can be checked in a minute.
- The change is reversible with one command.
- The person has already decided and asks for execution, not discussion.

In these cases a critic is a tax with no result.

## How to Measure

After checking, mark every objection with one word: confirmed or not. Once a
week count the share confirmed. If it falls below half, the critic is called too
often and its threshold goes up.

## Sources

| Claim | Work |
|---|---|
| Self-correction without an external signal does not improve reasoning | Huang et al., Large Language Models Cannot Self-Correct Reasoning Yet, ICLR 2024, arXiv:2310.01798 |
| A doubt prompt flips a correct answer | Sharma et al., Towards Understanding Sycophancy in Language Models, ICLR 2024, arXiv:2310.13548 |
| Debate does not reliably beat simple ensembles | Smit et al., Should We Be Going MAD?, ICML 2024, arXiv:2311.17371 |
| No optimal number of calls exists | Chen et al., Are More LLM Calls All You Need?, 2024, arXiv:2403.02419 |
