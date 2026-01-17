# Memory Export

Export learnings to a markdown file for documentation or sharing.

## Usage

```
/memory-export [output_path]
```

## Examples

```bash
# Export to default LEARNINGS.md
/memory-export

# Export to custom path
/memory-export ./docs/LEARNINGS.md
/memory-export ~/notes/claude-learnings.md
```

## Output Format

The generated markdown includes:

### Header
- Total learnings count
- Export timestamp
- Confidence distribution

### Categories
Organized by category with badges:
- `[PROVEN]` - Validated 3+ times
- `[HIGH]` - Validated 2 times
- `[MEDIUM]` - User confirmed
- `[LOW]` - Quick capture or distilled

### Each Learning
- Title
- Description (if provided)
- Context/when to apply
- Source session reference
- Validation count

## Example Output

```markdown
# Learnings

> 24 learnings exported on 2026-01-17

## Philosophy

### [PROVEN] Simplicity over cleverness
Code should be readable first, optimized second.
*Validated 5 times*

## Architecture

### [HIGH] Dual-storage pattern
SQLite for truth, ChromaDB for search.
*Source: session_1768629209122*
```

## Instructions

Run the export command:
```bash
bun memory export $ARGUMENTS
```

After export, confirm the file path and category breakdown.
