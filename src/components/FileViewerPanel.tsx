import { createEffect, createSignal, onCleanup, Show } from 'solid-js';
import { store } from '../store/core';
import { closeFileViewer } from '../store/store';
import { invoke } from '../lib/ipc';
import { IPC } from '../../electron/ipc/channels';
import { MonacoDiffEditor } from './MonacoDiffEditor';
import { theme } from '../lib/theme';
import { sf } from '../lib/fontScale';

interface FileContentResult {
  content: string | null;
  truncated: boolean;
  totalSize: number;
  binary: boolean;
}

function relativePath(filePath: string, projectPath: string): string {
  if (filePath.startsWith(projectPath)) {
    const rel = filePath.slice(projectPath.length);
    return rel.startsWith('/') ? rel.slice(1) : rel;
  }
  return filePath;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function detectLanguage(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
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
}

export function FileViewerPanel() {
  const [content, setContent] = createSignal<FileContentResult | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [copied, setCopied] = createSignal(false);
  const [dirty, setDirty] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [savedFeedback, setSavedFeedback] = createSignal(false);
  let editorContainerRef: HTMLDivElement | undefined;
  let editorInstance: import('monaco-editor').editor.IStandaloneCodeEditor | undefined;
  let originalContent = '';

  const file = () => store.fileViewerFile;
  const relPath = () => {
    const f = file();
    return f ? relativePath(f.filePath, f.projectPath) : '';
  };
  const fileName = () => {
    const f = file();
    if (!f) return '';
    const parts = f.filePath.split('/');
    return parts[parts.length - 1] || '';
  };

  const isDiffMode = () => !!file()?.diffMode;

  // Load file content when fileViewerFile changes (skip in diff mode)
  createEffect(() => {
    const f = file();
    if (!f) {
      setContent(null);
      setDirty(false);
      originalContent = '';
      if (editorInstance) {
        editorInstance.dispose();
        editorInstance = undefined;
      }
      return;
    }
    if (f.diffMode) {
      // Diff mode — no file loading needed, content comes from diffMode
      setLoading(false);
      setContent(null);
      setDirty(false);
      return;
    }
    setLoading(true);
    setContent(null);
    setDirty(false);
    invoke<FileContentResult>(IPC.ReadFileContent, { filePath: f.filePath })
      .then((result) => {
        originalContent = result.content ?? '';
        setContent(result);
      })
      .catch((err) => {
        console.error('Failed to read file:', err);
        setContent({ content: null, truncated: false, totalSize: 0, binary: false });
      })
      .finally(() => setLoading(false));
  });

  async function setupEditor(result: FileContentResult): Promise<void> {
    if (!editorContainerRef || !result.content) return;
    const monaco = await import('monaco-editor');
    const { monacoThemeName } = await import('../lib/monaco-theme');

    if (editorInstance) {
      editorInstance.dispose();
    }

    // Disable built-in JS/TS diagnostics
    try {
      const ts = (monaco.languages as Record<string, unknown>).typescript as
        | {
            typescriptDefaults?: { setDiagnosticsOptions: (o: Record<string, boolean>) => void };
            javascriptDefaults?: { setDiagnosticsOptions: (o: Record<string, boolean>) => void };
          }
        | undefined;
      ts?.typescriptDefaults?.setDiagnosticsOptions({
        noSemanticValidation: true,
        noSyntaxValidation: true,
      });
      ts?.javascriptDefaults?.setDiagnosticsOptions({
        noSemanticValidation: true,
        noSyntaxValidation: true,
      });
    } catch {
      // ignore if not available
    }

    editorInstance = monaco.editor.create(editorContainerRef, {
      value: result.content,
      language: detectLanguage(fileName()),
      theme: monacoThemeName(store.themePreset),
      readOnly: false,
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

    // Track dirty state
    editorInstance.onDidChangeModelContent(() => {
      const current = editorInstance?.getValue() ?? '';
      setDirty(current !== originalContent);
    });

    // Cmd+S / Ctrl+S to save
    editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      saveFile();
    });
  }

  async function saveFile(): Promise<void> {
    const f = file();
    if (!f || !editorInstance || saving()) return;

    const newContent = editorInstance.getValue();
    setSaving(true);
    try {
      await invoke(IPC.WriteFileContent, { filePath: f.filePath, content: newContent });
      originalContent = newContent;
      setDirty(false);
      setSavedFeedback(true);
      setTimeout(() => setSavedFeedback(false), 1500);
    } catch (err) {
      console.error('Failed to save file:', err);
    } finally {
      setSaving(false);
    }
  }

  // Global Cmd+S handler for when focus is outside the Monaco editor
  function handleKeyDown(e: KeyboardEvent): void {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      e.stopPropagation();
      saveFile();
    }
  }

  onCleanup(() => {
    if (editorInstance) {
      editorInstance.dispose();
      editorInstance = undefined;
    }
  });

  return (
    <div
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      style={{
        height: '100%',
        display: 'flex',
        'flex-direction': 'column',
        background: theme.islandBg,
        'border-radius': 'var(--island-radius, 12px)',
        border: `1px solid ${theme.islandBorder}`,
        overflow: 'hidden',
        outline: 'none',
      }}
    >
      {/* Title bar */}
      <div
        style={{
          display: 'flex',
          'align-items': 'center',
          gap: '8px',
          padding: '8px 12px',
          'border-bottom': `1px solid ${theme.border}`,
          'flex-shrink': '0',
          height: '42px',
          'box-sizing': 'border-box',
        }}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill={theme.fgSubtle}>
          <path d="M3.75 1.5a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25V6H9.75A1.75 1.75 0 0 1 8 4.25V1.5H3.75Zm5.75.56v2.19c0 .138.112.25.25.25h2.19L9.5 2.06ZM2 1.75C2 .784 2.784 0 3.75 0h5.086c.464 0 .909.184 1.237.513l3.414 3.414c.329.328.513.773.513 1.237v9.086A1.75 1.75 0 0 1 12.25 16h-8.5A1.75 1.75 0 0 1 2 14.25V1.75Z" />
        </svg>
        <span
          style={{
            flex: '1',
            'font-size': sf(12),
            color: theme.fg,
            'font-family': "'JetBrains Mono', monospace",
            overflow: 'hidden',
            'text-overflow': 'ellipsis',
            'white-space': 'nowrap',
          }}
        >
          {isDiffMode() ? 'Diff: ' : ''}
          {relPath()}
          <Show when={dirty()}>
            <span style={{ color: theme.fgMuted }}> (unsaved)</span>
          </Show>
        </span>

        {/* Save button (hidden in diff mode) */}
        <Show when={!isDiffMode()}>
          <button
            onClick={() => {
              if (dirty()) saveFile();
            }}
            style={{
              background: savedFeedback() ? 'transparent' : dirty() ? theme.accent : 'transparent',
              border: `1px solid ${savedFeedback() ? theme.success : dirty() ? theme.accent : theme.border}`,
              'border-radius': '4px',
              color: savedFeedback() ? theme.success : dirty() ? theme.accentText : theme.fgSubtle,
              cursor: dirty() ? 'pointer' : 'default',
              padding: '2px 6px',
              'font-size': sf(10),
              'flex-shrink': '0',
              transition: 'all 0.2s',
              opacity: !dirty() && !savedFeedback() ? '0.5' : '1',
            }}
            title="Save file (Cmd+S)"
          >
            {saving() ? 'Saving...' : savedFeedback() ? 'Saved!' : 'Save'}
          </button>
        </Show>

        {/* Copy path button */}
        <button
          onClick={() => {
            navigator.clipboard
              .writeText(relPath())
              .then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              })
              .catch(() => {});
          }}
          style={{
            background: 'transparent',
            border: `1px solid ${copied() ? theme.success : theme.border}`,
            'border-radius': '4px',
            color: copied() ? theme.success : theme.fgMuted,
            cursor: 'pointer',
            padding: '2px 6px',
            'font-size': sf(10),
            'flex-shrink': '0',
            transition: 'color 0.2s, border-color 0.2s',
          }}
          title="Copy relative path"
        >
          {copied() ? 'Copied!' : 'Copy Relative Path'}
        </button>

        {/* Close button */}
        <button
          onClick={() => closeFileViewer()}
          style={{
            background: 'transparent',
            border: 'none',
            color: theme.fgSubtle,
            cursor: 'pointer',
            'font-size': '16px',
            'line-height': '1',
            padding: '0 2px',
            'flex-shrink': '0',
          }}
          title="Close file viewer"
        >
          &times;
        </button>
      </div>

      {/* Truncation banner */}
      <Show when={content()?.truncated}>
        <div
          style={{
            padding: '4px 12px',
            background: `color-mix(in srgb, ${theme.warning} 10%, ${theme.bgElevated})`,
            'font-size': sf(11),
            color: theme.warning,
            'border-bottom': `1px solid ${theme.border}`,
            'flex-shrink': '0',
          }}
        >
          File truncated to 1 MB (total: {formatSize(content()?.totalSize ?? 0)})
        </div>
      </Show>

      {/* Content */}
      <div style={{ flex: '1', 'min-height': '0', overflow: 'hidden' }}>
        {/* Diff mode */}
        <Show when={isDiffMode() && file()?.diffMode}>
          {(dm) => (
            <MonacoDiffEditor
              oldContent={dm().oldContent}
              newContent={dm().newContent}
              language={dm().language}
              sideBySide={true}
            />
          )}
        </Show>

        {/* Normal file mode */}
        <Show when={!isDiffMode()}>
          <Show when={loading()}>
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

          <Show when={!loading() && content()?.binary}>
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

          <Show when={!loading() && content() && !content()?.binary}>
            <div
              ref={(el) => {
                editorContainerRef = el;
                const c = content();
                if (c?.content) setupEditor(c);
              }}
              style={{ width: '100%', height: '100%' }}
            />
          </Show>
        </Show>
      </div>
    </div>
  );
}
