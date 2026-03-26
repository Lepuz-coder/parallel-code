import { createSignal, createMemo, For, Show, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import { store } from '../store/core';
import type { Project } from '../store/types';
import { invoke } from '../lib/ipc';
import { IPC } from '../../electron/ipc/channels';
import { theme } from '../lib/theme';
import { sf } from '../lib/fontScale';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';

interface DirEntry {
  name: string;
  isDirectory: boolean;
  size: number;
}

interface FileContentResult {
  content: string | null;
  truncated: boolean;
  totalSize: number;
  binary: boolean;
}

// Ephemeral state: directory cache and expanded paths
const [dirCache, setDirCache] = createSignal<Record<string, DirEntry[]>>({});
const [expandedPaths, setExpandedPaths] = createSignal<Record<string, boolean>>({});
const [loadingPaths, setLoadingPaths] = createSignal<Record<string, boolean>>({});

// File viewer state
const [viewerFile, setViewerFile] = createSignal<{
  filePath: string;
  projectPath: string;
} | null>(null);
const [viewerContent, setViewerContent] = createSignal<FileContentResult | null>(null);
const [viewerLoading, setViewerLoading] = createSignal(false);

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

async function openFile(filePath: string, projectPath: string): Promise<void> {
  setViewerFile({ filePath, projectPath });
  setViewerLoading(true);
  setViewerContent(null);
  try {
    const result = await invoke<FileContentResult>(IPC.ReadFileContent, { filePath });
    setViewerContent(result);
  } catch (err) {
    console.error('Failed to read file:', err);
    setViewerContent({ content: null, truncated: false, totalSize: 0, binary: false });
  } finally {
    setViewerLoading(false);
  }
}

function closeViewer(): void {
  setViewerFile(null);
  setViewerContent(null);
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

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// --- Icons ---
function ChevronRight(): JSX.Element {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
      <path d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z" />
    </svg>
  );
}

function ChevronDown(): JSX.Element {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
      <path d="M12.78 6.22a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L3.22 7.28a.75.75 0 0 1 1.06-1.06L8 9.94l3.72-3.72a.75.75 0 0 1 1.06 0Z" />
    </svg>
  );
}

function FolderIcon(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill={theme.fgMuted}>
      <path d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.22.78 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2A1.75 1.75 0 0 0 5 1H1.75Z" />
    </svg>
  );
}

function FolderOpenIcon(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill={theme.accent}>
      <path d="M.513 1.513A1.75 1.75 0 0 1 1.75 1h3.5c.55 0 1.07.26 1.4.7l.9 1.2a.25.25 0 0 0 .2.1h6.5A1.75 1.75 0 0 1 16 4.75v.462a.75.75 0 0 1-.03.07L14.28 14.2a1.75 1.75 0 0 1-1.7 1.3H3.42a1.75 1.75 0 0 1-1.7-1.3L.084 5.382A.75.75 0 0 1 0 5.08V2.75c0-.464.184-.91.513-1.237Z" />
    </svg>
  );
}

function FileIcon(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill={theme.fgSubtle}>
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
      openFile(fullPath(), props.projectPath);
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
          'font-size': sf(11),
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
            width: '12px',
            height: '12px',
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
                'font-size': sf(10),
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
                'font-size': sf(10),
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
function ProjectFileTree(props: { project: Project }) {
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
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.background = 'transparent';
        }}
      >
        <span
          style={{
            width: '12px',
            height: '12px',
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
          style={{
            overflow: 'hidden',
            'text-overflow': 'ellipsis',
            'white-space': 'nowrap',
            flex: '1',
            'min-width': '0',
          }}
        >
          {props.project.name}
        </span>
      </div>

      {/* Children */}
      <Show when={isExpanded()}>
        <Show
          when={!isLoading()}
          fallback={
            <div
              style={{
                'padding-left': '32px',
                'font-size': sf(10),
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

  // Only show projects that have active or collapsed tasks
  const activeProjects = createMemo(() => {
    const projectIdsWithTasks = new Set<string>();
    for (const taskId of store.taskOrder) {
      const task = store.tasks[taskId];
      if (task) projectIdsWithTasks.add(task.projectId);
    }
    for (const taskId of store.collapsedTaskOrder) {
      const task = store.tasks[taskId];
      if (task) projectIdsWithTasks.add(task.projectId);
    }
    return store.projects.filter((p) => projectIdsWithTasks.has(p.id));
  });

  return (
    <Show when={activeProjects().length > 0}>
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
            Explorer
          </label>
        </div>

        <Show when={!collapsed()}>
          <div
            style={{
              display: 'flex',
              'flex-direction': 'column',
              overflow: 'auto',
              'flex-shrink': '1',
              'min-height': '0',
            }}
          >
            <For each={activeProjects()}>{(project) => <ProjectFileTree project={project} />}</For>
          </div>
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

      {/* File Viewer Dialog */}
      <Show when={viewerFile()}>
        {(file) => (
          <FileViewerOverlay
            filePath={file().filePath}
            projectPath={file().projectPath}
            content={viewerContent()}
            loading={viewerLoading()}
            onClose={closeViewer}
          />
        )}
      </Show>
    </Show>
  );
}

// --- Inline File Viewer (dialog overlay) ---
function FileViewerOverlay(props: {
  filePath: string;
  projectPath: string;
  content: FileContentResult | null;
  loading: boolean;
  onClose: () => void;
}) {
  const relPath = () => relativePath(props.filePath, props.projectPath);
  const fileName = () => {
    const parts = props.filePath.split('/');
    return parts[parts.length - 1] || props.filePath;
  };

  // Detect language from file extension
  const language = () => {
    const ext = fileName().split('.').pop()?.toLowerCase() ?? '';
    const langMap: Record<string, string> = {
      ts: 'typescript',
      tsx: 'typescript',
      js: 'javascript',
      jsx: 'javascript',
      json: 'json',
      html: 'html',
      css: 'css',
      scss: 'scss',
      less: 'less',
      md: 'markdown',
      py: 'python',
      rs: 'rust',
      go: 'go',
      java: 'java',
      c: 'c',
      cpp: 'cpp',
      h: 'c',
      hpp: 'cpp',
      sh: 'shell',
      bash: 'shell',
      zsh: 'shell',
      yaml: 'yaml',
      yml: 'yaml',
      toml: 'toml',
      xml: 'xml',
      svg: 'xml',
      sql: 'sql',
      graphql: 'graphql',
      dockerfile: 'dockerfile',
      makefile: 'makefile',
    };
    return langMap[ext] || 'plaintext';
  };

  let editorContainerRef: HTMLDivElement | undefined;
  let editorInstance: import('monaco-editor').editor.IStandaloneCodeEditor | undefined;

  const setupEditor = async () => {
    if (!editorContainerRef || !props.content?.content) return;
    const monaco = await import('monaco-editor');
    const { monacoThemeName } = await import('../lib/monaco-theme');

    if (editorInstance) {
      editorInstance.dispose();
    }

    editorInstance = monaco.editor.create(editorContainerRef, {
      value: props.content.content,
      language: language(),
      theme: monacoThemeName(store.themePreset),
      readOnly: true,
      automaticLayout: true,
      fontSize: 12,
      fontFamily: "'JetBrains Mono', monospace",
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      overviewRulerLanes: 0,
      stickyScroll: { enabled: false },
      lineNumbers: 'on',
      wordWrap: 'on',
    });
  };

  // Setup editor when content arrives
  const checkAndSetup = () => {
    if (props.content?.content && editorContainerRef) {
      setupEditor();
    }
  };

  return (
    <Portal>
      <div
        style={{
          position: 'fixed',
          inset: '0',
          display: 'flex',
          'align-items': 'center',
          'justify-content': 'center',
          background: 'rgba(0,0,0,0.55)',
          'z-index': '1000',
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) props.onClose();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') props.onClose();
        }}
      >
        <div
          style={{
            background: theme.islandBg,
            border: `1px solid ${theme.border}`,
            'border-radius': '14px',
            width: '80vw',
            'max-width': '1000px',
            height: '70vh',
            display: 'flex',
            'flex-direction': 'column',
            overflow: 'hidden',
            'box-shadow': '0 12px 48px rgba(0,0,0,0.5)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div
            style={{
              display: 'flex',
              'align-items': 'center',
              gap: '8px',
              padding: '12px 16px',
              'border-bottom': `1px solid ${theme.border}`,
              'flex-shrink': '0',
            }}
          >
            <FileIcon />
            <span
              style={{
                flex: '1',
                'font-size': sf(13),
                color: theme.fg,
                'font-family': "'JetBrains Mono', monospace",
                overflow: 'hidden',
                'text-overflow': 'ellipsis',
                'white-space': 'nowrap',
              }}
            >
              {relPath()}
            </span>
            <button
              onClick={() => copyRelativePath(props.filePath, props.projectPath)}
              style={{
                background: 'transparent',
                border: `1px solid ${theme.border}`,
                'border-radius': '6px',
                color: theme.fgMuted,
                cursor: 'pointer',
                padding: '4px 8px',
                'font-size': sf(11),
                'flex-shrink': '0',
              }}
              title="Copy relative path"
            >
              Copy Path
            </button>
            <button
              onClick={() => props.onClose()}
              style={{
                background: 'transparent',
                border: 'none',
                color: theme.fgSubtle,
                cursor: 'pointer',
                'font-size': '18px',
                'line-height': '1',
                padding: '2px 4px',
                'flex-shrink': '0',
              }}
            >
              &times;
            </button>
          </div>

          {/* Truncation banner */}
          <Show when={props.content?.truncated}>
            <div
              style={{
                padding: '6px 16px',
                background: `color-mix(in srgb, ${theme.warning} 10%, ${theme.bgElevated})`,
                'font-size': sf(11),
                color: theme.warning,
                'border-bottom': `1px solid ${theme.border}`,
                'flex-shrink': '0',
              }}
            >
              File truncated to 1 MB (total: {formatSize(props.content?.totalSize ?? 0)})
            </div>
          </Show>

          {/* Content */}
          <div style={{ flex: '1', 'min-height': '0', overflow: 'hidden' }}>
            <Show when={props.loading}>
              <div
                style={{
                  display: 'flex',
                  'align-items': 'center',
                  'justify-content': 'center',
                  height: '100%',
                  color: theme.fgMuted,
                  'font-size': sf(13),
                }}
              >
                Loading...
              </div>
            </Show>

            <Show when={!props.loading && props.content?.binary}>
              <div
                style={{
                  display: 'flex',
                  'align-items': 'center',
                  'justify-content': 'center',
                  height: '100%',
                  color: theme.fgMuted,
                  'font-size': sf(13),
                }}
              >
                Binary file — cannot display
              </div>
            </Show>

            <Show when={!props.loading && props.content && !props.content.binary}>
              <div
                ref={(el) => {
                  editorContainerRef = el;
                  checkAndSetup();
                }}
                style={{ width: '100%', height: '100%' }}
              />
            </Show>
          </div>
        </div>
      </div>
    </Portal>
  );
}
