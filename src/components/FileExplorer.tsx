import { createSignal, onCleanup, For, Show, type JSX } from 'solid-js';
import { store } from '../store/core';
import {
  openFileViewer,
  pickAndAddProject,
  removeProject,
  removeProjectWithTasks,
} from '../store/store';
import type { Project } from '../store/types';
import { invoke } from '../lib/ipc';
import { IPC } from '../../electron/ipc/channels';
import { theme } from '../lib/theme';
import { sf } from '../lib/fontScale';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';
import { EditProjectDialog } from './EditProjectDialog';
import { ConfirmDialog } from './ConfirmDialog';
import { IconButton } from './IconButton';

interface DirEntry {
  name: string;
  isDirectory: boolean;
  size: number;
}

interface SearchResult {
  relativePath: string;
  isDirectory: boolean;
}

// Ephemeral state: directory cache and expanded paths
const [dirCache, setDirCache] = createSignal<Record<string, DirEntry[]>>({});
const [expandedPaths, setExpandedPaths] = createSignal<Record<string, boolean>>({});
const [loadingPaths, setLoadingPaths] = createSignal<Record<string, boolean>>({});

// Context menu state
const [contextMenu, setContextMenu] = createSignal<{
  x: number;
  y: number;
  items: ContextMenuItem[];
} | null>(null);

async function loadDirectory(dirPath: string): Promise<void> {
  if (dirCache()[dirPath]) return;
  setLoadingPaths((prev) => ({ ...prev, [dirPath]: true }));
  try {
    const entries = await invoke<DirEntry[]>(IPC.ReadDirectory, { dirPath });
    setDirCache((prev) => ({ ...prev, [dirPath]: entries }));
  } catch (err) {
    console.error('Failed to read directory:', err);
  } finally {
    setLoadingPaths((prev) => ({ ...prev, [dirPath]: false }));
  }
}

function toggleExpand(dirPath: string): void {
  const isExpanded = expandedPaths()[dirPath];
  if (isExpanded) {
    setExpandedPaths((prev) => ({ ...prev, [dirPath]: false }));
  } else {
    setExpandedPaths((prev) => ({ ...prev, [dirPath]: true }));
    loadDirectory(dirPath);
  }
}

function relativePath(filePath: string, projectPath: string): string {
  if (filePath.startsWith(projectPath)) {
    const rel = filePath.slice(projectPath.length);
    return rel.startsWith('/') ? rel.slice(1) : rel;
  }
  return filePath;
}

function copyRelativePath(filePath: string, projectPath: string): void {
  const rel = relativePath(filePath, projectPath);
  navigator.clipboard.writeText(rel).catch((err) => {
    console.error('Failed to copy path:', err);
  });
}

// --- Icons ---
function ChevronRight(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <path d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z" />
    </svg>
  );
}

function ChevronDown(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <path d="M12.78 6.22a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L3.22 7.28a.75.75 0 0 1 1.06-1.06L8 9.94l3.72-3.72a.75.75 0 0 1 1.06 0Z" />
    </svg>
  );
}

function FolderIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill={theme.fgMuted}>
      <path d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.22.78 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2A1.75 1.75 0 0 0 5 1H1.75Z" />
    </svg>
  );
}

function FolderOpenIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill={theme.accent}>
      <path d="M.513 1.513A1.75 1.75 0 0 1 1.75 1h3.5c.55 0 1.07.26 1.4.7l.9 1.2a.25.25 0 0 0 .2.1h6.5A1.75 1.75 0 0 1 16 4.75v.462a.75.75 0 0 1-.03.07L14.28 14.2a1.75 1.75 0 0 1-1.7 1.3H3.42a1.75 1.75 0 0 1-1.7-1.3L.084 5.382A.75.75 0 0 1 0 5.08V2.75c0-.464.184-.91.513-1.237Z" />
    </svg>
  );
}

function FileIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill={theme.fgSubtle}>
      <path d="M3.75 1.5a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25V6H9.75A1.75 1.75 0 0 1 8 4.25V1.5H3.75Zm5.75.56v2.19c0 .138.112.25.25.25h2.19L9.5 2.06ZM2 1.75C2 .784 2.784 0 3.75 0h5.086c.464 0 .909.184 1.237.513l3.414 3.414c.329.328.513.773.513 1.237v9.086A1.75 1.75 0 0 1 12.25 16h-8.5A1.75 1.75 0 0 1 2 14.25V1.75Z" />
    </svg>
  );
}

// --- File Tree Item ---
function FileTreeItem(props: {
  entry: DirEntry;
  dirPath: string;
  projectPath: string;
  depth: number;
}) {
  const fullPath = () => `${props.dirPath}/${props.entry.name}`;
  const isExpanded = () => expandedPaths()[fullPath()] ?? false;
  const isLoading = () => loadingPaths()[fullPath()] ?? false;
  const children = () => dirCache()[fullPath()] ?? [];

  const handleClick = () => {
    if (props.entry.isDirectory) {
      toggleExpand(fullPath());
    } else {
      openFileViewer(fullPath(), props.projectPath);
    }
  };

  const handleContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: 'Copy Relative Path',
          onClick: () => copyRelativePath(fullPath(), props.projectPath),
        },
      ],
    });
  };

  return (
    <>
      <div
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        style={{
          display: 'flex',
          'align-items': 'center',
          gap: '4px',
          padding: '2px 4px',
          'padding-left': `${props.depth * 16 + 4}px`,
          cursor: 'pointer',
          'border-radius': '4px',
          'font-size': sf(13),
          color: theme.fg,
          'white-space': 'nowrap',
          overflow: 'hidden',
          'text-overflow': 'ellipsis',
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.background = theme.bgHover;
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.background = 'transparent';
        }}
      >
        {/* Chevron for directories */}
        <span
          style={{
            width: '14px',
            height: '14px',
            display: 'flex',
            'align-items': 'center',
            'justify-content': 'center',
            'flex-shrink': '0',
            color: theme.fgSubtle,
          }}
        >
          {props.entry.isDirectory ? isExpanded() ? <ChevronDown /> : <ChevronRight /> : null}
        </span>
        {/* Icon */}
        <span style={{ 'flex-shrink': '0', display: 'flex', 'align-items': 'center' }}>
          {props.entry.isDirectory ? (
            isExpanded() ? (
              <FolderOpenIcon />
            ) : (
              <FolderIcon />
            )
          ) : (
            <FileIcon />
          )}
        </span>
        {/* Name */}
        <span
          style={{
            overflow: 'hidden',
            'text-overflow': 'ellipsis',
            flex: '1',
            'min-width': '0',
          }}
        >
          {props.entry.name}
        </span>
      </div>

      {/* Children (expanded directories) */}
      <Show when={props.entry.isDirectory && isExpanded()}>
        <Show
          when={!isLoading()}
          fallback={
            <div
              style={{
                'padding-left': `${(props.depth + 1) * 16 + 20}px`,
                'font-size': sf(11),
                color: theme.fgSubtle,
                padding: '2px 4px',
              }}
            >
              Loading...
            </div>
          }
        >
          <For each={children()}>
            {(child) => (
              <FileTreeItem
                entry={child}
                dirPath={fullPath()}
                projectPath={props.projectPath}
                depth={props.depth + 1}
              />
            )}
          </For>
          <Show when={children().length === 0}>
            <div
              style={{
                'padding-left': `${(props.depth + 1) * 16 + 20}px`,
                'font-size': sf(11),
                color: theme.fgSubtle,
                'font-style': 'italic',
                padding: '2px 4px',
              }}
            >
              Empty
            </div>
          </Show>
        </Show>
      </Show>
    </>
  );
}

// --- Project File Tree ---
function ProjectFileTree(props: {
  project: Project;
  onRemove: (id: string) => void;
  onEdit: (project: Project) => void;
}) {
  const isExpanded = () => expandedPaths()[props.project.path] ?? false;
  const isLoading = () => loadingPaths()[props.project.path] ?? false;
  const children = () => dirCache()[props.project.path] ?? [];

  const handleToggle = () => {
    toggleExpand(props.project.path);
  };

  const handleContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: 'Copy Relative Path',
          onClick: () => navigator.clipboard.writeText('.').catch(() => {}),
        },
      ],
    });
  };

  return (
    <div>
      {/* Project root row */}
      <div
        onClick={handleToggle}
        onContextMenu={handleContextMenu}
        style={{
          display: 'flex',
          'align-items': 'center',
          gap: '4px',
          padding: '3px 4px',
          cursor: 'pointer',
          'border-radius': '4px',
          'font-size': sf(11),
          'font-weight': '600',
          color: theme.fg,
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.background = theme.bgHover;
          const btn = (e.currentTarget as HTMLElement).querySelector<HTMLElement>('.remove-btn');
          if (btn) btn.style.opacity = '1';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.background = 'transparent';
          const btn = (e.currentTarget as HTMLElement).querySelector<HTMLElement>('.remove-btn');
          if (btn) btn.style.opacity = '0';
        }}
      >
        <span
          style={{
            width: '14px',
            height: '14px',
            display: 'flex',
            'align-items': 'center',
            'justify-content': 'center',
            'flex-shrink': '0',
            color: theme.fgSubtle,
          }}
        >
          {isExpanded() ? <ChevronDown /> : <ChevronRight />}
        </span>
        <span style={{ 'flex-shrink': '0', display: 'flex', 'align-items': 'center' }}>
          {isExpanded() ? <FolderOpenIcon /> : <FolderIcon />}
        </span>
        <span
          onClick={(e) => {
            e.stopPropagation();
            props.onEdit(props.project);
          }}
          style={{
            overflow: 'hidden',
            'text-overflow': 'ellipsis',
            'white-space': 'nowrap',
            flex: '1',
            'min-width': '0',
          }}
          title="Click to edit project"
        >
          {props.project.name}
        </span>
        <button
          class="remove-btn"
          onClick={(e) => {
            e.stopPropagation();
            props.onRemove(props.project.id);
          }}
          title="Remove project"
          style={{
            background: 'transparent',
            border: 'none',
            color: theme.fgSubtle,
            cursor: 'pointer',
            'font-size': sf(12),
            'line-height': '1',
            padding: '0 2px',
            'flex-shrink': '0',
            opacity: '0',
            transition: 'opacity 0.15s',
          }}
        >
          &times;
        </button>
      </div>

      {/* Children */}
      <Show when={isExpanded()}>
        <Show
          when={!isLoading()}
          fallback={
            <div
              style={{
                'padding-left': '32px',
                'font-size': sf(11),
                color: theme.fgSubtle,
                padding: '2px 4px',
              }}
            >
              Loading...
            </div>
          }
        >
          <For each={children()}>
            {(child) => (
              <FileTreeItem
                entry={child}
                dirPath={props.project.path}
                projectPath={props.project.path}
                depth={1}
              />
            )}
          </For>
        </Show>
      </Show>
    </div>
  );
}

// --- Main File Explorer ---
export function FileExplorer() {
  const [collapsed, setCollapsed] = createSignal(false);
  const [searchQuery, setSearchQuery] = createSignal('');
  const [searchResults, setSearchResults] = createSignal<
    { projectName: string; projectPath: string; results: SearchResult[] }[]
  >([]);
  const [searchingFlag, setSearchingFlag] = createSignal(false);
  const [confirmRemove, setConfirmRemove] = createSignal<string | null>(null);
  const [editingProject, setEditingProject] = createSignal<Project | null>(null);
  let searchTimer: ReturnType<typeof setTimeout> | undefined;

  function handleSearchInput(value: string): void {
    setSearchQuery(value);
    if (searchTimer) clearTimeout(searchTimer);
    if (!value.trim()) {
      setSearchResults([]);
      return;
    }
    searchTimer = setTimeout(async () => {
      setSearchingFlag(true);
      const projects = store.projects;
      const allResults: {
        projectName: string;
        projectPath: string;
        results: SearchResult[];
      }[] = [];
      for (const project of projects) {
        try {
          const res = await invoke<SearchResult[]>(IPC.SearchFiles, {
            rootPath: project.path,
            query: value.trim(),
          });
          if (res.length > 0) {
            allResults.push({
              projectName: project.name,
              projectPath: project.path,
              results: res,
            });
          }
        } catch {
          // skip
        }
      }
      setSearchResults(allResults);
      setSearchingFlag(false);
    }, 300);
  }

  onCleanup(() => {
    if (searchTimer) clearTimeout(searchTimer);
  });

  return (
    <>
      <div style={{ display: 'flex', 'flex-direction': 'column', gap: '4px' }}>
        {/* Section header */}
        <div
          style={{
            display: 'flex',
            'align-items': 'center',
            'justify-content': 'space-between',
            padding: '0 2px',
          }}
        >
          <label
            onClick={() => setCollapsed((c) => !c)}
            style={{
              'font-size': sf(11),
              color: theme.fgMuted,
              'text-transform': 'uppercase',
              'letter-spacing': '0.05em',
              cursor: 'pointer',
              display: 'flex',
              'align-items': 'center',
              gap: '4px',
              'user-select': 'none',
            }}
          >
            <span
              style={{
                display: 'inline-flex',
                transition: 'transform 0.15s ease',
                transform: collapsed() ? 'rotate(-90deg)' : 'rotate(0deg)',
              }}
            >
              <ChevronDown />
            </span>
            Projects
          </label>
          <IconButton
            icon={
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M7.75 2a.75.75 0 0 1 .75.75V7h4.25a.75.75 0 0 1 0 1.5H8.5v4.25a.75.75 0 0 1-1.5 0V8.5H2.75a.75.75 0 0 1 0-1.5H7V2.75A.75.75 0 0 1 7.75 2Z" />
              </svg>
            }
            onClick={() => pickAndAddProject()}
            title="Add project"
            size="sm"
          />
        </div>

        <Show when={!collapsed()}>
          {/* Search input */}
          <input
            type="text"
            value={searchQuery()}
            onInput={(e) => handleSearchInput(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setSearchQuery('');
                setSearchResults([]);
                (e.currentTarget as HTMLInputElement).blur();
              }
            }}
            placeholder="Search files..."
            style={{
              background: theme.bgInput,
              border: `1px solid ${theme.border}`,
              'border-radius': '4px',
              padding: '4px 8px',
              color: theme.fg,
              'font-size': sf(11),
              outline: 'none',
              'box-sizing': 'border-box',
              width: '100%',
            }}
          />

          {/* Search results or tree view */}
          <Show
            when={!searchQuery().trim()}
            fallback={
              <div
                style={{
                  display: 'flex',
                  'flex-direction': 'column',
                  overflow: 'auto',
                  'flex-shrink': '1',
                  'min-height': '0',
                }}
              >
                <Show when={searchingFlag()}>
                  <div style={{ 'font-size': sf(11), color: theme.fgSubtle, padding: '4px' }}>
                    Searching...
                  </div>
                </Show>
                <Show when={!searchingFlag() && searchResults().length === 0}>
                  <div style={{ 'font-size': sf(11), color: theme.fgSubtle, padding: '4px' }}>
                    No files found
                  </div>
                </Show>
                <For each={searchResults()}>
                  {(pr) => (
                    <For each={pr.results}>
                      {(item) => (
                        <div
                          onClick={() => {
                            if (!item.isDirectory) {
                              openFileViewer(
                                `${pr.projectPath}/${item.relativePath}`,
                                pr.projectPath,
                              );
                            }
                          }}
                          style={{
                            display: 'flex',
                            'align-items': 'center',
                            gap: '4px',
                            padding: '3px 4px',
                            cursor: item.isDirectory ? 'default' : 'pointer',
                            'border-radius': '4px',
                            'font-size': sf(12),
                            color: theme.fg,
                            opacity: item.isDirectory ? '0.5' : '1',
                            'white-space': 'nowrap',
                            overflow: 'hidden',
                            'text-overflow': 'ellipsis',
                          }}
                          onMouseEnter={(e) => {
                            if (!item.isDirectory)
                              (e.currentTarget as HTMLElement).style.background = theme.bgHover;
                          }}
                          onMouseLeave={(e) => {
                            (e.currentTarget as HTMLElement).style.background = 'transparent';
                          }}
                        >
                          <span
                            style={{ 'flex-shrink': '0', display: 'flex', 'align-items': 'center' }}
                          >
                            {item.isDirectory ? <FolderIcon /> : <FileIcon />}
                          </span>
                          <span
                            style={{
                              overflow: 'hidden',
                              'text-overflow': 'ellipsis',
                              flex: '1',
                              'min-width': '0',
                            }}
                          >
                            {item.relativePath}
                          </span>
                        </div>
                      )}
                    </For>
                  )}
                </For>
              </div>
            }
          >
            <div
              style={{
                display: 'flex',
                'flex-direction': 'column',
                overflow: 'auto',
                'flex-shrink': '1',
                'min-height': '0',
              }}
            >
              <Show when={store.projects.length === 0}>
                <span style={{ 'font-size': sf(11), color: theme.fgSubtle, padding: '0 2px' }}>
                  No projects linked yet.
                </span>
              </Show>
              <For each={store.projects}>
                {(project) => (
                  <ProjectFileTree
                    project={project}
                    onRemove={(id) => setConfirmRemove(id)}
                    onEdit={(p) => setEditingProject(p)}
                  />
                )}
              </For>
            </div>
          </Show>
        </Show>
      </div>

      {/* Context menu */}
      <Show when={contextMenu()}>
        {(menu) => (
          <ContextMenu
            items={menu().items}
            position={{ x: menu().x, y: menu().y }}
            onClose={() => setContextMenu(null)}
          />
        )}
      </Show>

      {/* Edit project dialog */}
      <EditProjectDialog project={editingProject()} onClose={() => setEditingProject(null)} />

      {/* Confirm remove project dialog */}
      {(() => {
        const id = confirmRemove();
        const taskCount = id
          ? [...store.taskOrder, ...store.collapsedTaskOrder].filter(
              (tid) => store.tasks[tid]?.projectId === id,
            ).length
          : 0;
        return (
          <ConfirmDialog
            open={id !== null}
            title="Remove project?"
            message={
              taskCount > 0
                ? `This project has ${taskCount} open task(s). Removing it will also close all tasks, delete their worktrees and branches.`
                : 'Are you sure you want to remove this project?'
            }
            confirmLabel={taskCount > 0 ? 'Remove all' : 'Remove'}
            danger
            onConfirm={() => {
              if (id) {
                if (taskCount > 0) {
                  removeProjectWithTasks(id);
                } else {
                  removeProject(id);
                }
              }
              setConfirmRemove(null);
            }}
            onCancel={() => setConfirmRemove(null)}
          />
        );
      })()}
    </>
  );
}
