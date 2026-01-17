# Memory Stats

Show memory system statistics and usage overview.

## Usage

```
/memory-stats
```

## What It Shows

### Session Statistics
- Total sessions
- Sessions this week/month
- Average duration
- Total commits tracked

### Tag Distribution
- Top 5 most used tags
- Tag counts

### Learning Statistics
- Total learnings
- By category breakdown
- Confidence distribution (low/medium/high/proven)

### Recent Activity
- Last 5 sessions with timestamps

## Example Output

```
Sessions: 32 total, 12 this week
Avg duration: 45 mins
Total commits: 156

Top tags: memory-system (8), auth (5), api (4)

Learnings: 24 total
  - insight: 8
  - architecture: 6
  - debugging: 4
  ...

Confidence: 3 proven, 8 high, 10 medium, 3 low
```

## Instructions

Run the stats command:
```bash
bun memory stats
```

Summarize the key statistics for the user.
