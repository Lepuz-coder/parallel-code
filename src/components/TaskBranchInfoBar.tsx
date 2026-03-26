import { Show, type JSX } from 'solid-js';
import { store, getProject, showNotification } from '../store/store';
import { revealItemInDir, openInEditor } from '../lib/shell';
import { InfoBar } from './InfoBar';
import { isMac } from '../lib/platform';
import type { Task } from '../store/types';

const infoBarBtnStyle: JSX.CSSProperties = {
  display: 'inline-flex',
  'align-items': 'center',
  gap: '4px',
  'align-self': 'stretch',
  background: 'transparent',
  border: 'none',
  padding: '0 4px',
  color: 'inherit',
  cursor: 'pointer',
  'font-family': 'inherit',
  'font-size': 'inherit',
};

interface TaskBranchInfoBarProps {
  task: Task;
  onEditProject: (projectId: string) => void;
}

export function TaskBranchInfoBar(props: TaskBranchInfoBarProps) {
  const projectPath = () => getProject(props.task.projectId)?.path ?? '';

  const editorTitle = () =>
    store.editorCommand
      ? `Click to open in ${store.editorCommand} · ${isMac ? 'Cmd' : 'Ctrl'}+Click to reveal in file manager`
      : 'Click to reveal in file manager';

  const handleOpenInEditor = (e: MouseEvent) => {
    const path = projectPath();
    if (!path) return;
    if (store.editorCommand && !e.ctrlKey && !e.metaKey) {
      openInEditor(store.editorCommand, path).catch((err) =>
        showNotification(`Editor failed: ${err instanceof Error ? err.message : 'unknown error'}`),
      );
    } else {
      revealItemInDir(path).catch((err) =>
        showNotification(
          `Could not open folder: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    }
  };

  return (
    <InfoBar>
      {(() => {
        const project = getProject(props.task.projectId);
        return (
          <Show when={project}>
            {(p) => (
              <button
                type="button"
                onClick={() => props.onEditProject(p().id)}
                title="Project settings"
                style={{ ...infoBarBtnStyle, margin: '0 8px 0 0' }}
              >
                <div
                  style={{
                    width: '7px',
                    height: '7px',
                    'border-radius': '50%',
                    background: p().color,
                    'flex-shrink': '0',
                  }}
                />
                {p().name}
              </button>
            )}
          </Show>
        );
      })()}
      <button
        type="button"
        title={editorTitle()}
        onClick={handleOpenInEditor}
        style={{ ...infoBarBtnStyle, opacity: 0.6 }}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 16 16"
          fill="currentColor"
          style={{ 'flex-shrink': '0' }}
        >
          <path d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1H1.75Z" />
        </svg>
        {projectPath()}
      </button>
    </InfoBar>
  );
}
