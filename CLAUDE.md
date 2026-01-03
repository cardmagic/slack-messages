# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm build          # Compile TypeScript to dist/
pnpm dev            # Watch mode for development
pnpm typecheck      # Type check without emitting
pnpm lint           # Run oxlint
pnpm test           # Run tests
pnpm test:watch     # Run tests in watch mode
```

## Architecture

Dual-mode CLI/MCP tool for searching Slack messages:

```
src/
├── index.ts      # Entry point - routes to CLI or MCP mode based on --mcp flag
├── cli.ts        # Commander-based CLI (auth, index, search, etc.)
├── mcp.ts        # MCP server exposing tools via @modelcontextprotocol/sdk
├── config.ts     # Token and workspace configuration management
├── slack-api.ts  # Slack Web API wrapper with rate limit handling
├── indexer.ts    # Fetches messages from Slack API and builds search indexes
├── searcher.ts   # Queries indexes with fuzzy matching via MiniSearch
├── formatter.ts  # Terminal output formatting with chalk
└── types.ts      # Shared types for Slack messages and search
```

**Data flow:**
1. `config.ts` manages Slack workspace tokens stored in `~/.slack-messages/config.json`
2. `slack-api.ts` wraps the `@slack/web-api` client for fetching users, conversations, and messages
3. `indexer.ts` fetches all messages and builds FTS5 + MiniSearch indexes in `~/.slack-messages/`
4. `searcher.ts` queries MiniSearch for fuzzy results, then fetches context from SQLite

**Key dependencies:**
- `@slack/web-api`: Official Slack API client with retry handling
- `better-sqlite3`: Create FTS5 index for full-text search
- `minisearch`: Fuzzy search with typo tolerance
- `@modelcontextprotocol/sdk`: MCP server for Claude Code integration

## Storage

All data stored in `~/.slack-messages/`:
- `config.json` - Workspace tokens
- `index.db` - SQLite FTS5 database
- `fuzzy.json` - MiniSearch index
- `stats.json` - Index metadata and cursors for incremental updates
- `users.json` - Cached user information

## Releasing

When asked to "bump version to X" or "tag vX.Y.Z":

1. Update `package.json` version field to the new version
2. Commit: `git add package.json && git commit -m "chore: bump version to X.Y.Z"`
3. Tag: `git tag vX.Y.Z`
4. Push: `git push && git push origin vX.Y.Z`
