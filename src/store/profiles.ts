import { produce } from 'solid-js/store';
import { store, setStore } from './core';
import { closeTask } from './tasks';
import { closeTerminal, createTerminal } from './terminals';
import { createTask } from './tasks';
import { showNotification } from './notification';
import type { Profile, ProfileTask, ProfileTerminal } from './types';

export function saveCurrentAsProfile(name: string): void {
  const tasks: ProfileTask[] = [];
  const terminals: ProfileTerminal[] = [];

  for (const id of store.taskOrder) {
    const task = store.tasks[id];
    if (task) {
      const firstAgent = task.agentIds[0] ? store.agents[task.agentIds[0]] : null;
      const agentDefId = firstAgent?.def.id ?? '';
      if (agentDefId) {
        tasks.push({ name: task.name, projectId: task.projectId, agentDefId });
      }
      continue;
    }
    const terminal = store.terminals[id];
    if (terminal) {
      terminals.push({ name: terminal.name });
    }
  }

  const profile: Profile = {
    id: crypto.randomUUID(),
    name,
    tasks,
    terminals,
  };

  setStore('profiles', store.profiles.length, profile);
}

export async function loadProfile(profileId: string): Promise<void> {
  const profile = store.profiles.find((p) => p.id === profileId);
  if (!profile) return;

  // Close all existing tasks and terminals
  const closePromises: Promise<void>[] = [];
  for (const id of [...store.taskOrder]) {
    if (store.tasks[id]) {
      closePromises.push(closeTask(id));
    } else if (store.terminals[id]) {
      closePromises.push(closeTerminal(id));
    }
  }
  for (const id of [...store.collapsedTaskOrder]) {
    if (store.tasks[id]) {
      closePromises.push(closeTask(id));
    }
  }
  await Promise.allSettled(closePromises);

  // Wait for close animations to finish
  await new Promise((r) => setTimeout(r, 400));

  // Create tasks from profile
  let skipped = 0;
  for (const pt of profile.tasks) {
    const agentDef = store.availableAgents.find((a) => a.id === pt.agentDefId);
    if (!agentDef) {
      skipped++;
      continue;
    }
    const project = store.projects.find((p) => p.id === pt.projectId);
    if (!project) {
      skipped++;
      continue;
    }
    try {
      await createTask({ name: pt.name, agentDef, projectId: pt.projectId });
    } catch {
      skipped++;
    }
  }

  // Create terminals from profile
  for (const _pt of profile.terminals) {
    createTerminal();
  }

  if (skipped > 0) {
    showNotification(`${skipped} task(s) skipped (missing project or agent)`);
  }
}

export function deleteProfile(profileId: string): void {
  setStore(
    produce((s) => {
      s.profiles = s.profiles.filter((p) => p.id !== profileId);
    }),
  );
}

export function renameProfile(profileId: string, name: string): void {
  const idx = store.profiles.findIndex((p) => p.id === profileId);
  if (idx === -1) return;
  setStore('profiles', idx, 'name', name);
}

export function toggleSaveProfileDialog(open: boolean): void {
  setStore('showSaveProfileDialog', open);
}
