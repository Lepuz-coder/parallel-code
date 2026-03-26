import { randomUUID } from 'crypto';
import { killAgent, notifyAgentListChanged } from './pty.js';
import { stopPlanWatcher } from './plans.js';

export async function createTask(_name: string): Promise<{ id: string }> {
  const id = randomUUID();
  return { id };
}

interface DeleteTaskOpts {
  taskId?: string;
  agentIds: string[];
}

export async function deleteTask(opts: DeleteTaskOpts): Promise<void> {
  if (opts.taskId) stopPlanWatcher(opts.taskId);
  for (const agentId of opts.agentIds) {
    try {
      killAgent(agentId);
    } catch {
      /* already dead */
    }
  }
  notifyAgentListChanged();
}
