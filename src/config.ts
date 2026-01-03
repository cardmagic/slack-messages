import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface WorkspaceConfig {
  id: string
  name: string
  token: string
}

export interface Config {
  workspaces: WorkspaceConfig[]
}

const CONFIG_DIR = join(homedir(), '.slack-messages')
const CONFIG_FILE = join(CONFIG_DIR, 'config.json')

export function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true })
  }
}

export function getConfigDir(): string {
  return CONFIG_DIR
}

export function loadConfig(): Config {
  ensureConfigDir()
  if (!existsSync(CONFIG_FILE)) {
    return { workspaces: [] }
  }
  const data = readFileSync(CONFIG_FILE, 'utf-8')
  return JSON.parse(data) as Config
}

export function saveConfig(config: Config): void {
  ensureConfigDir()
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2))
}

export function addWorkspace(workspace: WorkspaceConfig): void {
  const config = loadConfig()
  const existingIndex = config.workspaces.findIndex(w => w.id === workspace.id)
  if (existingIndex >= 0) {
    config.workspaces[existingIndex] = workspace
  } else {
    config.workspaces.push(workspace)
  }
  saveConfig(config)
}

export function removeWorkspace(workspaceId: string): boolean {
  const config = loadConfig()
  const initialLength = config.workspaces.length
  config.workspaces = config.workspaces.filter(w => w.id !== workspaceId)
  if (config.workspaces.length < initialLength) {
    saveConfig(config)
    return true
  }
  return false
}

export function getWorkspace(workspaceId: string): WorkspaceConfig | undefined {
  const config = loadConfig()
  return config.workspaces.find(w => w.id === workspaceId)
}

export function getDefaultWorkspace(): WorkspaceConfig | undefined {
  const config = loadConfig()
  return config.workspaces[0]
}

export function listWorkspaces(): WorkspaceConfig[] {
  const config = loadConfig()
  return config.workspaces
}
