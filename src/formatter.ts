import chalk from 'chalk'
import type { IndexedMessage, SearchResultWithContext, IndexStats } from './types.js'

const BOX_TOP = '\u2501' // ━
const BOX_VERTICAL = '\u2502' // │

function formatDate(unixTimestamp: number): string {
  const date = new Date(unixTimestamp * 1000)
  return date.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

function formatSender(message: IndexedMessage): string {
  if (message.isFromMe) {
    return chalk.cyan('[You]')
  }
  // Truncate long sender names
  let sender = message.sender
  if (sender.length > 20) {
    sender = sender.slice(0, 17) + '...'
  }
  return chalk.yellow(`[${sender}]`)
}

function formatMessage(
  message: IndexedMessage,
  isMatch: boolean,
  matchedTerms: string[] = []
): string {
  const sender = formatSender(message)
  let text = message.text

  // Highlight matched terms in the text
  if (isMatch && matchedTerms.length > 0) {
    for (const term of matchedTerms) {
      const regex = new RegExp(`(${escapeRegex(term)})`, 'gi')
      text = text.replace(regex, chalk.bgYellow.black('$1'))
    }
  }

  const prefix = isMatch ? chalk.green('\u25b6') : ' ' // ▶ for match
  return `${prefix} ${sender} ${text}`
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function formatSearchResult(
  result: SearchResultWithContext,
  _index: number
): string {
  const { result: searchResult, before, after } = result
  const { message, matchedTerms } = searchResult

  const lines: string[] = []

  // Header
  const header = BOX_TOP.repeat(60)
  lines.push(chalk.dim(header))

  const chatName = message.chatName || 'Unknown Channel'
  const dateStr = formatDate(message.date)
  lines.push(
    `${chalk.bold('Channel:')} ${chalk.magenta('#' + chatName)}  ${BOX_VERTICAL}  ${chalk.dim(dateStr)}`
  )

  lines.push(chalk.dim(header))

  // Context before
  for (const msg of before) {
    lines.push(formatMessage(msg, false))
  }

  // Matched message
  lines.push(formatMessage(message, true, matchedTerms))

  // Context after
  for (const msg of after) {
    lines.push(formatMessage(msg, false))
  }

  lines.push('') // Empty line between results

  return lines.join('\n')
}

export function formatStats(stats: IndexStats): string {
  const lines: string[] = []

  lines.push(chalk.bold.green('Index Statistics'))
  lines.push(chalk.dim('\u2500'.repeat(40)))
  if (stats.workspaceName) {
    lines.push(`${chalk.dim('Workspace:')}  ${stats.workspaceName}`)
  }
  lines.push(`${chalk.dim('Messages:')}   ${stats.totalMessages.toLocaleString()}`)
  lines.push(`${chalk.dim('Channels:')}   ${stats.totalChats.toLocaleString()}`)
  lines.push(`${chalk.dim('Users:')}      ${stats.totalContacts.toLocaleString()}`)
  lines.push(`${chalk.dim('Indexed at:')} ${stats.indexedAt.toLocaleString()}`)
  lines.push(`${chalk.dim('Date range:')} ${formatDateRange(stats.oldestMessage, stats.newestMessage)}`)

  return lines.join('\n')
}

function formatDateRange(oldest: Date, newest: Date): string {
  const format = (d: Date) =>
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  return `${format(oldest)} - ${format(newest)}`
}

export function formatNoResults(query: string): string {
  return chalk.yellow(`No messages found matching "${query}"`)
}

export function formatIndexProgress(
  phase: string,
  current: number,
  total: number
): string {
  const percent = total > 0 ? Math.round((current / total) * 100) : 0
  const bar = createProgressBar(percent)

  let phaseLabel: string
  switch (phase) {
    case 'auth':
      phaseLabel = 'Authenticating'
      break
    case 'users':
      phaseLabel = 'Fetching users'
      break
    case 'conversations':
      phaseLabel = 'Fetching channels'
      break
    case 'messages':
      phaseLabel = 'Fetching messages'
      break
    case 'threads':
      phaseLabel = 'Fetching threads'
      break
    case 'indexing-fts':
      phaseLabel = 'Building search index'
      break
    case 'indexing-fuzzy':
      phaseLabel = 'Building fuzzy index'
      break
    case 'done':
      phaseLabel = 'Done'
      break
    default:
      phaseLabel = phase
  }

  if (total === 0) {
    return `${phaseLabel}...`
  }

  return `${phaseLabel}: ${bar} ${percent}% (${current.toLocaleString()}/${total.toLocaleString()})`
}

function createProgressBar(percent: number): string {
  const width = 20
  const filled = Math.round((percent / 100) * width)
  const empty = width - filled
  return chalk.green('\u2588'.repeat(filled)) + chalk.dim('\u2591'.repeat(empty))
}
