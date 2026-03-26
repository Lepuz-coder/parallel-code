import { createSignal, For, Show } from 'solid-js';
import {
  store,
  pickAndAddProject,
  toggleNewTaskDialog,
  toggleSidebar,
  getPanelSize,
  setPanelSizes,
  toggleSettingsDialog,
  loadProfile,
  deleteProfile,
  toggleSaveProfileDialog,
} from '../store/store';
import { ConfirmDialog } from './ConfirmDialog';
import { SaveProfileDialog } from './SaveProfileDialog';
import { FileExplorer } from './FileExplorer';
import { IconButton } from './IconButton';
import { theme } from '../lib/theme';
import { sf } from '../lib/fontScale';
import { mod } from '../lib/platform';

const SIDEBAR_DEFAULT_WIDTH = 240;
const SIDEBAR_MIN_WIDTH = 160;
const SIDEBAR_MAX_WIDTH = 480;
const SIDEBAR_SIZE_KEY = 'sidebar:width';

export function Sidebar() {
  const [resizing, setResizing] = createSignal(false);
  const [confirmLoadProfile, setConfirmLoadProfile] = createSignal<string | null>(null);
  const [confirmDeleteProfile, setConfirmDeleteProfile] = createSignal<string | null>(null);
  const sidebarWidth = () => getPanelSize(SIDEBAR_SIZE_KEY) ?? SIDEBAR_DEFAULT_WIDTH;

  function handleResizeMouseDown(e: MouseEvent) {
    e.preventDefault();
    setResizing(true);
    const startX = e.clientX;
    const startWidth = sidebarWidth();

    function onMove(ev: MouseEvent) {
      const newWidth = Math.max(
        SIDEBAR_MIN_WIDTH,
        Math.min(SIDEBAR_MAX_WIDTH, startWidth + ev.clientX - startX),
      );
      setPanelSizes({ [SIDEBAR_SIZE_KEY]: newWidth });
    }

    function onUp() {
      setResizing(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  return (
    <div
      style={{
        width: `${sidebarWidth()}px`,
        'min-width': `${SIDEBAR_MIN_WIDTH}px`,
        'max-width': `${SIDEBAR_MAX_WIDTH}px`,
        display: 'flex',
        'flex-shrink': '0',
        'user-select': resizing() ? 'none' : undefined,
      }}
    >
      <div
        style={{
          flex: '1',
          'min-width': '0',
          'min-height': '0',
          display: 'flex',
          'flex-direction': 'column',
          padding: '16px',
          gap: '16px',
          'user-select': 'none',
          overflow: 'hidden',
        }}
      >
        {/* Logo + collapse */}
        <div
          style={{ display: 'flex', 'align-items': 'center', 'justify-content': 'space-between' }}
        >
          <div style={{ display: 'flex', 'align-items': 'center', gap: '8px', padding: '0 2px' }}>
            <svg
              width="24"
              height="24"
              viewBox="0 0 56 56"
              fill="none"
              stroke={theme.fg}
              stroke-width="4"
              style={{ 'flex-shrink': '0' }}
            >
              <line x1="10" y1="6" x2="10" y2="50" />
              <line x1="22" y1="6" x2="22" y2="50" />
              <path d="M30 8 H47 V24 H30" />
              <path d="M49 32 H32 V48 H49" />
            </svg>
            <span
              style={{
                'font-size': sf(14),
                'font-weight': '600',
                color: theme.fg,
                'font-family': "'JetBrains Mono', monospace",
              }}
            >
              ParallelCode
            </span>
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            <IconButton
              icon={
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 2.25a.75.75 0 0 1 .73.56l.2.72a4.48 4.48 0 0 1 1.04.43l.66-.37a.75.75 0 0 1 .9.13l.75.75a.75.75 0 0 1 .13.9l-.37.66c.17.33.31.68.43 1.04l.72.2a.75.75 0 0 1 .56.73v1.06a.75.75 0 0 1-.56.73l-.72.2a4.48 4.48 0 0 1-.43 1.04l.37.66a.75.75 0 0 1-.13.9l-.75.75a.75.75 0 0 1-.9.13l-.66-.37a4.48 4.48 0 0 1-1.04.43l-.2.72a.75.75 0 0 1-.73.56H6.94a.75.75 0 0 1-.73-.56l-.2-.72a4.48 4.48 0 0 1-1.04-.43l-.66.37a.75.75 0 0 1-.9-.13l-.75-.75a.75.75 0 0 1-.13-.9l.37-.66a4.48 4.48 0 0 1-.43-1.04l-.72-.2a.75.75 0 0 1-.56-.73V7.47a.75.75 0 0 1 .56-.73l.72-.2c.11-.36.26-.71.43-1.04l-.37-.66a.75.75 0 0 1 .13-.9l.75-.75a.75.75 0 0 1 .9-.13l.66.37c.33-.17.68-.31 1.04-.43l.2-.72a.75.75 0 0 1 .73-.56H8Zm-.53 3.22a2.5 2.5 0 1 0 1.06 4.88 2.5 2.5 0 0 0-1.06-4.88Z" />
                </svg>
              }
              onClick={() => toggleSettingsDialog(true)}
              title={`Settings (${mod}+,)`}
            />
            <IconButton
              icon={
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M9.78 12.78a.75.75 0 0 1-1.06 0L4.47 8.53a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 1.06L6.06 8l3.72 3.72a.75.75 0 0 1 0 1.06Z" />
                </svg>
              }
              onClick={() => toggleSidebar()}
              title={`Collapse sidebar (${mod}+B)`}
            />
          </div>
        </div>

        {/* Profiles section */}
        <div style={{ display: 'flex', 'flex-direction': 'column', gap: '6px' }}>
          <div
            style={{
              display: 'flex',
              'align-items': 'center',
              'justify-content': 'space-between',
              padding: '0 2px',
            }}
          >
            <label
              style={{
                'font-size': sf(11),
                color: theme.fgMuted,
                'text-transform': 'uppercase',
                'letter-spacing': '0.05em',
              }}
            >
              Profiles
            </label>
            <IconButton
              icon={
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M7.75 2a.75.75 0 0 1 .75.75V7h4.25a.75.75 0 0 1 0 1.5H8.5v4.25a.75.75 0 0 1-1.5 0V8.5H2.75a.75.75 0 0 1 0-1.5H7V2.75A.75.75 0 0 1 7.75 2Z" />
                </svg>
              }
              onClick={() => {
                if (store.taskOrder.length > 0) toggleSaveProfileDialog(true);
              }}
              title="Save current workspace as profile"
              size="sm"
            />
          </div>

          <For each={store.profiles}>
            {(profile) => (
              <div
                style={{
                  display: 'flex',
                  'align-items': 'center',
                  gap: '6px',
                  padding: '4px 6px',
                  'border-radius': '6px',
                  background: theme.bgInput,
                  'font-size': sf(11),
                  cursor: 'pointer',
                }}
                onClick={() => setConfirmLoadProfile(profile.id)}
                title={`Load profile (${profile.tasks.length} tasks, ${profile.terminals.length} terminals)`}
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 16 16"
                  fill={theme.fgMuted}
                  style={{ 'flex-shrink': '0' }}
                >
                  <path d="M4 2a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7.5a.5.5 0 0 0-.5-.5h-4A1.5 1.5 0 0 1 8 5.5V1.5a.5.5 0 0 0-.5-.5H4Zm5 .15V5.5a.5.5 0 0 0 .5.5h3.35A2 2 0 0 0 12 4.83L9.17 2.15A2 2 0 0 0 9 2.15Z" />
                </svg>
                <span
                  style={{
                    flex: '1',
                    'min-width': '0',
                    color: theme.fg,
                    'font-weight': '500',
                    'white-space': 'nowrap',
                    overflow: 'hidden',
                    'text-overflow': 'ellipsis',
                  }}
                >
                  {profile.name}
                </span>
                <span
                  style={{
                    color: theme.fgSubtle,
                    'font-size': sf(10),
                    'flex-shrink': '0',
                  }}
                >
                  {profile.tasks.length + profile.terminals.length}
                </span>
                <button
                  class="icon-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirmDeleteProfile(profile.id);
                  }}
                  title="Delete profile"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: theme.fgSubtle,
                    cursor: 'pointer',
                    'font-size': sf(12),
                    'line-height': '1',
                    padding: '0 2px',
                    'flex-shrink': '0',
                  }}
                >
                  &times;
                </button>
              </div>
            )}
          </For>

          <Show when={store.profiles.length === 0}>
            <span style={{ 'font-size': sf(10), color: theme.fgSubtle, padding: '0 2px' }}>
              No profiles saved yet.
            </span>
          </Show>
        </div>

        <div style={{ height: '1px', background: theme.border }} />

        {/* File Explorer — takes remaining space */}
        <FileExplorer />

        {/* New task / Link project button — pinned to bottom */}
        <Show
          when={store.projects.length > 0}
          fallback={
            <button
              class="icon-btn"
              onClick={() => pickAndAddProject()}
              style={{
                background: 'transparent',
                border: `1px solid ${theme.border}`,
                'border-radius': '8px',
                padding: '8px 14px',
                color: theme.fgMuted,
                cursor: 'pointer',
                'font-size': sf(12),
                'font-weight': '500',
                display: 'flex',
                'align-items': 'center',
                'justify-content': 'center',
                gap: '6px',
                width: '100%',
                'flex-shrink': '0',
              }}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 16 16"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.22.78 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2A1.75 1.75 0 0 0 5 1H1.75Z" />
              </svg>
              Link Project
            </button>
          }
        >
          <button
            class="icon-btn"
            onClick={() => toggleNewTaskDialog(true)}
            style={{
              background: 'transparent',
              border: `1px solid ${theme.border}`,
              'border-radius': '8px',
              padding: '8px 14px',
              color: theme.fgMuted,
              cursor: 'pointer',
              'font-size': sf(12),
              'font-weight': '500',
              display: 'flex',
              'align-items': 'center',
              'justify-content': 'center',
              gap: '6px',
              width: '100%',
              'flex-shrink': '0',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M7.75 2a.75.75 0 0 1 .75.75V7h4.25a.75.75 0 0 1 0 1.5H8.5v4.25a.75.75 0 0 1-1.5 0V8.5H2.75a.75.75 0 0 1 0-1.5H7V2.75A.75.75 0 0 1 7.75 2Z" />
            </svg>
            New Task
          </button>
        </Show>

        {/* Save profile dialog */}
        <SaveProfileDialog />

        {/* Confirm load profile */}
        <ConfirmDialog
          open={confirmLoadProfile() !== null}
          title="Load profile?"
          message="This will close all current tasks and terminals."
          confirmLabel="Load"
          onConfirm={() => {
            const id = confirmLoadProfile();
            if (id) loadProfile(id);
            setConfirmLoadProfile(null);
          }}
          onCancel={() => setConfirmLoadProfile(null)}
        />

        {/* Confirm delete profile */}
        <ConfirmDialog
          open={confirmDeleteProfile() !== null}
          title="Delete profile?"
          message="Are you sure you want to delete this profile?"
          confirmLabel="Delete"
          danger
          onConfirm={() => {
            const id = confirmDeleteProfile();
            if (id) deleteProfile(id);
            setConfirmDeleteProfile(null);
          }}
          onCancel={() => setConfirmDeleteProfile(null)}
        />
      </div>
      {/* Resize handle */}
      <div
        class={`resize-handle resize-handle-h${resizing() ? ' dragging' : ''}`}
        onMouseDown={handleResizeMouseDown}
      />
    </div>
  );
}
