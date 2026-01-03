import Database from 'better-sqlite3'
import MiniSearch from 'minisearch'
import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { SlackApi } from './slack-api.js'
import { getConfigDir, getDefaultWorkspace } from './config.js'
import type { IndexedMessage, IndexStats, SlackUser } from './types.js'
import { slackTsToUnix } from './types.js'

const INDEX_DB_PATH = join(getConfigDir(), 'index.db')
const FUZZY_INDEX_PATH = join(getConfigDir(), 'fuzzy.json')
const STATS_PATH = join(getConfigDir(), 'stats.json')
const USERS_CACHE_PATH = join(getConfigDir(), 'users.json')

export function ensureIndexDir(): void {
  const dir = getConfigDir()
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

export function getIndexDbPath(): string {
  return INDEX_DB_PATH
}

export function getFuzzyIndexPath(): string {
  return FUZZY_INDEX_PATH
}

export function indexExists(): boolean {
  return existsSync(INDEX_DB_PATH) && existsSync(FUZZY_INDEX_PATH)
}

export function getStats(): IndexStats | null {
  if (!existsSync(STATS_PATH)) {
    return null
  }
  const raw = readFileSync(STATS_PATH, 'utf-8')
  const data = JSON.parse(raw)
  return {
    ...data,
    indexedAt: new Date(data.indexedAt),
    oldestMessage: new Date(data.oldestMessage),
    newestMessage: new Date(data.newestMessage),
  }
}

function saveStats(stats: IndexStats): void {
  writeFileSync(STATS_PATH, JSON.stringify(stats, null, 2))
}

function loadUsersCache(): Map<string, SlackUser> {
  if (!existsSync(USERS_CACHE_PATH)) {
    return new Map()
  }
  const raw = readFileSync(USERS_CACHE_PATH, 'utf-8')
  const users = JSON.parse(raw) as SlackUser[]
  return new Map(users.map((u) => [u.id, u]))
}

function saveUsersCache(users: Map<string, SlackUser>): void {
  const arr = Array.from(users.values())
  writeFileSync(USERS_CACHE_PATH, JSON.stringify(arr, null, 2))
}

export interface IndexProgress {
  current: number
  total: number
  phase: 'auth' | 'users' | 'conversations' | 'messages' | 'threads' | 'indexing-fts' | 'indexing-fuzzy' | 'done'
  detail?: string
}

export function ensureIndex(
  _onProgress?: (progress: IndexProgress) => void
): 'none' | 'incremental' | 'full' {
  if (!indexExists()) {
    return 'none'
  }
  // For Slack, we don't auto-rebuild - user must explicitly run index
  return 'none'
}

export async function buildIndex(
  onProgress?: (progress: IndexProgress) => void
): Promise<IndexStats> {
  ensureIndexDir()

  const workspace = getDefaultWorkspace()
  if (!workspace) {
    throw new Error(
      'No Slack workspace configured. Run `slack-messages auth <token>` to add one.'
    )
  }

  onProgress?.({ current: 0, total: 1, phase: 'auth', detail: 'Authenticating...' })
  const api = new SlackApi(workspace.token)

  // Verify auth and get workspace info
  const authInfo = await api.testAuth()

  // Fetch and cache users
  onProgress?.({ current: 0, total: 1, phase: 'users', detail: 'Fetching users...' })
  const users = await api.listUsers()
  const userMap = new Map(users.map((u) => [u.id, u]))
  saveUsersCache(userMap)

  // Fetch conversations
  onProgress?.({ current: 0, total: 1, phase: 'conversations', detail: 'Fetching conversations...' })
  const conversations = await api.listConversations()

  // Resolve user name helper
  const resolveUserName = (userId: string): string => {
    const user = userMap.get(userId)
    return user?.displayName || user?.realName || user?.name || userId
  }

  // Resolve conversation name
  const resolveConversationName = (conv: typeof conversations[0]): string => {
    if (conv.isIm && conv.userId) {
      return resolveUserName(conv.userId)
    }
    return conv.name
  }

  // Collect all messages
  interface RawSlackMessage {
    ts: string
    user: string
    text: string
    channelId: string
    channelName: string
    threadTs?: string
  }

  const allMessages: RawSlackMessage[] = []

  // Fetch messages from each conversation
  for (let i = 0; i < conversations.length; i++) {
    const conv = conversations[i]
    const channelName = resolveConversationName(conv)
    onProgress?.({
      current: i + 1,
      total: conversations.length,
      phase: 'messages',
      detail: `Fetching #${channelName}...`,
    })

    try {
      const messages = await api.getConversationHistory(conv.id)

      for (const msg of messages) {
        allMessages.push({
          ts: msg.ts,
          user: msg.user,
          text: msg.text,
          channelId: msg.channelId,
          channelName,
          threadTs: msg.threadTs,
        })

        // Fetch thread replies if this is a parent message with replies
        if (msg.replyCount > 0) {
          const replies = await api.getThreadReplies(conv.id, msg.ts)
          for (const reply of replies) {
            allMessages.push({
              ts: reply.ts,
              user: reply.user,
              text: reply.text,
              channelId: reply.channelId,
              channelName,
              threadTs: reply.threadTs,
            })
          }
        }
      }
    } catch {
      // Skip conversations we can't access (e.g., left channels)
    }
  }

  const total = allMessages.length
  onProgress?.({ current: 0, total, phase: 'indexing-fts', detail: 'Building search index...' })

  // Create our index database
  if (existsSync(INDEX_DB_PATH)) {
    unlinkSync(INDEX_DB_PATH)
  }

  const indexDb = new Database(INDEX_DB_PATH)

  // Create FTS5 virtual table
  indexDb.exec(`
    CREATE VIRTUAL TABLE messages_fts USING fts5(
      id,
      text,
      sender,
      chat_name,
      chat_id,
      date,
      is_from_me,
      thread_ts,
      tokenize = 'porter unicode61'
    );
  `)

  // Regular table for context lookups
  indexDb.exec(`
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT UNIQUE NOT NULL,
      text TEXT NOT NULL,
      sender TEXT,
      chat_name TEXT,
      chat_id TEXT,
      date INTEGER NOT NULL,
      is_from_me INTEGER NOT NULL,
      thread_ts TEXT
    );
    CREATE INDEX idx_messages_chat_date ON messages(chat_id, date);
    CREATE INDEX idx_messages_date ON messages(date);
    CREATE INDEX idx_messages_thread ON messages(thread_ts);
  `)

  const insertMessages = indexDb.prepare(`
    INSERT OR IGNORE INTO messages (ts, text, sender, chat_name, chat_id, date, is_from_me, thread_ts)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)

  // Build MiniSearch index for fuzzy matching
  const miniSearch = new MiniSearch<IndexedMessage>({
    fields: ['text', 'sender', 'chatName'],
    storeFields: ['id', 'text', 'sender', 'chatName', 'chatId', 'date', 'isFromMe', 'threadTs'],
    searchOptions: {
      boost: { text: 2, sender: 1.5, chatName: 1 },
      fuzzy: 0.2,
      prefix: true,
    },
  })

  let oldestDate = Infinity
  let newestDate = 0
  const indexedMessages: IndexedMessage[] = []
  const conversationCursors: Record<string, string> = {}

  // Insert messages
  const insertBatch = indexDb.transaction((batch: RawSlackMessage[]) => {
    for (const msg of batch) {
      insertMessages.run(
        msg.ts,
        msg.text,
        resolveUserName(msg.user),
        msg.channelName,
        msg.channelId,
        slackTsToUnix(msg.ts),
        msg.user === authInfo.userId ? 1 : 0,
        msg.threadTs || null
      )
    }
  })

  const BATCH_SIZE = 1000
  let batch: RawSlackMessage[] = []
  let processed = 0

  for (const msg of allMessages) {
    const unixDate = slackTsToUnix(msg.ts)

    if (unixDate < oldestDate) oldestDate = unixDate
    if (unixDate > newestDate) newestDate = unixDate

    // Track latest ts per conversation
    if (!conversationCursors[msg.channelId] || msg.ts > conversationCursors[msg.channelId]) {
      conversationCursors[msg.channelId] = msg.ts
    }

    batch.push(msg)

    if (batch.length >= BATCH_SIZE) {
      insertBatch(batch)
      batch = []
      processed += BATCH_SIZE
      onProgress?.({ current: processed, total, phase: 'indexing-fts' })
    }
  }

  // Insert remaining messages
  if (batch.length > 0) {
    insertBatch(batch)
    processed += batch.length
    onProgress?.({ current: processed, total, phase: 'indexing-fts' })
  }

  // Now read back with auto-generated IDs for MiniSearch
  const allRows = indexDb.prepare(`
    SELECT id, ts, text, sender, chat_name, chat_id, date, is_from_me, thread_ts
    FROM messages ORDER BY date ASC
  `).all() as {
    id: number
    ts: string
    text: string
    sender: string
    chat_name: string
    chat_id: string
    date: number
    is_from_me: number
    thread_ts: string | null
  }[]

  for (const row of allRows) {
    indexedMessages.push({
      id: row.id,
      text: row.text,
      sender: row.sender,
      chatName: row.chat_name,
      chatId: row.chat_id,
      date: row.date,
      isFromMe: row.is_from_me === 1,
      threadTs: row.thread_ts || undefined,
    })
  }

  // Insert into FTS
  const insertFts = indexDb.prepare(`
    INSERT INTO messages_fts (id, text, sender, chat_name, chat_id, date, is_from_me, thread_ts)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const ftsInsertBatch = indexDb.transaction((msgs: IndexedMessage[]) => {
    for (const msg of msgs) {
      insertFts.run(
        msg.id,
        msg.text,
        msg.sender,
        msg.chatName,
        msg.chatId,
        msg.date,
        msg.isFromMe ? 1 : 0,
        msg.threadTs || null
      )
    }
  })

  for (let i = 0; i < indexedMessages.length; i += BATCH_SIZE) {
    ftsInsertBatch(indexedMessages.slice(i, i + BATCH_SIZE))
  }

  indexDb.close()

  // Build fuzzy index
  onProgress?.({ current: 0, total: indexedMessages.length, phase: 'indexing-fuzzy' })

  const MINI_BATCH = 5000
  for (let i = 0; i < indexedMessages.length; i += MINI_BATCH) {
    const slice = indexedMessages.slice(i, i + MINI_BATCH)
    miniSearch.addAll(slice)
    onProgress?.({
      current: Math.min(i + MINI_BATCH, indexedMessages.length),
      total: indexedMessages.length,
      phase: 'indexing-fuzzy',
    })
  }

  // Save fuzzy index
  const serialized = JSON.stringify(miniSearch.toJSON())
  writeFileSync(FUZZY_INDEX_PATH, serialized)

  // Count unique chats and contacts
  const uniqueChats = new Set(indexedMessages.map((m) => m.chatId))
  const uniqueContacts = new Set(indexedMessages.map((m) => m.sender))

  const stats: IndexStats = {
    totalMessages: indexedMessages.length,
    totalChats: uniqueChats.size,
    totalContacts: uniqueContacts.size,
    indexedAt: new Date(),
    oldestMessage: oldestDate === Infinity ? new Date() : new Date(oldestDate * 1000),
    newestMessage: newestDate === 0 ? new Date() : new Date(newestDate * 1000),
    workspaceId: authInfo.teamId,
    workspaceName: authInfo.teamName,
    conversationCursors,
  }

  saveStats(stats)
  onProgress?.({ current: total, total, phase: 'done' })

  return stats
}

// Incremental update - fetch only new messages since last cursor
export async function updateIndex(
  onProgress?: (progress: IndexProgress) => void
): Promise<IndexStats | null> {
  const existingStats = getStats()
  if (!existingStats?.conversationCursors || Object.keys(existingStats.conversationCursors).length === 0) {
    return null
  }

  const workspace = getDefaultWorkspace()
  if (!workspace) {
    throw new Error('No Slack workspace configured.')
  }

  onProgress?.({ current: 0, total: 1, phase: 'auth', detail: 'Authenticating...' })
  const api = new SlackApi(workspace.token)
  const authInfo = await api.testAuth()

  // Load users cache
  const userMap = loadUsersCache()
  const resolveUserName = (userId: string): string => {
    const user = userMap.get(userId)
    return user?.displayName || user?.realName || user?.name || userId
  }

  // Fetch conversations
  onProgress?.({ current: 0, total: 1, phase: 'conversations', detail: 'Fetching conversations...' })
  const conversations = await api.listConversations()

  const resolveConversationName = (conv: typeof conversations[0]): string => {
    if (conv.isIm && conv.userId) {
      return resolveUserName(conv.userId)
    }
    return conv.name
  }

  interface RawSlackMessage {
    ts: string
    user: string
    text: string
    channelId: string
    channelName: string
    threadTs?: string
  }

  const newMessages: RawSlackMessage[] = []
  const updatedCursors = { ...existingStats.conversationCursors }

  for (let i = 0; i < conversations.length; i++) {
    const conv = conversations[i]
    const channelName = resolveConversationName(conv)
    const cursor = existingStats.conversationCursors[conv.id]

    onProgress?.({
      current: i + 1,
      total: conversations.length,
      phase: 'messages',
      detail: `Checking #${channelName}...`,
    })

    try {
      const messages = await api.getConversationHistory(conv.id, cursor)

      for (const msg of messages) {
        newMessages.push({
          ts: msg.ts,
          user: msg.user,
          text: msg.text,
          channelId: msg.channelId,
          channelName,
          threadTs: msg.threadTs,
        })

        if (msg.replyCount > 0) {
          const replies = await api.getThreadReplies(conv.id, msg.ts)
          for (const reply of replies) {
            newMessages.push({
              ts: reply.ts,
              user: reply.user,
              text: reply.text,
              channelId: reply.channelId,
              channelName,
              threadTs: reply.threadTs,
            })
          }
        }

        if (!updatedCursors[conv.id] || msg.ts > updatedCursors[conv.id]) {
          updatedCursors[conv.id] = msg.ts
        }
      }
    } catch {
      // Skip inaccessible conversations
    }
  }

  if (newMessages.length === 0) {
    const updatedStats: IndexStats = {
      ...existingStats,
      indexedAt: new Date(),
      conversationCursors: updatedCursors,
    }
    saveStats(updatedStats)
    onProgress?.({ current: 0, total: 0, phase: 'done' })
    return updatedStats
  }

  const total = newMessages.length
  onProgress?.({ current: 0, total, phase: 'indexing-fts', detail: 'Adding new messages...' })

  // Open existing database
  const indexDb = new Database(INDEX_DB_PATH)

  const insertMessages = indexDb.prepare(`
    INSERT OR IGNORE INTO messages (ts, text, sender, chat_name, chat_id, date, is_from_me, thread_ts)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)

  // Load existing MiniSearch
  const fuzzyData = readFileSync(FUZZY_INDEX_PATH, 'utf-8')
  const miniSearch = MiniSearch.loadJSON<IndexedMessage>(fuzzyData, {
    fields: ['text', 'sender', 'chatName'],
    storeFields: ['id', 'text', 'sender', 'chatName', 'chatId', 'date', 'isFromMe', 'threadTs'],
    searchOptions: {
      boost: { text: 2, sender: 1.5, chatName: 1 },
      fuzzy: 0.2,
      prefix: true,
    },
  })

  let newestDate = existingStats.newestMessage.getTime() / 1000

  const insertBatch = indexDb.transaction((batch: RawSlackMessage[]) => {
    for (const msg of batch) {
      insertMessages.run(
        msg.ts,
        msg.text,
        resolveUserName(msg.user),
        msg.channelName,
        msg.channelId,
        slackTsToUnix(msg.ts),
        msg.user === authInfo.userId ? 1 : 0,
        msg.threadTs || null
      )
    }
  })

  insertBatch(newMessages)

  // Get the newly inserted messages with their IDs
  const tsList = newMessages.map((m) => m.ts)
  const placeholders = tsList.map(() => '?').join(',')
  const newRows = indexDb.prepare(`
    SELECT id, ts, text, sender, chat_name, chat_id, date, is_from_me, thread_ts
    FROM messages WHERE ts IN (${placeholders})
  `).all(...tsList) as {
    id: number
    ts: string
    text: string
    sender: string
    chat_name: string
    chat_id: string
    date: number
    is_from_me: number
    thread_ts: string | null
  }[]

  const newIndexedMessages: IndexedMessage[] = []
  for (const row of newRows) {
    if (row.date > newestDate) newestDate = row.date
    newIndexedMessages.push({
      id: row.id,
      text: row.text,
      sender: row.sender,
      chatName: row.chat_name,
      chatId: row.chat_id,
      date: row.date,
      isFromMe: row.is_from_me === 1,
      threadTs: row.thread_ts || undefined,
    })
  }

  // Insert into FTS
  const insertFts = indexDb.prepare(`
    INSERT INTO messages_fts (id, text, sender, chat_name, chat_id, date, is_from_me, thread_ts)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)

  for (const msg of newIndexedMessages) {
    insertFts.run(
      msg.id,
      msg.text,
      msg.sender,
      msg.chatName,
      msg.chatId,
      msg.date,
      msg.isFromMe ? 1 : 0,
      msg.threadTs || null
    )
  }

  indexDb.close()

  // Add to MiniSearch
  onProgress?.({ current: 0, total: newIndexedMessages.length, phase: 'indexing-fuzzy' })
  miniSearch.addAll(newIndexedMessages)
  onProgress?.({ current: newIndexedMessages.length, total: newIndexedMessages.length, phase: 'indexing-fuzzy' })

  // Save updated fuzzy index
  writeFileSync(FUZZY_INDEX_PATH, JSON.stringify(miniSearch.toJSON()))

  const updatedStats: IndexStats = {
    totalMessages: existingStats.totalMessages + newIndexedMessages.length,
    totalChats: existingStats.totalChats,
    totalContacts: existingStats.totalContacts,
    indexedAt: new Date(),
    oldestMessage: existingStats.oldestMessage,
    newestMessage: new Date(newestDate * 1000),
    workspaceId: existingStats.workspaceId,
    workspaceName: existingStats.workspaceName,
    conversationCursors: updatedCursors,
  }

  saveStats(updatedStats)
  onProgress?.({ current: total, total, phase: 'done' })

  return updatedStats
}
