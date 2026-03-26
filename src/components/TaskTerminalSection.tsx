import { Show, For, createSignal, createEffect, onCleanup } from 'solid-js';
import { createStore, produce } from 'solid-js/store';
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

// --- Types ---

interface TerminalGroup {
  id: string;
  shellIds: string[];
  activeShellId: string;
}

interface TaskTerminalSectionProps {
  task: Task;
  isActive: boolean;
}

// --- Constants ---
const DRAG_THRESHOLD = 5;

export function TaskTerminalSection(props: TaskTerminalSectionProps) {
  const [groups, setGroups] = createStore<TerminalGroup[]>([]);
  const [focusedGroupId, setFocusedGroupId] = createSignal<string | null>(null);
  const [collapsed, setCollapsed] = createSignal(true);
  const [shellToolbarIdx, setShellToolbarIdx] = createSignal(0);
  const [shellToolbarFocused, setShellToolbarFocused] = createSignal(false);
  const [shellExits, setShellExits] = createStore<
    Record<string, { exitCode: number | null; signal: string | null }>
  >({});

  // Drag state
  const [dragShellId, setDragShellId] = createSignal<string | null>(null);
  const [dragGhostPos, setDragGhostPos] = createSignal<{ x: number; y: number } | null>(null);
  const [dropTarget, setDropTarget] = createSignal<{
    groupId: string;
    position: number;
  } | null>(null);

  let tabBarEl: HTMLDivElement | undefined;

  const projectBookmarks = () => getProject(props.task.projectId)?.terminalBookmarks ?? [];

  // --- Group helpers ---

  function allGroupShellIds(): Set<string> {
    const ids = new Set<string>();
    // Access groups.length to track array changes in SolidJS store
    const len = groups.length;
    for (let i = 0; i < len; i++) {
      const shellIds = groups[i].shellIds;
      for (let j = 0; j < shellIds.length; j++) {
        ids.add(shellIds[j]);
      }
    }
    return ids;
  }

  // --- Sync groups with task.shellAgentIds ---

  createEffect(() => {
    const shells = props.task.shellAgentIds;
    if (shells.length === 0) {
      setGroups([]);
      setCollapsed(true);
      setFocusedGroupId(null);
      return;
    }
    setCollapsed(false);

    const known = allGroupShellIds();
    const newShells = shells.filter((s) => !known.has(s));
    const shellSet = new Set(shells);

    // Single produce call: add new shells + remove closed shells + clean up empty groups
    setGroups(
      produce((gs) => {
        // 1) Remove closed shells from all groups
        for (let gi = gs.length - 1; gi >= 0; gi--) {
          gs[gi].shellIds = gs[gi].shellIds.filter((s) => shellSet.has(s));
          if (gs[gi].shellIds.length === 0) {
            gs.splice(gi, 1);
          } else if (!gs[gi].shellIds.includes(gs[gi].activeShellId)) {
            gs[gi].activeShellId = gs[gi].shellIds[gs[gi].shellIds.length - 1];
          }
        }

        // 2) Add new shells to focused group or create first group
        if (newShells.length > 0) {
          const focusedIdx = gs.findIndex((g) => g.id === focusedGroupId());
          const targetIdx = focusedIdx >= 0 ? focusedIdx : gs.length > 0 ? 0 : -1;

          if (targetIdx >= 0) {
            for (const sid of newShells) {
              gs[targetIdx].shellIds.push(sid);
              gs[targetIdx].activeShellId = sid;
            }
          } else {
            const gid = crypto.randomUUID();
            gs.push({
              id: gid,
              shellIds: [...newShells],
              activeShellId: newShells[newShells.length - 1],
            });
            setFocusedGroupId(gid);
          }
        }
      }),
    );

    // Ensure focusedGroupId is valid
    if (!groups.find((g) => g.id === focusedGroupId()) && groups.length > 0) {
      setFocusedGroupId(groups[0].id);
    }
  });

  // --- Focus registration ---

  createEffect(() => {
    const id = props.task.id;
    const bmCount = projectBookmarks().length;
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

  // --- Actions ---

  function handleSpawnShell(): void {
    spawnShellForTask(props.task.id);
  }

  function handleSpawnSplit(): void {
    // Pre-create the group BEFORE spawning, so the sync effect
    // won't auto-assign the new shell to the wrong group.
    const gid = crypto.randomUUID();
    const newId = spawnShellForTask(props.task.id);
    if (!newId) return;

    // The effect may have already auto-added newId to an existing group.
    // Fix it: remove from wherever it landed and place into the new group.
    setGroups(
      produce((gs) => {
        for (const g of gs) {
          const idx = g.shellIds.indexOf(newId);
          if (idx !== -1) {
            g.shellIds.splice(idx, 1);
            if (g.activeShellId === newId && g.shellIds.length > 0) {
              g.activeShellId = g.shellIds[g.shellIds.length - 1];
            }
          }
        }
        // Remove empty groups
        for (let i = gs.length - 1; i >= 0; i--) {
          if (gs[i].shellIds.length === 0) gs.splice(i, 1);
        }
        gs.push({ id: gid, shellIds: [newId], activeShellId: newId });
      }),
    );
    setFocusedGroupId(gid);
  }

  function handleCloseShell(shellId: string): void {
    // Immediately remove from groups (don't wait for async closeShell to update shellAgentIds)
    setGroups(
      produce((gs) => {
        for (let gi = gs.length - 1; gi >= 0; gi--) {
          const idx = gs[gi].shellIds.indexOf(shellId);
          if (idx !== -1) {
            gs[gi].shellIds.splice(idx, 1);
            if (gs[gi].shellIds.length === 0) {
              gs.splice(gi, 1);
            } else if (gs[gi].activeShellId === shellId) {
              gs[gi].activeShellId = gs[gi].shellIds[Math.min(idx, gs[gi].shellIds.length - 1)];
            }
            break;
          }
        }
      }),
    );
    closeShell(props.task.id, shellId);
  }

  function handleTabClick(groupId: string, shellId: string): void {
    setGroups(
      produce((gs) => {
        const g = gs.find((gr) => gr.id === groupId);
        if (g) g.activeShellId = shellId;
      }),
    );
    setFocusedGroupId(groupId);
  }

  function shellLabel(shellId: string): string {
    const label = extractLabel(shellId);
    if (label && label !== shellId) return label;
    const globalIdx = props.task.shellAgentIds.indexOf(shellId);
    if (globalIdx === -1) return 'Shell';
    return `Shell ${globalIdx + 1}`;
  }

  // --- Drag-to-reorder tabs ---

  function handleTabDragStart(e: MouseEvent, shellId: string, _sourceGroupId: string): void {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('button')) return;

    const startX = e.clientX;
    const startY = e.clientY;
    let dragging = false;

    function onMove(ev: MouseEvent): void {
      if (
        !dragging &&
        Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) < DRAG_THRESHOLD
      )
        return;

      if (!dragging) {
        dragging = true;
        setDragShellId(shellId);
      }

      setDragGhostPos({ x: ev.clientX, y: ev.clientY });

      // Compute drop target
      const groupEls = document.querySelectorAll<HTMLElement>('[data-terminal-group-id]');
      let foundTarget: { groupId: string; position: number } | null = null;

      for (const groupEl of groupEls) {
        const gid = groupEl.dataset.terminalGroupId ?? '';
        const tabEls = groupEl.querySelectorAll<HTMLElement>('[data-tab-shell-id]');
        const groupRect = groupEl.getBoundingClientRect();

        if (
          ev.clientX >= groupRect.left &&
          ev.clientX <= groupRect.right &&
          ev.clientY >= groupRect.top &&
          ev.clientY <= groupRect.bottom
        ) {
          // Within this group — find position among tabs
          let pos = tabEls.length;
          for (let ti = 0; ti < tabEls.length; ti++) {
            const tabRect = tabEls[ti].getBoundingClientRect();
            if (ev.clientX < tabRect.left + tabRect.width / 2) {
              pos = ti;
              break;
            }
          }
          foundTarget = { groupId: gid, position: pos };
          break;
        }
      }

      setDropTarget(foundTarget);
    }

    function onUp(): void {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);

      if (dragging) {
        const dt = dropTarget();
        const sid = dragShellId();
        setDragShellId(null);
        setDragGhostPos(null);
        setDropTarget(null);

        if (dt && sid) {
          moveShellToGroup(sid, dt.groupId, dt.position);
        }
      }
    }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function moveShellToGroup(shellId: string, targetGroupId: string, position: number): void {
    setGroups(
      produce((gs) => {
        // Remove from source group
        for (const g of gs) {
          const idx = g.shellIds.indexOf(shellId);
          if (idx !== -1) {
            g.shellIds.splice(idx, 1);
            if (g.activeShellId === shellId && g.shellIds.length > 0) {
              g.activeShellId = g.shellIds[Math.min(idx, g.shellIds.length - 1)];
            }
            break;
          }
        }

        // Insert into target group
        const target = gs.find((g) => g.id === targetGroupId);
        if (target) {
          const insertPos = Math.min(position, target.shellIds.length);
          target.shellIds.splice(insertPos, 0, shellId);
          target.activeShellId = shellId;
        }

        // Remove empty groups
        for (let i = gs.length - 1; i >= 0; i--) {
          if (gs[i].shellIds.length === 0) gs.splice(i, 1);
        }
      }),
    );
  }

  // --- Terminal Pane ---

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

  // --- Group Pane ---

  function GroupPane(groupProps: { group: TerminalGroup }) {
    const isFocused = () => focusedGroupId() === groupProps.group.id;

    return (
      <div
        data-terminal-group-id={groupProps.group.id}
        onClick={() => setFocusedGroupId(groupProps.group.id)}
        style={{
          flex: '1',
          'min-width': '0',
          height: '100%',
          display: 'flex',
          'flex-direction': 'column',
          overflow: 'hidden',
          border: isFocused() ? `1px solid ${theme.accent}33` : '1px solid transparent',
          'border-radius': '2px',
        }}
      >
        {/* Per-group tab bar */}
        <div
          style={{
            display: 'flex',
            'align-items': 'center',
            height: '26px',
            'min-height': '26px',
            padding: '0 2px',
            gap: '0',
            overflow: 'hidden',
            background: `color-mix(in srgb, ${theme.bgElevated} 50%, transparent)`,
          }}
        >
          <For each={groupProps.group.shellIds}>
            {(shellId, i) => {
              const isActiveTab = () => groupProps.group.activeShellId === shellId;
              const isDragged = () => dragShellId() === shellId;
              const showDropBefore = () => {
                const dt = dropTarget();
                return (
                  dt &&
                  dt.groupId === groupProps.group.id &&
                  dt.position === i() &&
                  dragShellId() !== null
                );
              };

              return (
                <>
                  <Show when={showDropBefore()}>
                    <div
                      style={{
                        width: '2px',
                        height: '18px',
                        background: theme.accent,
                        'border-radius': '1px',
                        'flex-shrink': '0',
                      }}
                    />
                  </Show>
                  <div
                    data-tab-shell-id={shellId}
                    onMouseDown={(e) => handleTabDragStart(e, shellId, groupProps.group.id)}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleTabClick(groupProps.group.id, shellId);
                    }}
                    style={{
                      display: 'flex',
                      'align-items': 'center',
                      gap: '3px',
                      padding: '2px 6px',
                      cursor: isDragged() ? 'grabbing' : 'pointer',
                      'font-size': sf(10),
                      color: isActiveTab() ? theme.fg : theme.fgMuted,
                      'border-bottom': isActiveTab()
                        ? `2px solid ${theme.accent}`
                        : '2px solid transparent',
                      'white-space': 'nowrap',
                      'flex-shrink': '0',
                      opacity: isDragged() ? '0.4' : '1',
                      background: isActiveTab()
                        ? `color-mix(in srgb, ${theme.accent} 8%, transparent)`
                        : 'transparent',
                    }}
                    onMouseEnter={(e) => {
                      if (!isActiveTab())
                        (e.currentTarget as HTMLElement).style.background = theme.bgHover;
                    }}
                    onMouseLeave={(e) => {
                      if (!isActiveTab())
                        (e.currentTarget as HTMLElement).style.background = 'transparent';
                    }}
                  >
                    <span style={{ 'font-family': 'monospace', 'font-size': sf(9) }}>&gt;_</span>
                    <span>{shellLabel(shellId)}</span>
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
                        padding: '0 1px',
                        'font-size': '10px',
                        'line-height': '1',
                        display: 'flex',
                        'align-items': 'center',
                      }}
                    >
                      &times;
                    </button>
                  </div>
                </>
              );
            }}
          </For>
          {/* Trailing drop indicator */}
          <Show
            when={
              dropTarget()?.groupId === groupProps.group.id &&
              dropTarget()?.position === groupProps.group.shellIds.length &&
              dragShellId() !== null
            }
          >
            <div
              style={{
                width: '2px',
                height: '18px',
                background: theme.accent,
                'border-radius': '1px',
                'flex-shrink': '0',
              }}
            />
          </Show>
        </div>

        {/* Terminal content — all shells mounted, only active visible */}
        <div style={{ flex: '1', 'min-height': '0', overflow: 'hidden', position: 'relative' }}>
          <For each={groupProps.group.shellIds}>
            {(shellId) => {
              const isVisible = () => groupProps.group.activeShellId === shellId;
              const globalIdx = () => props.task.shellAgentIds.indexOf(shellId);
              return (
                <div
                  style={{
                    width: isVisible() ? '100%' : '0',
                    height: isVisible() ? '100%' : '0',
                    overflow: 'hidden',
                    position: isVisible() ? 'relative' : 'absolute',
                    visibility: isVisible() ? 'visible' : 'hidden',
                  }}
                >
                  <Show when={globalIdx() !== -1}>
                    <TerminalPane shellId={shellId} shellIndex={globalIdx()} />
                  </Show>
                </div>
              );
            }}
          </For>
        </div>
      </div>
    );
  }

  // --- Render ---

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
        {/* Global toolbar */}
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

          <span
            style={{
              'font-size': sf(11),
              color: theme.fgMuted,
              padding: '0 4px',
              'flex-shrink': '0',
            }}
          >
            Terminal
          </span>

          {/* Spacer */}
          <div style={{ flex: '1' }} />

          {/* Right-side actions */}
          <div
            style={{
              display: 'flex',
              'align-items': 'center',
              gap: '2px',
              'flex-shrink': '0',
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
              title="Split terminal (new pane)"
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

        {/* Groups content area */}
        <Show when={!collapsed() && groups.length > 0}>
          <div
            style={{
              flex: '1',
              display: 'flex',
              overflow: 'hidden',
              gap: '1px',
              background: theme.border,
              'min-height': '0',
            }}
          >
            <For each={groups}>{(group) => <GroupPane group={group} />}</For>
          </div>
        </Show>

        {/* Empty state */}
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

        {/* Drag ghost */}
        <Show when={dragShellId() && dragGhostPos()}>
          <div
            style={{
              position: 'fixed',
              left: `${(dragGhostPos()?.x ?? 0) + 10}px`,
              top: `${(dragGhostPos()?.y ?? 0) - 10}px`,
              background: theme.bgElevated,
              border: `1px solid ${theme.accent}`,
              'border-radius': '4px',
              padding: '2px 8px',
              'font-size': sf(10),
              color: theme.fg,
              'z-index': '9999',
              'pointer-events': 'none',
              'box-shadow': '0 4px 12px rgba(0,0,0,0.3)',
            }}
          >
            <span style={{ 'font-family': 'monospace' }}>&gt;_</span>{' '}
            {shellLabel(dragShellId() ?? '')}
          </div>
        </Show>
      </div>
    </ScalablePanel>
  );
}
