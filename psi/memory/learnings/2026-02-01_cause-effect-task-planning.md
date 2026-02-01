# Cause-Effect Chains Make Task Dependencies Self-Documenting

**Date**: 2026-02-01
**Context**: Expanding the OpenHands-inspired evolution roadmap with agent-executable task breakdowns
**Confidence**: High

## Key Learning

Plain dependency lists ("Task B depends on Task A") tell agents WHAT to do in what order, but not WHY. Adding cause-and-effect chains transforms mechanical ordering into self-documenting rationale.

Instead of: `Phase 7 depends on Phase 1`

Write:
```
Phase 1 (Events) → Phase 7 (Stuck Detection)
  - Stuck Detector subscribes to EventStream to monitor agent action patterns
  - Without events, stuck detection would need its own monitoring mechanism
  - If skipped: agents loop forever, wasting tokens with no detection
```

This pattern has three benefits: (1) agents understand urgency and can prioritize, (2) if a dependency is questioned, the chain explains why it exists, (3) future planners can evaluate whether the dependency still holds if the architecture changes.

## The Pattern

Every task breakdown should include:
1. **Forward chain**: "This task enables X, Y, Z"
2. **Skip consequence**: "If skipped, [concrete negative outcome]"
3. **Handoff section**: "When done, downstream phases get [specific capabilities]"

## Why This Matters

Multi-agent systems need agents that understand context, not just follow ordered lists. When an agent picks up Task 7.1, seeing "if skipped, agents loop forever wasting tokens" gives it urgency context that "depends on Phase 1" never could. This is especially important when agents must make judgment calls about scope and thoroughness.

## Tags

`planning`, `task-decomposition`, `agent-orchestration`, `documentation`, `cause-effect`
