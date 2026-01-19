# Ralph Loop: Continuous Learning & Knowledge Evolution

## Mission

Continuously explore, learn, and evolve the agent-orchestra memory system by:
1. Exploring external codebases for patterns
2. Extracting insights and feeding them to the learning loop
3. Testing that learnings accumulate correctly
4. Using accumulated knowledge to improve future exploration

## Phase 1: Explore & Extract

Explore a codebase and extract valuable patterns:

```bash
# Run the stress test with Oracle-v2 exploration
bun run scripts/stress-test-with-oracle.ts
```

Verify learnings were harvested. Check the count:
```bash
sqlite3 agents.db "SELECT COUNT(*) FROM learnings;"
```

## Phase 2: Test Learning Loop

Run the learning loop tests to verify everything works:

```bash
bun test src/learning/tests/integration.test.ts
```

All tests should pass.

## Phase 3: Verify Knowledge Growth

Check that knowledge is growing:

```bash
# Check learnings by category
sqlite3 agents.db "SELECT category, COUNT(*) as count FROM learnings GROUP BY category ORDER BY count DESC;"

# Check knowledge entries
sqlite3 agents.db "SELECT COUNT(*) FROM knowledge;"

# Check lessons
sqlite3 agents.db "SELECT COUNT(*) FROM lessons;"

# Check recent learnings
sqlite3 agents.db "SELECT id, category, substr(title, 1, 50) FROM learnings ORDER BY id DESC LIMIT 5;"
```

## Phase 4: Test Retrieval

Verify that learnings can be retrieved and suggested:

```bash
bun run scripts/test-learning-loop.ts
```

The "Suggest Learnings" test should return relevant results.

## Phase 5: Add New Knowledge

If you discover something valuable during exploration, capture it:

```bash
# Quick learning
bun memory learn insight "What you discovered" --lesson "Key insight" --prevention "How to apply"

# Or use the learning loop programmatically
```

## Phase 6: Iterate

After each cycle:
1. Review what was learned
2. Identify gaps in knowledge
3. Find new codebases to explore
4. Repeat the cycle

## Completion Criteria

Output `<promise>LEARNING_EVOLVED</promise>` when:
- [ ] At least 10 new learnings harvested
- [ ] All learning loop tests pass
- [ ] Knowledge retrieval returns relevant results
- [ ] At least one manual learning captured about the process

## Available Repos to Explore

1. `/Users/jarkius/workspace/exploring/oracle-v2` - MCP memory layer (already cloned)
2. Add more repos as discovered

## Commands Reference

```bash
# Memory commands
bun memory save "summary"      # Save session
bun memory recall "query"      # Search sessions
bun memory learn <cat> "title" # Quick learning
bun memory stats               # View statistics
bun memory list learnings      # Browse learnings

# Testing
bun test                       # All tests
bun test src/learning/         # Learning tests only

# Stress test
bun run scripts/stress-test-with-oracle.ts
bun run scripts/test-learning-loop.ts
```
