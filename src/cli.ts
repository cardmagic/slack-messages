import { createRequire } from 'module'
import { program } from 'commander'
import chalk from 'chalk'
import { buildIndex, updateIndex, getStats } from './indexer.js'
import { addWorkspace, listWorkspaces, removeWorkspace } from './config.js'
import { SlackApi } from './slack-api.js'

const require = createRequire(import.meta.url)
const { version } = require('../package.json')
import {
  search,
  closeConnections,
  getRecentMessages,
  getContacts,
  getConversations,
  getThread,
} from './searcher.js'
import {
  formatSearchResult,
  formatStats,
  formatNoResults,
  formatIndexProgress,
} from './formatter.js'
import type { SearchOptions } from './types.js'

export function runCli(): void {
  program
    .name('slack-messages')
    .description('Fuzzy search through Slack messages. Run with --mcp for MCP server mode.')
    .version(version)

  program
    .command('auth <token>')
    .description('Add a Slack workspace using a user token (xoxp-...)')
    .action(async (token) => {
      try {
        console.log(chalk.dim('Verifying token...'))
        const api = new SlackApi(token)
        const info = await api.testAuth()

        addWorkspace({
          id: info.teamId,
          name: info.teamName,
          token,
        })

        console.log(chalk.green(`\u2713 Added workspace: ${info.teamName}`))
        console.log(chalk.dim(`Workspace ID: ${info.teamId}`))
        console.log()
        console.log(chalk.dim('Run `slack-messages index` to build the search index.'))
      } catch (error) {
        console.error(chalk.red('Authentication failed:'), (error as Error).message)
        process.exit(1)
      }
    })

  program
    .command('workspaces')
    .description('List configured Slack workspaces')
    .action(() => {
      const workspaces = listWorkspaces()

      if (workspaces.length === 0) {
        console.log(chalk.yellow('No workspaces configured.'))
        console.log(chalk.dim('Run `slack-messages auth <token>` to add one.'))
        return
      }

      console.log(chalk.bold('Configured workspaces:\n'))
      for (const ws of workspaces) {
        console.log(`  ${chalk.green(ws.name)} ${chalk.dim(`(${ws.id})`)}`)
      }
    })

  program
    .command('remove <workspace-id>')
    .description('Remove a Slack workspace')
    .action((workspaceId) => {
      const removed = removeWorkspace(workspaceId)
      if (removed) {
        console.log(chalk.green(`\u2713 Removed workspace: ${workspaceId}`))
      } else {
        console.log(chalk.yellow(`Workspace not found: ${workspaceId}`))
      }
    })

  program
    .command('index')
    .description('Build or update the search index from Slack')
    .option('-q, --quiet', 'Suppress progress output')
    .option('-u, --update', 'Incremental update (only index new messages)')
    .action(async (options) => {
      const isIncremental = options.update
      const log = options.quiet ? () => {} : console.log.bind(console)

      log(chalk.bold(isIncremental ? 'Updating search index...' : 'Rebuilding search index...'))
      log(chalk.dim('Fetching messages from Slack API'))
      log()

      try {
        const progressCallback = (progress: { phase: string; current: number; total: number; detail?: string }) => {
          if (!options.quiet) {
            const detail = progress.detail ? ` - ${progress.detail}` : ''
            process.stdout.write(
              '\r' + formatIndexProgress(progress.phase, progress.current, progress.total) + detail + '        '
            )
            if (progress.phase === 'done') {
              console.log()
            }
          }
        }

        let stats
        if (isIncremental) {
          stats = await updateIndex(progressCallback)
          if (!stats) {
            log(chalk.yellow('\nNo existing index found, performing full rebuild...'))
            log()
            stats = await buildIndex(progressCallback)
          }
        } else {
          stats = await buildIndex(progressCallback)
        }

        log()
        log(chalk.green(isIncremental ? '\u2713 Index updated successfully!' : '\u2713 Index rebuilt successfully!'))
        log()
        log(formatStats(stats))
      } catch (error) {
        console.error(chalk.red('\nError building index:'), (error as Error).message)
        process.exit(1)
      }
    })

  program
    .command('search <query>')
    .description('Search messages with fuzzy matching')
    .option('-f, --from <sender>', 'Filter by sender name')
    .option('-a, --after <date>', 'Show only messages after this date (YYYY-MM-DD)')
    .option('-l, --limit <number>', 'Maximum number of results', '10')
    .option('-c, --context <number>', 'Number of messages to show before/after', '2')
    .action((query, options) => {
      const searchOptions: SearchOptions = {
        query,
        from: options.from,
        after: options.after ? new Date(options.after) : undefined,
        limit: parseInt(options.limit, 10),
        context: parseInt(options.context, 10),
      }

      try {
        const results = search(searchOptions)

        if (results.length === 0) {
          console.log(formatNoResults(query))
          return
        }

        console.log(
          chalk.dim(`Found ${results.length} result${results.length === 1 ? '' : 's'}:`)
        )
        console.log()

        for (let i = 0; i < results.length; i++) {
          console.log(formatSearchResult(results[i], i))
        }
      } catch (error) {
        console.error(chalk.red('Search error:'), (error as Error).message)
        process.exit(1)
      } finally {
        closeConnections()
      }
    })

  program
    .command('from <sender>')
    .description('List recent messages from a specific sender')
    .option('-a, --after <date>', 'Show only messages after this date (YYYY-MM-DD)')
    .option('-l, --limit <number>', 'Maximum number of results', '20')
    .option('-c, --context <number>', 'Number of messages to show before/after', '2')
    .action((sender, options) => {
      const searchOptions: SearchOptions = {
        from: sender,
        after: options.after ? new Date(options.after) : undefined,
        limit: parseInt(options.limit, 10),
        context: parseInt(options.context, 10),
      }

      try {
        const results = search(searchOptions)

        if (results.length === 0) {
          console.log(chalk.yellow(`No messages found from "${sender}"`))
          return
        }

        console.log(
          chalk.dim(`Found ${results.length} message${results.length === 1 ? '' : 's'} from ${sender}:`)
        )
        console.log()

        for (let i = 0; i < results.length; i++) {
          console.log(formatSearchResult(results[i], i))
        }
      } catch (error) {
        console.error(chalk.red('Search error:'), (error as Error).message)
        process.exit(1)
      } finally {
        closeConnections()
      }
    })

  program
    .command('recent')
    .description('Show most recent messages')
    .option('-l, --limit <number>', 'Maximum number of messages', '20')
    .action((options) => {
      try {
        const messages = getRecentMessages(parseInt(options.limit, 10))

        if (messages.length === 0) {
          console.log(chalk.yellow('No messages found.'))
          return
        }

        console.log(chalk.dim(`Most recent ${messages.length} messages:\n`))

        for (const { message } of messages) {
          const date = new Date(message.date * 1000)
          const dateStr = date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          })
          const sender = message.isFromMe ? chalk.blue('You') : chalk.green(message.sender)
          const chatName = chalk.dim(`[#${message.chatName}]`)
          const text = message.text.length > 60 ? message.text.slice(0, 60) + '...' : message.text

          console.log(`${chalk.dim(dateStr)} ${chatName} ${sender}: ${text}`)
        }
      } catch (error) {
        console.error(chalk.red('Error:'), (error as Error).message)
        process.exit(1)
      } finally {
        closeConnections()
      }
    })

  program
    .command('contacts')
    .description('List contacts by recent activity')
    .option('-l, --limit <number>', 'Maximum number of contacts', '20')
    .action((options) => {
      try {
        const contacts = getContacts(parseInt(options.limit, 10))

        if (contacts.length === 0) {
          console.log(chalk.yellow('No contacts found.'))
          return
        }

        console.log(chalk.dim(`Top ${contacts.length} contacts by recent activity:\n`))

        for (const contact of contacts) {
          const date = new Date(contact.lastMessageDate * 1000)
          const dateStr = date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
          })
          const count = chalk.dim(`(${contact.messageCount} messages)`)

          console.log(`${chalk.green(contact.name)} ${count} - last: ${chalk.dim(dateStr)}`)
        }
      } catch (error) {
        console.error(chalk.red('Error:'), (error as Error).message)
        process.exit(1)
      } finally {
        closeConnections()
      }
    })

  program
    .command('conversations')
    .description('List channels and DMs with message counts')
    .option('-l, --limit <number>', 'Maximum number of conversations', '20')
    .action((options) => {
      try {
        const conversations = getConversations(parseInt(options.limit, 10))

        if (conversations.length === 0) {
          console.log(chalk.yellow('No conversations found.'))
          return
        }

        console.log(chalk.dim(`Top ${conversations.length} conversations:\n`))

        for (const conv of conversations) {
          const date = new Date(conv.lastMessageDate * 1000)
          const dateStr = date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
          })
          const count = chalk.dim(`(${conv.messageCount} msgs)`)
          const lastMsg = conv.lastMessage
            ? conv.lastMessage.length > 40
              ? conv.lastMessage.slice(0, 40) + '...'
              : conv.lastMessage
            : ''

          console.log(`${chalk.green('#' + conv.chatName)} ${count} - ${chalk.dim(dateStr)}`)
          if (lastMsg) {
            console.log(`  ${chalk.dim('\u2514\u2500')} ${lastMsg}`)
          }
        }
      } catch (error) {
        console.error(chalk.red('Error:'), (error as Error).message)
        process.exit(1)
      } finally {
        closeConnections()
      }
    })

  program
    .command('thread <channel>')
    .description('Show full conversation thread in a channel or DM')
    .option('-a, --after <date>', 'Show only messages after this date (YYYY-MM-DD)')
    .option('-l, --limit <number>', 'Maximum number of messages', '50')
    .action((channel, options) => {
      try {
        const messages = getThread(channel, {
          after: options.after ? new Date(options.after) : undefined,
          limit: parseInt(options.limit, 10),
        })

        if (messages.length === 0) {
          console.log(chalk.yellow(`No messages found in "${channel}"`))
          return
        }

        const chatName = messages[0].chatName
        console.log(chalk.bold(`Conversation in #${chatName}\n`))

        let lastDate = ''
        for (const message of messages) {
          const date = new Date(message.date * 1000)
          const dateStr = date.toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
          })
          const timeStr = date.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
          })

          // Print date separator when date changes
          if (dateStr !== lastDate) {
            console.log(chalk.dim(`\n--- ${dateStr} ---\n`))
            lastDate = dateStr
          }

          const sender = message.isFromMe ? chalk.blue('You') : chalk.green(message.sender)
          console.log(`${chalk.dim(timeStr)} ${sender}: ${message.text}`)
        }
      } catch (error) {
        console.error(chalk.red('Error:'), (error as Error).message)
        process.exit(1)
      } finally {
        closeConnections()
      }
    })

  program
    .command('stats')
    .description('Show index statistics')
    .action(() => {
      const stats = getStats()
      if (!stats) {
        console.error(
          chalk.red('Index not found. Run `slack-messages index` first to build the search index.')
        )
        process.exit(1)
      }
      console.log(formatStats(stats))
    })

  program
    .command('mcp')
    .description('Start as MCP server (for Claude Code integration)')
    .action(async () => {
      const { startMcpServer } = await import('./mcp.js')
      startMcpServer()
    })

  // Default action: if no command provided, show help
  program.action(() => {
    program.help()
  })

  program.parse()
}
