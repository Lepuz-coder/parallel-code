import { createSignal, createEffect, onCleanup, For, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { store } from '../store/core';
import { openFileViewer, toggleQuickFileOpen } from '../store/store';
import { invoke } from '../lib/ipc';
import { IPC } from '../../electron/ipc/channels';
import { theme } from '../lib/theme';
import { sf } from '../lib/fontScale';

interface SearchResult {
  relativePath: string;
  isDirectory: boolean;
}

interface ProjectResult {
  projectName: string;
  projectPath: string;
  results: SearchResult[];
}

export function QuickFileOpen() {
  const [query, setQuery] = createSignal('');
  const [results, setResults] = createSignal<ProjectResult[]>([]);
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [searching, setSearching] = createSignal(false);
  let inputRef: HTMLInputElement | undefined;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  // Focus input when opened
  createEffect(() => {
    if (store.showQuickFileOpen) {
      setQuery('');
      setResults([]);
      setSelectedIndex(0);
      requestAnimationFrame(() => inputRef?.focus());
    }
  });

  // Active projects (those with tasks)
  const activeProjects = () => {
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
  };

  // Flat list for keyboard navigation
  const flatResults = () => {
    const flat: {
      relativePath: string;
      projectPath: string;
      projectName: string;
      isDirectory: boolean;
    }[] = [];
    for (const pr of results()) {
      for (const r of pr.results) {
        flat.push({
          relativePath: r.relativePath,
          projectPath: pr.projectPath,
          projectName: pr.projectName,
          isDirectory: r.isDirectory,
        });
      }
    }
    return flat;
  };

  async function doSearch(q: string): Promise<void> {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    setSearching(true);
    const projects = activeProjects();
    const allResults: ProjectResult[] = [];

    for (const project of projects) {
      try {
        const res = await invoke<SearchResult[]>(IPC.SearchFiles, {
          rootPath: project.path,
          query: q.trim(),
        });
        if (res.length > 0) {
          allResults.push({
            projectName: project.name,
            projectPath: project.path,
            results: res,
          });
        }
      } catch (err) {
        console.error('Search failed for', project.name, err);
      }
    }
    setResults(allResults);
    setSelectedIndex(0);
    setSearching(false);
  }

  function handleInput(value: string): void {
    setQuery(value);
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => doSearch(value), 200);
  }

  function handleSelect(projectPath: string, relativePath: string): void {
    const fullPath = `${projectPath}/${relativePath}`;
    openFileViewer(fullPath, projectPath);
    toggleQuickFileOpen(false);
  }

  function handleKeyDown(e: KeyboardEvent): void {
    const flat = flatResults();
    if (e.key === 'Escape') {
      e.preventDefault();
      toggleQuickFileOpen(false);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, flat.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = flat[selectedIndex()];
      if (item && !item.isDirectory) {
        handleSelect(item.projectPath, item.relativePath);
      }
    }
  }

  onCleanup(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
  });

  return (
    <Portal>
      <Show when={store.showQuickFileOpen}>
        <div
          style={{
            position: 'fixed',
            inset: '0',
            'z-index': '1100',
            display: 'flex',
            'justify-content': 'center',
            'padding-top': '15vh',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) toggleQuickFileOpen(false);
          }}
        >
          <div
            style={{
              width: '500px',
              'max-height': '400px',
              background: theme.islandBg,
              border: `1px solid ${theme.border}`,
              'border-radius': '12px',
              'box-shadow': '0 12px 48px rgba(0,0,0,0.5)',
              display: 'flex',
              'flex-direction': 'column',
              overflow: 'hidden',
              'align-self': 'flex-start',
            }}
            onKeyDown={handleKeyDown}
          >
            {/* Search input */}
            <div
              style={{
                padding: '12px',
                'border-bottom': `1px solid ${theme.border}`,
              }}
            >
              <input
                ref={inputRef}
                type="text"
                value={query()}
                onInput={(e) => handleInput(e.currentTarget.value)}
                placeholder="Type to search files..."
                style={{
                  width: '100%',
                  background: theme.bgInput,
                  border: `1px solid ${theme.border}`,
                  'border-radius': '6px',
                  padding: '8px 12px',
                  color: theme.fg,
                  'font-size': sf(13),
                  'font-family': "'JetBrains Mono', monospace",
                  outline: 'none',
                  'box-sizing': 'border-box',
                }}
                onFocus={(e) => {
                  (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-focus)';
                }}
                onBlur={(e) => {
                  (e.currentTarget as HTMLElement).style.borderColor = theme.border;
                }}
              />
            </div>

            {/* Results */}
            <div style={{ overflow: 'auto', flex: '1' }}>
              <Show when={searching()}>
                <div
                  style={{
                    padding: '12px 16px',
                    color: theme.fgMuted,
                    'font-size': sf(12),
                  }}
                >
                  Searching...
                </div>
              </Show>

              <Show when={!searching() && query().trim() && flatResults().length === 0}>
                <div
                  style={{
                    padding: '12px 16px',
                    color: theme.fgMuted,
                    'font-size': sf(12),
                  }}
                >
                  No files found
                </div>
              </Show>

              <Show when={!searching() && flatResults().length > 0}>
                {(() => {
                  let globalIdx = 0;
                  return (
                    <For each={results()}>
                      {(pr) => (
                        <div>
                          <For each={pr.results}>
                            {(item) => {
                              const idx = globalIdx++;
                              const isSelected = () => selectedIndex() === idx;
                              return (
                                <div
                                  onClick={() => {
                                    if (!item.isDirectory) {
                                      handleSelect(pr.projectPath, item.relativePath);
                                    }
                                  }}
                                  style={{
                                    display: 'flex',
                                    'align-items': 'center',
                                    gap: '8px',
                                    padding: '6px 16px',
                                    cursor: item.isDirectory ? 'default' : 'pointer',
                                    background: isSelected() ? theme.bgSelected : 'transparent',
                                    opacity: item.isDirectory ? '0.5' : '1',
                                  }}
                                  onMouseEnter={() => setSelectedIndex(idx)}
                                >
                                  {/* Icon */}
                                  <svg
                                    width="14"
                                    height="14"
                                    viewBox="0 0 16 16"
                                    fill={item.isDirectory ? theme.fgMuted : theme.fgSubtle}
                                    style={{ 'flex-shrink': '0' }}
                                  >
                                    {item.isDirectory ? (
                                      <path d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.22.78 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2A1.75 1.75 0 0 0 5 1H1.75Z" />
                                    ) : (
                                      <path d="M3.75 1.5a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25V6H9.75A1.75 1.75 0 0 1 8 4.25V1.5H3.75Zm5.75.56v2.19c0 .138.112.25.25.25h2.19L9.5 2.06ZM2 1.75C2 .784 2.784 0 3.75 0h5.086c.464 0 .909.184 1.237.513l3.414 3.414c.329.328.513.773.513 1.237v9.086A1.75 1.75 0 0 1 12.25 16h-8.5A1.75 1.75 0 0 1 2 14.25V1.75Z" />
                                    )}
                                  </svg>
                                  {/* Path */}
                                  <span
                                    style={{
                                      flex: '1',
                                      'font-size': sf(12),
                                      color: theme.fg,
                                      overflow: 'hidden',
                                      'text-overflow': 'ellipsis',
                                      'white-space': 'nowrap',
                                    }}
                                  >
                                    {item.relativePath}
                                  </span>
                                  {/* Project name */}
                                  <span
                                    style={{
                                      'font-size': sf(10),
                                      color: theme.fgSubtle,
                                      'flex-shrink': '0',
                                    }}
                                  >
                                    {pr.projectName}
                                  </span>
                                </div>
                              );
                            }}
                          </For>
                        </div>
                      )}
                    </For>
                  );
                })()}
              </Show>
            </div>
          </div>
        </div>
      </Show>
    </Portal>
  );
}
