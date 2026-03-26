import { Show, type JSX } from 'solid-js';
import {
  store,
  reorderTask,
  setActiveTask,
  updateTaskName,
  collapseTask,
  getTaskDotStatus,
} from '../store/store';
import { EditableText, type EditableTextHandle } from './EditableText';
import { IconButton } from './IconButton';
import { StatusDot } from './StatusDot';
import { theme } from '../lib/theme';
import { handleDragReorder } from '../lib/dragReorder';
import type { Task } from '../store/types';

const badgeStyle = (color: string): JSX.CSSProperties => ({
  'font-size': '11px',
  'font-weight': '600',
  padding: '2px 8px',
  'border-radius': '4px',
  background: `color-mix(in srgb, ${color} 15%, transparent)`,
  color: color,
  border: `1px solid color-mix(in srgb, ${color} 25%, transparent)`,
  'flex-shrink': '0',
  'white-space': 'nowrap',
});

interface TaskTitleBarProps {
  task: Task;
  isActive: boolean;
  onClose: () => void;
  onTitleEditRef: (h: EditableTextHandle) => void;
}

export function TaskTitleBar(props: TaskTitleBarProps) {
  function handleTitleMouseDown(e: MouseEvent) {
    handleDragReorder(e, {
      itemId: props.task.id,
      getTaskOrder: () => store.taskOrder,
      onReorder: reorderTask,
      onTap: () => setActiveTask(props.task.id),
    });
  }

  return (
    <div
      class={props.isActive ? 'island-header-active' : ''}
      style={{
        display: 'flex',
        'align-items': 'center',
        'justify-content': 'space-between',
        padding: '0 10px',
        height: '100%',
        background: 'transparent',
        'border-bottom': `1px solid ${theme.border}`,
        'user-select': 'none',
        cursor: 'grab',
      }}
      onMouseDown={handleTitleMouseDown}
    >
      <div
        style={{
          overflow: 'hidden',
          flex: '1',
          'min-width': '0',
          display: 'flex',
          'align-items': 'center',
          gap: '8px',
        }}
      >
        <StatusDot status={getTaskDotStatus(props.task.id)} size="md" />
        <Show when={props.task.dockerMode}>
          <span style={badgeStyle(theme.fgMuted)}>Docker</span>
        </Show>
        <EditableText
          value={props.task.name}
          onCommit={(v) => updateTaskName(props.task.id, v)}
          class="editable-text"
          title={props.task.savedInitialPrompt}
          ref={(h) => props.onTitleEditRef(h)}
        />
      </div>
      <div style={{ display: 'flex', gap: '4px', 'margin-left': '8px', 'flex-shrink': '0' }}>
        <IconButton
          icon={
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M2 8a.75.75 0 0 1 .75-.75h10.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 8Z" />
            </svg>
          }
          onClick={() => collapseTask(props.task.id)}
          title="Collapse task"
        />
        <IconButton
          icon={
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
            </svg>
          }
          onClick={() => props.onClose()}
          title="Close task"
        />
      </div>
    </div>
  );
}
