import type { AgentDef } from '../ipc/types';
import type { LookPreset } from '../lib/look';

export interface TerminalBookmark {
  id: string;
  command: string;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  color: string;
  terminalBookmarks?: TerminalBookmark[];
}

export interface Agent {
  id: string;
  taskId: string;
  def: AgentDef;
  resumed: boolean;
  status: 'running' | 'exited';
  exitCode: number | null;
  signal: string | null;
  lastOutput: string[];
  generation: number;
}

export interface Task {
  id: string;
  name: string;
  projectId: string;
  agentIds: string[];
  shellAgentIds: string[];
  notes: string;
  lastPrompt: string;
  initialPrompt?: string;
  savedInitialPrompt?: string;
  prefillPrompt?: string;
  closingStatus?: 'closing' | 'removing' | 'error';
  closingError?: string;
  skipPermissions?: boolean;
  dockerMode?: boolean;
  dockerImage?: string;
  collapsed?: boolean;
  savedAgentDef?: AgentDef;
  planContent?: string;
  planFileName?: string;
}

export interface Terminal {
  id: string;
  name: string;
  agentId: string;
  closingStatus?: 'closing' | 'removing';
}

export interface PersistedTask {
  id: string;
  name: string;
  projectId: string;
  notes: string;
  lastPrompt: string;
  shellCount: number;
  agentDef: AgentDef | null;
  skipPermissions?: boolean;
  dockerMode?: boolean;
  dockerImage?: string;
  savedInitialPrompt?: string;
  collapsed?: boolean;
  planFileName?: string;
}

export interface PersistedTerminal {
  id: string;
  name: string;
}

export interface PersistedWindowState {
  x: number;
  y: number;
  width: number;
  height: number;
  maximized: boolean;
}

export interface PersistedState {
  projects: Project[];
  lastProjectId: string | null;
  lastAgentId: string | null;
  taskOrder: string[];
  collapsedTaskOrder?: string[];
  tasks: Record<string, PersistedTask>;
  terminals?: Record<string, PersistedTerminal>;
  activeTaskId: string | null;
  sidebarVisible: boolean;
  fontScales?: Record<string, number>;
  panelSizes?: Record<string, number>;
  globalScale?: number;
  completedTaskDate?: string;
  completedTaskCount?: number;
  terminalFont?: string;
  themePreset?: LookPreset;
  windowState?: PersistedWindowState;
  autoTrustFolders?: boolean;
  showPlans?: boolean;
  desktopNotificationsEnabled?: boolean;
  inactiveColumnOpacity?: number;
  editorCommand?: string;
  dockerImage?: string;
  customAgents?: AgentDef[];
}

// Panel cell IDs. Shell terminals use "shell:0", "shell:1", etc.
// Shell toolbar buttons use "shell-toolbar:0", "shell-toolbar:1", etc.
export type PanelId = string;

export interface PendingAction {
  type: 'close';
  taskId: string;
}

export interface RemoteAccess {
  enabled: boolean;
  token: string | null;
  port: number;
  url: string | null;
  wifiUrl: string | null;
  tailscaleUrl: string | null;
  connectedClients: number;
}

export interface AppStore {
  projects: Project[];
  lastProjectId: string | null;
  lastAgentId: string | null;
  taskOrder: string[];
  collapsedTaskOrder: string[];
  tasks: Record<string, Task>;
  terminals: Record<string, Terminal>;
  agents: Record<string, Agent>;
  activeTaskId: string | null;
  activeAgentId: string | null;
  availableAgents: AgentDef[];
  customAgents: AgentDef[];
  showNewTaskDialog: boolean;
  sidebarVisible: boolean;
  fontScales: Record<string, number>;
  panelSizes: Record<string, number>;
  globalScale: number;
  focusedPanel: Record<string, PanelId>;
  sidebarFocused: boolean;
  sidebarFocusedProjectId: string | null;
  sidebarFocusedTaskId: string | null;
  placeholderFocused: boolean;
  placeholderFocusedButton: 'add-task' | 'add-terminal';
  showHelpDialog: boolean;
  showSettingsDialog: boolean;
  pendingAction: PendingAction | null;
  notification: string | null;
  completedTaskDate: string;
  completedTaskCount: number;
  terminalFont: string;
  themePreset: LookPreset;
  windowState: PersistedWindowState | null;
  autoTrustFolders: boolean;
  showPlans: boolean;
  desktopNotificationsEnabled: boolean;
  inactiveColumnOpacity: number;
  editorCommand: string;
  dockerImage: string;
  dockerAvailable: boolean;
  newTaskPrefillPrompt: { prompt: string; projectId: string | null } | null;
  missingProjectIds: Record<string, true>;
  remoteAccess: RemoteAccess;
}
