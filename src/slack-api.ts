import { WebClient } from '@slack/web-api'
import type { SlackConversation, SlackMessage, SlackUser } from './types.js'

export class SlackApi {
  private client: WebClient

  constructor(token: string) {
    this.client = new WebClient(token, {
      retryConfig: {
        retries: 3,
        factor: 2,
        randomize: true,
      },
    })
  }

  async testAuth(): Promise<{ userId: string; teamId: string; teamName: string }> {
    const result = await this.client.auth.test()
    if (!result.ok) {
      throw new Error('Authentication failed')
    }
    return {
      userId: result.user_id as string,
      teamId: result.team_id as string,
      teamName: result.team as string,
    }
  }

  async listUsers(): Promise<SlackUser[]> {
    const users: SlackUser[] = []
    let cursor: string | undefined

    do {
      const result = await this.client.users.list({ cursor, limit: 200 })
      if (!result.ok || !result.members) {
        throw new Error('Failed to list users')
      }
      for (const member of result.members) {
        if (!member.deleted && !member.is_bot && member.id) {
          users.push({
            id: member.id,
            name: member.name || '',
            realName: member.real_name || member.name || '',
            displayName: member.profile?.display_name || member.real_name || member.name || '',
          })
        }
      }
      cursor = result.response_metadata?.next_cursor
    } while (cursor)

    return users
  }

  async listConversations(): Promise<SlackConversation[]> {
    const conversations: SlackConversation[] = []
    let cursor: string | undefined

    do {
      const result = await this.client.conversations.list({
        cursor,
        limit: 200,
        types: 'public_channel,private_channel,im,mpim',
        exclude_archived: true,
      })
      if (!result.ok || !result.channels) {
        throw new Error('Failed to list conversations')
      }
      for (const channel of result.channels) {
        // Only include channels where user is a member (or DMs which are always accessible)
        const isMember = channel.is_member || channel.is_im || channel.is_mpim
        if (channel.id && isMember) {
          conversations.push({
            id: channel.id,
            name: channel.name || channel.id,
            isChannel: channel.is_channel || false,
            isPrivate: channel.is_private || false,
            isIm: channel.is_im || false,
            isMpim: channel.is_mpim || false,
            userId: channel.user,
          })
        }
      }
      cursor = result.response_metadata?.next_cursor
    } while (cursor)

    return conversations
  }

  async getConversationHistory(
    channelId: string,
    oldest?: string,
    onProgress?: (count: number) => void,
  ): Promise<SlackMessage[]> {
    const messages: SlackMessage[] = []
    let cursor: string | undefined

    do {
      const result = await this.client.conversations.history({
        channel: channelId,
        cursor,
        limit: 200,
        oldest,
      })
      if (!result.ok || !result.messages || result.messages.length === 0) {
        break
      }
      for (const msg of result.messages) {
        // Skip messages without required fields or with system subtypes
        if (msg.type !== 'message' || !msg.ts || !msg.text || !msg.text.trim()) {
          continue
        }
        // Skip system messages like channel_join, channel_leave, etc.
        const skipSubtypes = ['channel_join', 'channel_leave', 'channel_topic', 'channel_purpose', 'bot_add', 'bot_remove']
        if (msg.subtype && skipSubtypes.includes(msg.subtype)) {
          continue
        }
        messages.push({
          ts: msg.ts,
          user: msg.user || '',
          text: msg.text,
          channelId,
          threadTs: msg.thread_ts,
          replyCount: msg.reply_count || 0,
        })
      }
      onProgress?.(messages.length)
      cursor = result.response_metadata?.next_cursor
    } while (cursor)

    return messages
  }

  async getThreadReplies(channelId: string, threadTs: string): Promise<SlackMessage[]> {
    const replies: SlackMessage[] = []
    let cursor: string | undefined

    do {
      const result = await this.client.conversations.replies({
        channel: channelId,
        ts: threadTs,
        cursor,
        limit: 200,
      })
      if (!result.ok || !result.messages) {
        break
      }
      for (const msg of result.messages) {
        if (msg.ts !== threadTs && msg.type === 'message' && msg.ts) {
          replies.push({
            ts: msg.ts,
            user: msg.user || '',
            text: msg.text || '',
            channelId,
            threadTs,
            replyCount: 0,
          })
        }
      }
      cursor = result.response_metadata?.next_cursor
    } while (cursor)

    return replies
  }
}
