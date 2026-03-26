import { createSignal, createEffect, onMount, onCleanup } from 'solid-js';
import {
  store,
  retryCloseTask,
  setActiveTask,
  clearInitialPrompt,
  clearPrefillPrompt,
  getProject,
  setTaskFocusedPanel,
  triggerFocus,
  clearPendingAction,
} from '../store/store';
import { useFocusRegistration } from '../lib/focus-registration';
import { ResizablePanel, type PanelChild } from './ResizablePanel';
import type { EditableTextHandle } from './EditableText';
import { PromptInput, type PromptInputHandle } from './PromptInput';
import { ScalablePanel } from './ScalablePanel';
import { CloseTaskDialog } from './CloseTaskDialog';
import { PlanViewerDialog } from './PlanViewerDialog';
import { EditProjectDialog } from './EditProjectDialog';
import { TaskTitleBar } from './TaskTitleBar';
import { TaskBranchInfoBar } from './TaskBranchInfoBar';
import { TaskNotesPanel } from './TaskNotesPanel';
import { TaskAITerminal } from './TaskAITerminal';
import { TaskTerminalSection } from './TaskTerminalSection';
import { TaskClosingOverlay } from './TaskClosingOverlay';
import { theme } from '../lib/theme';
import type { Task } from '../store/types';

interface TaskPanelProps {
  task: Task;
  isActive: boolean;
}

export function TaskPanel(props: TaskPanelProps) {
  const [showCloseConfirm, setShowCloseConfirm] = createSignal(false);
  const [planFullscreen, setPlanFullscreen] = createSignal(false);
  const [editingProjectId, setEditingProjectId] = createSignal<string | null>(null);
  let panelRef!: HTMLDivElement;
  let promptRef: HTMLTextAreaElement | undefined;
  let titleEditHandle: EditableTextHandle | undefined;
  let promptHandle: PromptInputHandle | undefined;

  const editingProject = () => {
    const id = editingProjectId();
    return id ? (getProject(id) ?? null) : null;
  };

  onMount(() => {
    const id = props.task.id;
    useFocusRegistration(`${id}:title`, () => titleEditHandle?.startEdit());
    useFocusRegistration(`${id}:prompt`, () => promptRef?.focus());
  });

  createEffect(() => {
    if (!props.isActive) return;
    const panel = store.focusedPanel[props.task.id];
    if (panel) {
      triggerFocus(`${props.task.id}:${panel}`);
    }
  });

  let autoFocusTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => {
    if (autoFocusTimer !== undefined) clearTimeout(autoFocusTimer);
  });
  createEffect(() => {
    if (props.isActive && !store.focusedPanel[props.task.id]) {
      const id = props.task.id;
      if (autoFocusTimer !== undefined) clearTimeout(autoFocusTimer);
      autoFocusTimer = setTimeout(() => {
        autoFocusTimer = undefined;
        if (!store.focusedPanel[id] && !panelRef.contains(document.activeElement)) {
          promptRef?.focus();
        }
      }, 0);
    }
  });

  createEffect(() => {
    const action = store.pendingAction;
    if (!action || action.taskId !== props.task.id) return;
    clearPendingAction();
    if (action.type === 'close') {
      setShowCloseConfirm(true);
    }
  });

  const firstAgentId = () => props.task.agentIds[0] ?? '';

  function titleBar(): PanelChild {
    return {
      id: 'title',
      initialSize: 50,
      fixed: true,
      content: () => (
        <TaskTitleBar
          task={props.task}
          isActive={props.isActive}
          onClose={() => setShowCloseConfirm(true)}
          onTitleEditRef={(h) => (titleEditHandle = h)}
        />
      ),
    };
  }

  function branchInfoBar(): PanelChild {
    return {
      id: 'branch',
      initialSize: 28,
      fixed: true,
      content: () => (
        <TaskBranchInfoBar task={props.task} onEditProject={(id) => setEditingProjectId(id)} />
      ),
    };
  }

  function notesPanel(): PanelChild {
    return {
      id: 'notes-files',
      initialSize: 150,
      minSize: 60,
      content: () => (
        <TaskNotesPanel
          task={props.task}
          isActive={props.isActive}
          onPlanFullscreen={() => setPlanFullscreen(true)}
        />
      ),
    };
  }

  function aiTerminal(): PanelChild {
    return {
      id: 'ai-terminal',
      minSize: 80,
      content: () => (
        <TaskAITerminal task={props.task} isActive={props.isActive} promptHandle={promptHandle} />
      ),
    };
  }

  function promptInput(): PanelChild {
    return {
      id: 'prompt',
      initialSize: 72,
      stable: true,
      minSize: 54,
      maxSize: 300,
      content: () => (
        <ScalablePanel panelId={`${props.task.id}:prompt`}>
          <div
            onClick={() => setTaskFocusedPanel(props.task.id, 'prompt')}
            style={{ height: '100%' }}
          >
            <PromptInput
              taskId={props.task.id}
              agentId={firstAgentId()}
              initialPrompt={props.task.initialPrompt}
              prefillPrompt={props.task.prefillPrompt}
              onSend={() => {
                if (props.task.initialPrompt) clearInitialPrompt(props.task.id);
              }}
              onPrefillConsumed={() => clearPrefillPrompt(props.task.id)}
              ref={(el) => (promptRef = el)}
              handle={(h) => (promptHandle = h)}
            />
          </div>
        </ScalablePanel>
      ),
    };
  }

  function terminalSection(): PanelChild {
    return {
      id: 'terminal-section',
      initialSize: 32,
      minSize: 32,
      get fixed() {
        return props.task.shellAgentIds.length === 0;
      },
      requestSize: () => (props.task.shellAgentIds.length > 0 ? 250 : 32),
      content: () => <TaskTerminalSection task={props.task} isActive={props.isActive} />,
    };
  }

  const projectPath = () => getProject(props.task.projectId)?.path ?? '';

  return (
    <div
      ref={panelRef}
      class={`task-column ${props.isActive ? 'active' : ''}`}
      style={{
        display: 'flex',
        'flex-direction': 'column',
        height: '100%',
        background: theme.taskContainerBg,
        'border-radius': '12px',
        border: `1px solid ${theme.border}`,
        overflow: 'clip',
        position: 'relative',
      }}
      onClick={() => setActiveTask(props.task.id)}
    >
      <TaskClosingOverlay
        closingStatus={props.task.closingStatus}
        closingError={props.task.closingError}
        onRetry={() => retryCloseTask(props.task.id)}
      />
      <ResizablePanel
        direction="vertical"
        persistKey={`task:${props.task.id}`}
        children={[
          titleBar(),
          branchInfoBar(),
          notesPanel(),
          aiTerminal(),
          promptInput(),
          terminalSection(),
        ]}
      />
      <CloseTaskDialog
        open={showCloseConfirm()}
        task={props.task}
        onDone={() => setShowCloseConfirm(false)}
      />
      <EditProjectDialog project={editingProject()} onClose={() => setEditingProjectId(null)} />
      <PlanViewerDialog
        open={planFullscreen()}
        onClose={() => setPlanFullscreen(false)}
        planContent={props.task.planContent ?? ''}
        planFileName={props.task.planFileName ?? 'plan.md'}
        taskId={props.task.id}
        agentId={props.task.agentIds[0]}
        worktreePath={projectPath()}
      />
    </div>
  );
}
