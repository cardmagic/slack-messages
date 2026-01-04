# slack-messages

Fuzzy search and browse Slack messages from the command line or as an MCP server.

## Features

- **Fuzzy search** with typo tolerance across all your Slack messages
- **Browse recent** messages, users, and channels
- **User name resolution** - shows display names instead of user IDs
- **Context display** - see messages before/after each match
- **Filter by sender** or date range
- **Thread support** - indexes thread replies alongside parent messages
- **Incremental updates** - quickly fetch only new messages
- **Multiple interfaces** - CLI or MCP server

## Requirements

- Node.js 22+
- Slack user token with appropriate scopes (see below)

## Installation

### npm

```bash
npm install -g @cardmagic/slack-messages
```

### From source

```bash
git clone https://github.com/cardmagic/slack-messages.git
cd slack-messages
pnpm install
pnpm build
npm link
```

## Getting a Slack Token

You need a **User OAuth Token** (starts with `xoxp-`), NOT a Bot token.

> **Important:** Bot tokens (`xoxb-...`) only see the bot's own empty DMs. You must use a User token (`xoxp-...`) to access your messages.

### Required Scopes

Add these under **"User Token Scopes"** (not "Bot Token Scopes"):

| Scope | Purpose |
|-------|---------|
| `channels:history` | Read public channel messages |
| `groups:history` | Read private channel messages |
| `im:history` | Read DM messages |
| `mpim:history` | Read group DM messages |
| `users:read` | Get user display names |
| `channels:read` | List public channels |
| `groups:read` | List private channels |
| `im:read` | List DMs |
| `mpim:read` | List group DMs |

### Step-by-Step: Create a Slack App

1. **Go to the Slack API portal**
   - Visit [api.slack.com/apps](https://api.slack.com/apps)
   - Sign in to your Slack workspace if prompted

2. **Create a new app**
   - Click **"Create New App"**
   - Choose **"From scratch"**
   - Enter a name (e.g., "Message Search")
   - Select your workspace
   - Click **"Create App"**

3. **Add User Token Scopes** (this is critical!)
   - In the left sidebar, click **"OAuth & Permissions"**
   - Scroll down to find **"User Token Scopes"**
   - ⚠️ **NOT "Bot Token Scopes"** - that's a different section!
   - Click **"Add an OAuth Scope"** and add ALL of these:
     - `channels:history`
     - `channels:read`
     - `groups:history`
     - `groups:read`
     - `im:history`
     - `im:read`
     - `mpim:history`
     - `mpim:read`
     - `users:read`

4. **Install the app to your workspace**
   - Scroll back up to **"OAuth Tokens for Your Workspace"**
   - Click **"Install to Workspace"**
   - Review the permissions and click **"Allow"**

5. **Copy the correct token**
   - After installing, you'll see TWO tokens on the OAuth page:
     - ✅ **"User OAuth Token"** - starts with `xoxp-` - **USE THIS ONE**
     - ❌ "Bot User OAuth Token" - starts with `xoxb-` - don't use this
   - Copy the `xoxp-` token

6. **Add it to slack-messages**
   ```bash
   slack-messages auth
   # Paste your token when prompted (input is hidden)
   ```

### Verify Your Token

After adding your token, verify it's correct:
```bash
slack-messages index
```

If you see "Messages: 0" but you know you have messages, you likely used a Bot token by mistake. Go back to step 5 and get the User OAuth Token.

### Security Notes

- Your token is stored locally in `~/.slack-messages/config.json`
- Never commit or share your token
- You can revoke the token anytime from api.slack.com/apps

## Usage

### Initial Setup

```bash
# Add your Slack workspace (token is prompted securely)
slack-messages auth

# Build the search index (fetches all messages)
slack-messages index

# For incremental updates later
slack-messages index --update
```

### CLI Commands

#### Browse Commands

```bash
# Show most recent messages
slack-messages recent

# List users by recent activity
slack-messages contacts --limit 10

# List channels/DMs with message counts
slack-messages conversations

# Show recent messages from someone
slack-messages from "John Smith"

# Show full conversation in a channel
slack-messages thread "general" --after 2024-12-01
```

#### Search Commands

```bash
# Search for messages
slack-messages search "quarterly report"

# Filter by sender
slack-messages search "project update" --from "Sarah"

# Filter by date
slack-messages search "meeting" --after 2024-01-01

# Adjust result count and context
slack-messages search "deadline" --limit 20 --context 5

# Show index statistics
slack-messages stats
```

#### Workspace Management

```bash
# List configured workspaces
slack-messages workspaces

# Remove a workspace
slack-messages remove T0123456789
```

### Search Options

| Option | Description |
|--------|-------------|
| `-f, --from <sender>` | Filter by sender name |
| `-a, --after <date>` | Only messages after date (YYYY-MM-DD) |
| `-l, --limit <n>` | Max results (default: 10) |
| `-c, --context <n>` | Messages before/after (default: 2) |

### MCP Server

Run as an MCP server for Claude Code integration:

```bash
slack-messages --mcp
# or
slack-messages mcp
```

Add to your Claude Code configuration:

```bash
claude mcp add --transport stdio slack-messages -- slack-messages --mcp
```

Or manually in your MCP config:

```json
{
  "mcpServers": {
    "slack-messages": {
      "command": "npx",
      "args": ["-y", "@cardmagic/slack-messages", "--mcp"]
    }
  }
}
```

**Available MCP Tools:**

| Tool | Description |
|------|-------------|
| `search_messages` | Search messages with fuzzy matching |
| `recent_messages` | Get most recent messages |
| `list_contacts` | List users by activity |
| `list_conversations` | List channels/DMs with counts |
| `get_thread` | Get conversation in a channel |
| `get_message_stats` | Get index statistics |

## How It Works

1. **Authentication**: Store your Slack user token locally
2. **Indexing**: Fetch messages via Slack API and build local indexes:
   - Lists all conversations (channels, DMs, group DMs)
   - Fetches message history for each conversation
   - Fetches thread replies for messages with replies
   - Caches user information for name resolution
3. **Storage**: Index files in `~/.slack-messages/`:
   - `config.json` - Workspace tokens
   - `index.db` - SQLite FTS5 database
   - `fuzzy.json` - MiniSearch index for typo tolerance
   - `stats.json` - Index statistics and cursors for incremental updates
   - `users.json` - Cached user information

## Rate Limiting

The Slack API has rate limits. The tool uses the official `@slack/web-api` client which handles retries automatically. For large workspaces, initial indexing may take a while.

## License

MIT
