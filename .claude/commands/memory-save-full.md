---
description: "Save session with full context (wins, challenges, learnings) for later distillation. Use this for thorough session capture."
---

# Memory Save Full

Save the current session with full context that can be distilled into learnings later.

## Usage

```
/memory-save-full
```

## What This Does

1. **Asks you** for session context (via questions below)
2. **Auto-captures** git context, Claude Code files
3. **Saves** with full context for distill to extract later

## Instructions

**Step 1**: Ask the user these questions using AskUserQuestion tool:

Question 1 - Summary:
- question: "What did you accomplish this session?"
- header: "Summary"
- options: (let user type - use "Other" option)

Question 2 - Wins:
- question: "What worked well? (things worth repeating)"
- header: "Wins"
- multiSelect: true
- options: based on recent work, or let user type

Question 3 - Challenges:
- question: "What was difficult or didn't work?"
- header: "Challenges"
- multiSelect: true
- options: based on recent work, or let user type

Question 4 - Learnings:
- question: "What insights or learnings from this session?"
- header: "Learnings"
- multiSelect: true
- options: based on conversation, or let user type

**Step 2**: After getting answers, run:

```bash
bun memory save --auto "SUMMARY" --wins "WIN1, WIN2" --challenges "CHALLENGE1" --learnings "LEARNING1, LEARNING2" --next-steps "NEXT1"
```

Replace placeholders with actual user answers. Omit flags if user didn't provide that type of input.

**Step 3**: Confirm to user:
- Session ID created
- What was captured (wins count, challenges count, learnings count)
- Remind them they can run `/memory-distill` later to extract learnings

## Example Flow

Claude asks:
> What did you accomplish this session?

User answers:
> Built the memory distill workflow

Claude asks:
> What worked well?

User answers:
> The knowledge lifecycle diagram, slash command pattern

Claude asks:
> What was difficult?

User answers:
> Understanding when to use distill vs learn

Claude asks:
> What insights or learnings?

User answers:
> Sessions need full_context for distill to work, Interactive mode captures more than auto mode

Claude runs:
```bash
bun memory save --auto "Built the memory distill workflow" --wins "The knowledge lifecycle diagram, slash command pattern" --challenges "Understanding when to use distill vs learn" --learnings "Sessions need full_context for distill to work, Interactive mode captures more than auto mode"
```
