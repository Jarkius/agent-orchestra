# Memory Reset

Nuclear option to completely wipe all memory data.

## Usage

```
/memory-reset
```

## What Gets Deleted

- **All sessions** and their tasks
- **All learnings**
- **All session links** (relationships)
- **All learning links** (relationships)
- **All ChromaDB vectors** (search indexes)

## Safety

This is a **destructive operation** that cannot be undone.

- Shows current stats before reset
- Requires typing `yes` to confirm (not just `y`)
- Any other input aborts the operation

## Example Interaction

```
Current memory state:
  Sessions: 32
  Total commits tracked: 156

This will permanently delete:
  • All sessions and their tasks
  • All learnings
  • All session and learning links
  • All ChromaDB vector data

Type 'yes' to confirm complete reset: yes

✓ Memory reset complete. All data has been deleted.
```

## When to Use

- Starting fresh on a new project
- Cleaning up test/development data
- Privacy cleanup before sharing

## Prefer Purge Instead

For selective cleanup, use `/memory-purge`:
- `/memory-purge sessions --keep 5` - Keep recent work
- `/memory-purge sessions --before 2025-01-01` - Remove old data

## Instructions

Run the reset command:
```bash
bun memory reset
```

Confirm the operation completed and show the user the result.
