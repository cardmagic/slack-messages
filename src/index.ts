#!/usr/bin/env node

// Dual-mode entry point: CLI or MCP server
// Usage:
//   slack-messages auth <token>  - Add Slack workspace
//   slack-messages index         - Build search index
//   slack-messages search "query"- Search messages
//   slack-messages --mcp         - MCP server mode (for Claude Code integration)

import { argv } from 'node:process'

const args = argv.slice(2)

if (args.includes('--mcp') || args.includes('mcp')) {
  // MCP server mode
  const { startMcpServer } = await import('./mcp.js')
  startMcpServer()
} else {
  // CLI mode
  const { runCli } = await import('./cli.js')
  runCli()
}
