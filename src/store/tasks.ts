import { produce } from 'solid-js/store';
import { invoke } from '../lib/ipc';
import { IPC } from '../../electron/ipc/channels';
import { store, setStore, cleanupPanelEntries } from './core';
import { setTaskFocusedPanel } from './focus';
import { getProjectPath, isProjectMissing } from './projects';
import { setPendingShellCommand } from '../lib/bookmarks';
import { markAgentSpawned, markAgentBusy, clearAgentActivity, isAgentIdle } from './taskStatus';
import { recordTaskCompleted } from './completion';
import type { AgentDef, CreateTaskResult } from '../ipc/types';
import type { Agent, Task } from './types';

function initTaskInStore(
  taskId: string,
  task: Task,
  agent: Agent,
  projectId: string,
  agentDef: AgentDef | undefined,
): void {
  setStore(
    produce((s) => {
      s.tasks[taskId] = task;
      s.agents[agent.id] = agent;
      s.taskOrder.push(taskId);
      s.activeTaskId = taskId;
      s.activeAgentId = agent.id;
      s.lastProjectId = projectId;
      if (agentDef) s.lastAgentId = agentDef.id;
    }),
  );
  markAgentSpawned(agent.id);
}

const AGENT_WRITE_READY_TIMEOUT_MS = 8_000;
const AGENT_WRITE_RETRY_MS = 50;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAgentNotFoundError(err: unknown): boolean {
  return String(err).toLowerCase().includes('agent not found');
}

async function writeToAgentWhenReady(agentId: string, data: string): Promise<void> {
  const deadline = Date.now() + AGENT_WRITE_READY_TIMEOUT_MS;
  let lastErr: unknown;

  while (Date.now() <= deadline) {
    try {
      await invoke(IPC.WriteToAgent, { agentId, data });
      return;
    } catch (err) {
      lastErr = err;
      if (!isAgentNotFoundError(err)) throw err;
      const agent = store.agents[agentId];
      if (!agent || agent.status !== 'running') throw err;
      await sleep(AGENT_WRITE_RETRY_MS);
    }
  }

  throw lastErr ?? new Error(`Timed out waiting for agent ${agentId} to become writable`);
}

export interface CreateTaskOptions {
  name: string;
  agentDef: AgentDef;
  projectId: string;
  initialPrompt?: string;
  skipPermissions?: boolean;
  dockerMode?: boolean;
  dockerImage?: string;
}

export async function createTask(opts: CreateTaskOptions): Promise<string> {
  const { name, agentDef, projectId, initialPrompt, skipPermissions, dockerMode, dockerImage } =
    opts;
  const projectRoot = getProjectPath(projectId);
  if (!projectRoot) throw new Error('Project not found');
  if (isProjectMissing(projectId)) throw new Error('Project folder not found');

  const result = await invoke<CreateTaskResult>(IPC.CreateTask, { name });
  const taskId = result.id;

  const agentId = crypto.randomUUID();
  const task: Task = {
    id: taskId,
    name,
    projectId,
    agentIds: [agentId],
    shellAgentIds: [],
    notes: '',
    lastPrompt: '',
    initialPrompt: initialPrompt ?? undefined,
    savedInitialPrompt: initialPrompt ?? undefined,
    skipPermissions: skipPermissions ?? undefined,
    dockerMode: dockerMode ?? undefined,
    dockerImage: dockerImage ?? undefined,
  };

  const agent: Agent = {
    id: agentId,
    taskId,
    def: agentDef,
    resumed: false,
    status: 'running',
    exitCode: null,
    signal: null,
    lastOutput: [],
    generation: 0,
  };

  initTaskInStore(taskId, task, agent, projectId, agentDef);
  return taskId;
}

export async function closeTask(taskId: string): Promise<void> {
  const task = store.tasks[taskId];
  if (!task || task.closingStatus === 'closing' || task.closingStatus === 'removing') return;

  const agentIds = [...task.agentIds];
  const shellAgentIds = [...task.shellAgentIds];

  // Mark as closing — task stays visible but UI shows closing state
  setStore('tasks', taskId, 'closingStatus', 'closing');
  setStore('tasks', taskId, 'closingError', undefined);

  // Stop plan file watcher to prevent FSWatcher leak
  invoke(IPC.StopPlanWatcher, { taskId }).catch(console.error);

  try {
    // Kill agents
    for (const agentId of agentIds) {
      await invoke(IPC.KillAgent, { agentId }).catch(console.error);
    }
    for (const shellId of shellAgentIds) {
      await invoke(IPC.KillAgent, { agentId: shellId }).catch(console.error);
    }

    // Notify backend to clean up
    await invoke(IPC.DeleteTask, {
      taskId,
      agentIds: [...agentIds, ...shellAgentIds],
    });

    // Backend cleanup succeeded — remove from UI
    removeTaskFromStore(taskId, [...agentIds, ...shellAgentIds]);
  } catch (err) {
    // Backend cleanup failed — show error, allow retry
    console.error('Failed to close task:', err);
    setStore('tasks', taskId, 'closingStatus', 'error');
    setStore('tasks', taskId, 'closingError', String(err));
  }
}

export async function retryCloseTask(taskId: string): Promise<void> {
  setStore('tasks', taskId, 'closingStatus', undefined);
  setStore('tasks', taskId, 'closingError', undefined);
  await closeTask(taskId);
}

const REMOVE_ANIMATION_MS = 300;

function removeTaskFromStore(taskId: string, agentIds: string[]): void {
  recordTaskCompleted();

  invoke(IPC.StopPlanWatcher, { taskId }).catch(console.error);

  for (const agentId of agentIds) {
    clearAgentActivity(agentId);
  }

  // Phase 1: mark as removing so UI can animate
  setStore('tasks', taskId, 'closingStatus', 'removing');

  // Phase 2: actually delete after animation completes
  setTimeout(() => {
    setStore(
      produce((s) => {
        delete s.tasks[taskId];

        // Compute neighbor BEFORE cleanupPanelEntries removes taskId from taskOrder
        let neighbor: string | null = null;
        if (s.activeTaskId === taskId) {
          const idx = s.taskOrder.indexOf(taskId);
          const filteredOrder = s.taskOrder.filter((id) => id !== taskId);
          const neighborIdx = idx <= 0 ? 0 : idx - 1;
          neighbor = filteredOrder[neighborIdx] ?? null;
        }

        cleanupPanelEntries(s, taskId);

        if (s.activeTaskId === taskId) {
          s.activeTaskId = neighbor;
          const neighborTask = neighbor ? s.tasks[neighbor] : null;
          s.activeAgentId = neighborTask?.agentIds[0] ?? null;
        }

        for (const agentId of agentIds) {
          delete s.agents[agentId];
        }
      }),
    );
  }, REMOVE_ANIMATION_MS);
}

export function updateTaskName(taskId: string, name: string): void {
  setStore('tasks', taskId, 'name', name);
}

export function updateTaskNotes(taskId: string, notes: string): void {
  setStore('tasks', taskId, 'notes', notes);
}

export async function sendPrompt(taskId: string, agentId: string, text: string): Promise<void> {
  await writeToAgentWhenReady(agentId, text);
  await new Promise((r) => setTimeout(r, 50));
  await writeToAgentWhenReady(agentId, '\r');
  setStore('tasks', taskId, 'lastPrompt', text);
}

export function setLastPrompt(taskId: string, text: string): void {
  setStore('tasks', taskId, 'lastPrompt', text);
}

export function clearInitialPrompt(taskId: string): void {
  setStore('tasks', taskId, 'initialPrompt', undefined);
}

export function clearPrefillPrompt(taskId: string): void {
  setStore('tasks', taskId, 'prefillPrompt', undefined);
}

export function setPrefillPrompt(taskId: string, text: string): void {
  setStore('tasks', taskId, 'prefillPrompt', text);
}

export function reorderTask(fromIndex: number, toIndex: number): void {
  if (fromIndex === toIndex) return;
  setStore(
    produce((s) => {
      const len = s.taskOrder.length;
      if (fromIndex < 0 || fromIndex >= len || toIndex < 0 || toIndex >= len) return;
      const [moved] = s.taskOrder.splice(fromIndex, 1);
      s.taskOrder.splice(toIndex, 0, moved);
    }),
  );
}

export function spawnShellForTask(taskId: string, initialCommand?: string): string {
  const shellId = crypto.randomUUID();
  if (initialCommand) setPendingShellCommand(shellId, initialCommand);
  markAgentSpawned(shellId);
  setStore(
    produce((s) => {
      const task = s.tasks[taskId];
      if (!task) return;
      task.shellAgentIds.push(shellId);
    }),
  );
  return shellId;
}

/** Send a bookmark command to an existing idle shell, or spawn a new one. */
export function runBookmarkInTask(taskId: string, command: string): void {
  const task = store.tasks[taskId];
  if (!task) return;

  for (let i = task.shellAgentIds.length - 1; i >= 0; i--) {
    const shellId = task.shellAgentIds[i];
    if (isAgentIdle(shellId)) {
      markAgentBusy(shellId);
      setTaskFocusedPanel(taskId, `shell:${i}`);
      invoke(IPC.WriteToAgent, { agentId: shellId, data: command + '\r' }).catch(() => {
        spawnShellForTask(taskId, command);
      });
      return;
    }
  }

  spawnShellForTask(taskId, command);
}

export async function closeShell(
  taskId: string,
  shellId: string,
  skipFocus = false,
): Promise<void> {
  const closedIndex = store.tasks[taskId]?.shellAgentIds.indexOf(shellId) ?? -1;

  await invoke(IPC.KillAgent, { agentId: shellId }).catch(() => {});
  clearAgentActivity(shellId);
  setStore(
    produce((s) => {
      const task = s.tasks[taskId];
      if (task) {
        task.shellAgentIds = task.shellAgentIds.filter((id) => id !== shellId);
      }
    }),
  );

  if (!skipFocus && closedIndex >= 0) {
    const remaining = store.tasks[taskId]?.shellAgentIds.length ?? 0;
    if (remaining === 0) {
      setTaskFocusedPanel(taskId, 'shell-toolbar:0');
    } else {
      const focusIndex = Math.min(closedIndex, remaining - 1);
      setTaskFocusedPanel(taskId, `shell:${focusIndex}`);
    }
  }
}

export async function collapseTask(taskId: string): Promise<void> {
  const task = store.tasks[taskId];
  if (!task || task.collapsed || task.closingStatus) return;

  invoke(IPC.StopPlanWatcher, { taskId }).catch(console.error);

  const firstAgent = task.agentIds[0] ? store.agents[task.agentIds[0]] : null;
  const agentDef = firstAgent?.def;
  const agentIds = [...task.agentIds];
  const shellAgentIds = [...task.shellAgentIds];

  invoke(IPC.StopPlanWatcher, { taskId }).catch(console.error);
  const allIds = [...agentIds, ...shellAgentIds];
  await Promise.allSettled(
    allIds.map((id) => invoke(IPC.KillAgent, { agentId: id }).catch(console.error)),
  );
  for (const id of allIds) clearAgentActivity(id);

  setStore(
    produce((s) => {
      if (!s.tasks[taskId]) return;
      s.tasks[taskId].collapsed = true;
      s.tasks[taskId].savedAgentDef = agentDef;
      s.tasks[taskId].agentIds = [];
      s.tasks[taskId].shellAgentIds = [];
      const idx = s.taskOrder.indexOf(taskId);
      if (idx !== -1) s.taskOrder.splice(idx, 1);
      s.collapsedTaskOrder.push(taskId);

      for (const agentId of agentIds) {
        delete s.agents[agentId];
      }

      if (s.activeTaskId === taskId) {
        const neighbor = s.taskOrder[Math.max(0, idx - 1)] ?? null;
        s.activeTaskId = neighbor;
        const neighborTask = neighbor ? s.tasks[neighbor] : null;
        s.activeAgentId = neighborTask?.agentIds[0] ?? null;
      }
    }),
  );
}

export function uncollapseTask(taskId: string): void {
  const task = store.tasks[taskId];
  if (!task || !task.collapsed) return;

  const savedDef = task.savedAgentDef;
  const agentId = savedDef ? crypto.randomUUID() : null;

  setStore(
    produce((s) => {
      const t = s.tasks[taskId];
      t.collapsed = false;
      s.collapsedTaskOrder = s.collapsedTaskOrder.filter((id) => id !== taskId);
      s.taskOrder.push(taskId);
      s.activeTaskId = taskId;

      if (agentId && savedDef) {
        const agent: Agent = {
          id: agentId,
          taskId,
          def: savedDef,
          resumed: true,
          status: 'running',
          exitCode: null,
          signal: null,
          lastOutput: [],
          generation: 0,
        };
        s.agents[agentId] = agent;
        t.agentIds = [agentId];
        t.savedAgentDef = undefined;
      }

      s.activeAgentId = t.agentIds[0] ?? null;
    }),
  );

  if (agentId) {
    markAgentSpawned(agentId);
  }
}

export function setNewTaskPrefillPrompt(prompt: string, projectId: string | null): void {
  setStore('newTaskPrefillPrompt', { prompt, projectId });
}

export function setPlanContent(
  taskId: string,
  content: string | null,
  fileName: string | null,
): void {
  setStore('tasks', taskId, 'planContent', content ?? undefined);
  setStore('tasks', taskId, 'planFileName', fileName ?? undefined);
}
