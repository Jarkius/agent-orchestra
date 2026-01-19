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

1. **Auto-analyzes** your conversation context to extract:
   - Summary of accomplishments
   - Wins (what worked well)
   - Challenges (what was difficult)
   - Learnings (insights worth remembering)
   - Next steps (if any)
2. **Auto-captures** git context, Claude Code files
3. **Saves** with full context for distill to extract later

## Instructions

**IMPORTANT**: You (Claude) have full context of the session. DO NOT ask the user questions - derive everything from the conversation.

**Step 1**: Analyze the conversation and identify:

1. **Summary**: What was accomplished? (1-2 sentences)
2. **Wins**: What worked well? What's worth repeating? (list)
3. **Challenges**: What was difficult? What didn't work initially? (list)
4. **Learnings**: What insights emerged? What patterns were discovered? (list)
5. **Next Steps**: What's left to do? What should happen next? (list, optional)

**Step 2**: Run the save command with auto-generated context:

```bash
bun memory save --auto "SUMMARY" \
  --wins "WIN1" --wins "WIN2" \
  --challenges "CHALLENGE1" --challenges "CHALLENGE2" \
  --learnings "LEARNING1" --learnings "LEARNING2" \
  --next-steps "NEXT1"
```

Use multiple `--wins`, `--challenges`, `--learnings` flags for multiple items.
Omit flags if nothing applies (e.g., no challenges = no --challenges flag).

**Step 3**: Show the user what was captured:
- Session ID
- Summary
- Wins count
- Challenges count
- Learnings count
- Remind them `/memory-distill` can extract more learnings later

## Example

For a session where you helped implement a feature:

```bash
bun memory save --auto "Implemented user authentication with JWT tokens" \
  --wins "Clean separation of auth middleware" \
  --wins "Reusable token validation pattern" \
  --challenges "Initial confusion about refresh token flow" \
  --learnings "JWT refresh tokens should be stored in httpOnly cookies" \
  --learnings "Auth middleware should fail closed (deny by default)" \
  --next-steps "Add rate limiting to auth endpoints"
```

## Key Principle

You have the full conversation context. Use it! Don't burden the user with questions you can answer yourself. Only ask if something is genuinely ambiguous.
