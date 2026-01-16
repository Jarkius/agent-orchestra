# Learnings

_Auto-generated: 2026-01-16T09:05:39.619Z_

**Total:** 4 learnings across 3 categories

---

## Architecture

### [medium] SQLite + ChromaDB dual-storage pattern

SQLite as source of truth for reliability, ChromaDB as search index for semantic queries. Sync on write.

> **When to apply:** Building memory systems that need both structured queries and semantic search

## Tooling

### [medium] Transformers.js outperforms FastEmbed by 25x

Query time: 2ms vs 74ms. Use Transformers.js for embeddings in Node/Bun.

> **When to apply:** When choosing embedding providers for TypeScript projects

### [medium] Docker > venv for Python binary dependencies

When Python packages have binary deps (onnxruntime), Docker is more reliable than venv due to platform compatibility.

> **When to apply:** Setting up ChromaDB or similar Python tools

## Debugging

### [medium] ChromaDB metadata only supports primitives

Arrays must be converted to CSV strings. Objects not supported. String, number, boolean only.

> **When to apply:** When storing metadata in ChromaDB collections

---

## Summary

### By Confidence

| Level | Count |
|-------|-------|
| medium | 4 |

### By Category

| Category | Count |
|----------|-------|
| tooling | 2 |
| architecture | 1 |
| debugging | 1 |
