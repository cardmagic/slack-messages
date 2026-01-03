// Slack API types
export interface SlackUser {
  id: string
  name: string
  realName: string
  displayName: string
}

export interface SlackConversation {
  id: string
  name: string
  isChannel: boolean
  isPrivate: boolean
  isIm: boolean
  isMpim: boolean
  userId?: string // for DMs, the other user's ID
}

export interface SlackMessage {
  ts: string // Slack timestamp (e.g., "1234567890.123456")
  user: string // user ID
  text: string
  channelId: string
  threadTs?: string // parent message ts if this is a reply
  replyCount: number
}

// Indexed message stored in our FTS5 database
export interface IndexedMessage {
  id: number // auto-increment ID
  text: string
  sender: string // resolved user display name
  chatName: string // channel/DM name
  chatId: string // channel ID
  date: number // Unix timestamp (seconds)
  isFromMe: boolean
  threadTs?: string
}

// Search result with relevance score
export interface SearchResult {
  message: IndexedMessage
  score: number
  matchedTerms: string[]
}

// Search result with context (surrounding messages)
export interface SearchResultWithContext {
  result: SearchResult
  before: IndexedMessage[]
  after: IndexedMessage[]
}

// Search options for the CLI
export interface SearchOptions {
  query?: string // optional when filtering by sender
  from?: string // filter by sender
  after?: Date // filter by date
  limit: number
  context: number // number of messages before/after to show
}

// Index stats
export interface IndexStats {
  totalMessages: number
  totalChats: number
  totalContacts: number
  indexedAt: Date
  oldestMessage: Date
  newestMessage: Date
  workspaceId: string
  workspaceName: string
  conversationCursors: Record<string, string> // channelId -> last indexed ts
}

// Convert Slack timestamp to Unix timestamp (seconds)
export function slackTsToUnix(ts: string): number {
  return Math.floor(Number.parseFloat(ts))
}

// Convert Unix timestamp to JavaScript Date
export function unixToDate(unixTimestamp: number): Date {
  return new Date(unixTimestamp * 1000)
}

// Convert Slack timestamp to JavaScript Date
export function slackTsToDate(ts: string): Date {
  return unixToDate(slackTsToUnix(ts))
}
