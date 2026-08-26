---
name: counter-demo
summary: Build or improve the ND Counter demo with accessible controls and deterministic validation.
---

# Counter Demo Skill

Use this skill when the task is to create, repair, or review the Counter sample.

Requirements:

- show the numeric value clearly;
- provide Increment, Decrement, and Reset controls;
- controls must be keyboard reachable and have accessible names;
- state transitions must be deterministic;
- validate `reset -> +3 -> +4 -> 7`;
- do not add network dependencies for the demo;
- inspect existing project patterns before introducing framework-specific structure.

Success evidence should include the validation command or manual steps used to prove the final value reaches `7`.
