import { Show, For, createSignal, createEffect, onCleanup } from 'solid-js';
import { createStore } from 'solid-js/store';
import {
  store,
  getProject,
  spawnShellForTask,
  runBookmarkInTask,
  closeShell,
  markAgentOutput,
  getFontScale,
  registerFocusFn,
  unregisterFocusFn,
  setTaskFocusedPanel,
} from '../store/store';
import { ScalablePanel } from './ScalablePanel';
import { TerminalView } from './TerminalView';
import { theme } from '../lib/theme';
import { sf } from '../lib/fontScale';
import { mod } from '../lib/platform';
import { extractLabel, consumePendingShellCommand } from '../lib/bookmarks';
import type { Task } from '../store/types';

interface TaskTerminalSectionProps {
  task: Task;
  isActive: boolean;
}

export function TaskTerminalSection(props: TaskTerminalSectionProps) {
  const [activeShellId, setActiveShellId] = createSignal<string | null>(null);
  const [splitShellId, setSplitShellId] = createSignal<string | null>(null);
  const [collapsed, setCollapsed] = createSignal(true);
  const [shellToolbarIdx, setShellToolbarIdx] = createSignal(0);
  const [shellToolbarFocused, setShellToolbarFocused] = createSignal(false);
  const [shellExits, setShellExits] = createStore<
    Record<string, { exitCode: number | null; signal: string | null }>
  >({});
  let tabBarEl: HTMLDivElement | undefined;

  const projectBookmarks = () => getProject(props.task.projectId)?.terminalBookmarks ?? [];

  // Auto-manage active shell and collapse state
  createEffect(() => {
    const shells = props.task.shellAgentIds;
    if (shells.length === 0) {
      setActiveShellId(null);
      setSplitShellId(null);
      setCollapsed(true);
      return;
    }
    // Auto-expand when shells exist
    setCollapsed(false);
    // Auto-set active shell if none or if active was removed
    const active = activeShellId();
    if (!active || !shells.includes(active)) {
      setActiveShellId(shells[shells.length - 1]);
    }
    // Clean up split if it was removed
    const split = splitShellId();
    if (split && !shells.includes(split)) {
      setSplitShellId(null);
    }
  });

  // Register focus functions for shell-toolbar and shells
  createEffect(() => {
    const id = props.task.id;
    const bmCount = projectBookmarks().length;
    // toolbar buttons: [+] [split] [bookmark1] [bookmark2] ...
    const toolbarCount = 2 + bmCount;
    if (shellToolbarIdx() >= toolbarCount) {
      setShellToolbarIdx(toolbarCount - 1);
    }
    for (let n = 0; n < toolbarCount; n++) {
      const idx = n;
      registerFocusFn(`${id}:shell-toolbar:${idx}`, () => {
        setShellToolbarIdx(idx);
        tabBarEl?.focus();
      });
    }
    onCleanup(() => {
      for (let i = 0; i < toolbarCount; i++) {
        unregisterFocusFn(`${id}:shell-toolbar:${i}`);
      }
    });
  });

  function handleSpawnShell(): void {
    spawnShellForTask(props.task.id);
  }

  function handleSpawnSplit(): void {
    const newId = spawnShellForTask(props.task.id);
    if (newId) setSplitShellId(newId);
  }

  function handleCloseShell(shellId: string): void {
    closeShell(props.task.id, shellId);
    // If we closed the split shell, clear it
    if (splitShellId() === shellId) {
      setSplitShellId(null);
    }
  }

  function handleTabClick(shellId: string): void {
    // If clicking the split shell's tab, make it the main active
    if (splitShellId() === shellId) {
      setSplitShellId(null);
    }
    setActiveShellId(shellId);
  }

  function shellLabel(shellId: string, index: number): string {
    // Check if this shell was spawned from a bookmark
    const label = extractLabel(shellId);
    if (label && label !== shellId) return label;
    return `Shell ${index + 1}`;
  }

  // Render a single terminal pane
  function TerminalPane(paneProps: { shellId: string; shellIndex: number }) {
    // eslint-disable-next-line solid/reactivity -- one-time consumption at mount, intentionally untracked
    const initialCommand = consumePendingShellCommand(paneProps.shellId);
    let shellFocusFn: (() => void) | undefined;
    let registeredKey: string | undefined;

    createEffect(() => {
      const key = `${props.task.id}:shell:${paneProps.shellIndex}`;
      if (registeredKey && registeredKey !== key) unregisterFocusFn(registeredKey);
      if (shellFocusFn) registerFocusFn(key, shellFocusFn);
      registeredKey = key;
    });
    onCleanup(() => {
      if (registeredKey) unregisterFocusFn(registeredKey);
    });

    const isFocused = () => store.focusedPanel[props.task.id] === `shell:${paneProps.shellIndex}`;

    return (
      <div
        class="focusable-panel shell-terminal-container"
        data-shell-focused={isFocused() ? 'true' : 'false'}
        style={{
          flex: '1',
          height: '100%',
          overflow: 'hidden',
          position: 'relative',
          background: theme.taskPanelBg,
          'min-width': '0',
        }}
        onClick={() => setTaskFocusedPanel(props.task.id, `shell:${paneProps.shellIndex}`)}
      >
        <Show when={shellExits[paneProps.shellId]}>
          <div
            class="exit-badge"
            style={{
              position: 'absolute',
              top: '8px',
              right: '12px',
              'z-index': '10',
              'font-size': sf(11),
              color: shellExits[paneProps.shellId]?.exitCode === 0 ? theme.success : theme.error,
              background: 'color-mix(in srgb, var(--island-bg) 80%, transparent)',
              padding: '4px 12px',
              'border-radius': '8px',
              border: `1px solid ${theme.border}`,
            }}
          >
            Process exited ({shellExits[paneProps.shellId]?.exitCode ?? '?'})
          </div>
        </Show>
        <TerminalView
          taskId={props.task.id}
          agentId={paneProps.shellId}
          isShell
          isFocused={
            props.isActive && store.focusedPanel[props.task.id] === `shell:${paneProps.shellIndex}`
          }
          command={''}
          args={['-l']}
          cwd={getProject(props.task.projectId)?.path ?? ''}
          dockerMode={props.task.dockerMode}
          dockerImage={props.task.dockerImage}
          initialCommand={initialCommand}
          onData={(data) => markAgentOutput(paneProps.shellId, data, props.task.id)}
          onExit={(info) =>
            setShellExits(paneProps.shellId, {
              exitCode: info.exit_code,
              signal: info.signal,
            })
          }
          onReady={(focusFn) => {
            shellFocusFn = focusFn;
            if (registeredKey) registerFocusFn(registeredKey, focusFn);
          }}
          fontSize={Math.round(11 * getFontScale(`${props.task.id}:shell`))}
          autoFocus
        />
      </div>
    );
  }

  return (
    <ScalablePanel panelId={`${props.task.id}:shell`}>
      <div
        style={{
          height: '100%',
          display: 'flex',
          'flex-direction': 'column',
          background: 'transparent',
        }}
      >
        {/* Tab bar */}
        <div
          ref={(el) => {
            tabBarEl = el;
          }}
          class="focusable-panel shell-toolbar-panel"
          tabIndex={0}
          onClick={() => setTaskFocusedPanel(props.task.id, `shell-toolbar:${shellToolbarIdx()}`)}
          onFocus={() => setShellToolbarFocused(true)}
          onBlur={() => setShellToolbarFocused(false)}
          onKeyDown={(e) => {
            if (e.altKey) return;
            const toolbarCount = 2 + projectBookmarks().length;
            if (e.key === 'ArrowRight') {
              e.preventDefault();
              const next = Math.min(toolbarCount - 1, shellToolbarIdx() + 1);
              setShellToolbarIdx(next);
              setTaskFocusedPanel(props.task.id, `shell-toolbar:${next}`);
            } else if (e.key === 'ArrowLeft') {
              e.preventDefault();
              const next = Math.max(0, shellToolbarIdx() - 1);
              setShellToolbarIdx(next);
              setTaskFocusedPanel(props.task.id, `shell-toolbar:${next}`);
            } else if (e.key === 'Enter') {
              e.preventDefault();
              const idx = shellToolbarIdx();
              if (idx === 0) handleSpawnShell();
              else if (idx === 1) handleSpawnSplit();
              else {
                const bm = projectBookmarks()[idx - 2];
                if (bm) runBookmarkInTask(props.task.id, bm.command);
              }
            }
          }}
          style={{
            height: '32px',
            'min-height': '32px',
            display: 'flex',
            'align-items': 'center',
            padding: '0 4px',
            background: 'transparent',
            gap: '0',
            outline: 'none',
            'border-bottom': `1px solid ${theme.border}`,
            overflow: 'hidden',
          }}
        >
          {/* Collapse/expand chevron */}
          <button
            class="icon-btn"
            onClick={(e) => {
              e.stopPropagation();
              if (props.task.shellAgentIds.length > 0) setCollapsed((c) => !c);
            }}
            tabIndex={-1}
            title={collapsed() ? 'Expand terminals' : 'Collapse terminals'}
            style={{
              background: 'transparent',
              border: 'none',
              color: theme.fgSubtle,
              cursor: 'pointer',
              padding: '4px',
              display: 'flex',
              'align-items': 'center',
              'flex-shrink': '0',
              transform: collapsed() ? 'rotate(-90deg)' : 'rotate(0deg)',
              transition: 'transform 0.15s',
            }}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
              <path d="M12.78 6.22a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L3.22 7.28a.75.75 0 0 1 1.06-1.06L8 9.94l3.72-3.72a.75.75 0 0 1 1.06 0Z" />
            </svg>
          </button>

          {/* Terminal tabs */}
          <div
            style={{
              display: 'flex',
              'align-items': 'center',
              flex: '1',
              'min-width': '0',
              overflow: 'hidden',
              gap: '0',
            }}
          >
            <For each={props.task.shellAgentIds}>
              {(shellId, i) => {
                const isActive = () => activeShellId() === shellId || splitShellId() === shellId;
                const isSplit = () => splitShellId() === shellId;
                return (
                  <div
                    onClick={(e) => {
                      e.stopPropagation();
                      handleTabClick(shellId);
                    }}
                    style={{
                      display: 'flex',
                      'align-items': 'center',
                      gap: '4px',
                      padding: '4px 8px',
                      cursor: 'pointer',
                      'font-size': sf(11),
                      color: isActive() ? theme.fg : theme.fgMuted,
                      'border-bottom': isActive()
                        ? `2px solid ${theme.accent}`
                        : '2px solid transparent',
                      'white-space': 'nowrap',
                      'flex-shrink': '0',
                      background: isActive()
                        ? `color-mix(in srgb, ${theme.accent} 8%, transparent)`
                        : 'transparent',
                    }}
                    onMouseEnter={(e) => {
                      if (!isActive())
                        (e.currentTarget as HTMLElement).style.background = theme.bgHover;
                    }}
                    onMouseLeave={(e) => {
                      if (!isActive())
                        (e.currentTarget as HTMLElement).style.background = 'transparent';
                    }}
                  >
                    <span style={{ 'font-family': 'monospace', 'font-size': sf(10) }}>&gt;_</span>
                    <span>
                      {shellLabel(shellId, i())}
                      {isSplit() ? ' (split)' : ''}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCloseShell(shellId);
                      }}
                      title="Close terminal"
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: theme.fgSubtle,
                        cursor: 'pointer',
                        padding: '0 2px',
                        'font-size': '12px',
                        'line-height': '1',
                        display: 'flex',
                        'align-items': 'center',
                      }}
                    >
                      &times;
                    </button>
                  </div>
                );
              }}
            </For>
          </div>

          {/* Right-side actions */}
          <div
            style={{
              display: 'flex',
              'align-items': 'center',
              gap: '2px',
              'flex-shrink': '0',
              'margin-left': '4px',
            }}
          >
            {/* Split button */}
            <button
              class="icon-btn"
              onClick={(e) => {
                e.stopPropagation();
                handleSpawnSplit();
              }}
              tabIndex={-1}
              title="Split terminal"
              style={{
                background: 'transparent',
                border: 'none',
                color:
                  shellToolbarIdx() === 1 && shellToolbarFocused() ? theme.accent : theme.fgSubtle,
                cursor: 'pointer',
                padding: '4px',
                display: 'flex',
                'align-items': 'center',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                <path d="M7.25 1H2.75A1.75 1.75 0 0 0 1 2.75v10.5c0 .966.784 1.75 1.75 1.75h4.5V1Zm1.5 14h4.5A1.75 1.75 0 0 0 15 13.25V2.75A1.75 1.75 0 0 0 13.25 1h-4.5v14Z" />
              </svg>
            </button>
            {/* New terminal button */}
            <button
              class="icon-btn"
              onClick={(e) => {
                e.stopPropagation();
                handleSpawnShell();
              }}
              tabIndex={-1}
              title={`New terminal (${mod}+Shift+T)`}
              style={{
                background: 'transparent',
                border: 'none',
                color:
                  shellToolbarIdx() === 0 && shellToolbarFocused() ? theme.accent : theme.fgSubtle,
                cursor: 'pointer',
                padding: '4px',
                display: 'flex',
                'align-items': 'center',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                <path d="M7.75 2a.75.75 0 0 1 .75.75V7h4.25a.75.75 0 0 1 0 1.5H8.5v4.25a.75.75 0 0 1-1.5 0V8.5H2.75a.75.75 0 0 1 0-1.5H7V2.75A.75.75 0 0 1 7.75 2Z" />
              </svg>
            </button>
            {/* Bookmark buttons */}
            <For each={projectBookmarks()}>
              {(bookmark, i) => (
                <button
                  class="icon-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    runBookmarkInTask(props.task.id, bookmark.command);
                  }}
                  tabIndex={-1}
                  title={bookmark.command}
                  style={{
                    background: 'transparent',
                    border:
                      shellToolbarIdx() === i() + 2 && shellToolbarFocused()
                        ? `1px solid ${theme.accent}`
                        : '1px solid transparent',
                    color: theme.fgMuted,
                    cursor: 'pointer',
                    'border-radius': '4px',
                    padding: '2px 6px',
                    'font-size': sf(10),
                    'line-height': '1',
                  }}
                >
                  {extractLabel(bookmark.command)}
                </button>
              )}
            </For>
          </div>
        </div>

        {/* Terminal content area — all shells stay mounted, only active/split shown */}
        <Show when={!collapsed() && props.task.shellAgentIds.length > 0}>
          <div
            style={{
              flex: '1',
              display: 'flex',
              overflow: 'hidden',
              gap: '1px',
              background: theme.border,
            }}
          >
            <For each={props.task.shellAgentIds}>
              {(shellId, i) => {
                const isVisible = () => activeShellId() === shellId || splitShellId() === shellId;
                return (
                  <div
                    style={{
                      flex: isVisible() ? '1' : undefined,
                      height: isVisible() ? '100%' : '0',
                      width: isVisible() ? undefined : '0',
                      overflow: 'hidden',
                      'min-width': '0',
                      position: isVisible() ? 'relative' : 'absolute',
                      visibility: isVisible() ? 'visible' : 'hidden',
                    }}
                  >
                    <TerminalPane shellId={shellId} shellIndex={i()} />
                  </div>
                );
              }}
            </For>
          </div>
        </Show>

        {/* Empty state when no shells and not collapsed */}
        <Show when={!collapsed() && props.task.shellAgentIds.length === 0}>
          <div
            style={{
              flex: '1',
              display: 'flex',
              'align-items': 'center',
              'justify-content': 'center',
              color: theme.fgSubtle,
              'font-size': sf(12),
            }}
          >
            Click + to open a terminal
          </div>
        </Show>
      </div>
    </ScalablePanel>
  );
}
