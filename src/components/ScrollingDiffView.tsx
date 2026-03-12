import { For, Show, createSignal, createEffect, onMount, onCleanup } from 'solid-js';
import type { JSX } from 'solid-js';
import { theme } from '../lib/theme';
import { sf } from '../lib/fontScale';
import { getStatusColor } from '../lib/status-colors';
import { openFileInEditor } from '../lib/shell';
import { highlightLines, detectLang } from '../lib/shiki-highlighter';
import { invoke } from '../lib/ipc';
import { IPC } from '../../electron/ipc/channels';
import type { FileDiff, Hunk, DiffLine } from '../lib/unified-diff-parser';
import type { FileDiffResult } from '../ipc/types';

interface ScrollingDiffViewProps {
  files: FileDiff[];
  scrollToPath: string | null;
  worktreePath: string;
  searchQuery?: string;
}

const STATUS_LABELS: Record<string, string> = {
  M: 'Modified',
  A: 'Added',
  D: 'Deleted',
};

const LINE_BG: Record<DiffLine['type'], string> = {
  add: 'rgba(47, 209, 152, 0.10)',
  remove: 'rgba(255, 95, 115, 0.10)',
  context: 'transparent',
};

const INDICATOR: Record<DiffLine['type'], string> = {
  add: '+',
  remove: '-',
  context: ' ',
};

function indicatorColor(type: DiffLine['type']): string {
  if (type === 'add') return theme.success;
  if (type === 'remove') return theme.error;
  return theme.fgSubtle;
}

// ---------------------------------------------------------------------------
// Search highlight helpers
// ---------------------------------------------------------------------------

function highlightSearchMatches(text: string, query: string | undefined): JSX.Element {
  if (!query || query.length === 0) return <>{text}</>;
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const parts: JSX.Element[] = [];
  let lastIdx = 0;
  let idx = lowerText.indexOf(lowerQuery);
  while (idx !== -1) {
    if (idx > lastIdx) parts.push(<>{text.slice(lastIdx, idx)}</>);
    parts.push(
      <mark
        style={{ background: 'rgba(255, 200, 50, 0.35)', color: 'inherit', 'border-radius': '2px' }}
      >
        {text.slice(idx, idx + query.length)}
      </mark>,
    );
    lastIdx = idx + query.length;
    idx = lowerText.indexOf(lowerQuery, lastIdx);
  }
  if (lastIdx < text.length) parts.push(<>{text.slice(lastIdx)}</>);
  return <>{parts}</>;
}

function highlightSearchInHtml(html: string, query: string | undefined): string {
  if (!query || query.length === 0) return html;
  const lowerQuery = query.toLowerCase();
  // Split HTML into tags and text segments, only replace in text segments
  return html.replace(/([^<>]+)|(<[^>]*>)/g, (_match, text, tag) => {
    if (tag) return tag; // keep HTML tags unchanged
    const lowerText = (text as string).toLowerCase();
    let result = '';
    let lastIdx = 0;
    let idx = lowerText.indexOf(lowerQuery);
    while (idx !== -1) {
      result += (text as string).slice(lastIdx, idx);
      result += `<mark style="background:rgba(255,200,50,0.35);color:inherit;border-radius:2px">${(text as string).slice(idx, idx + query.length)}</mark>`;
      lastIdx = idx + query.length;
      idx = lowerText.indexOf(lowerQuery, lastIdx);
    }
    result += (text as string).slice(lastIdx);
    return result;
  });
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function DiffLineView(props: {
  line: DiffLine;
  highlightedHtml: string | null;
  searchQuery?: string;
}) {
  return (
    <div
      style={{
        display: 'grid',
        'grid-template-columns': '40px 40px 1rem 1fr',
        background: LINE_BG[props.line.type],
        'font-family': "'JetBrains Mono', monospace",
        'font-size': sf(12),
        'line-height': '1.5',
      }}
    >
      {/* Old line number */}
      <span
        style={{
          'text-align': 'right',
          color: theme.fgSubtle,
          'font-size': sf(11),
          'user-select': 'none',
          padding: '0 4px',
        }}
      >
        {props.line.oldLine ?? ''}
      </span>

      {/* New line number */}
      <span
        style={{
          'text-align': 'right',
          color: theme.fgSubtle,
          'font-size': sf(11),
          'user-select': 'none',
          padding: '0 4px',
        }}
      >
        {props.line.newLine ?? ''}
      </span>

      {/* Indicator (+/-/space) */}
      <span
        style={{
          'text-align': 'center',
          color: indicatorColor(props.line.type),
          'font-weight': '600',
          'user-select': 'none',
        }}
      >
        {INDICATOR[props.line.type]}
      </span>

      {/* Code content */}
      {props.highlightedHtml ? (
        <span
          style={{
            'white-space': 'pre',
            'overflow-x': 'auto',
            'padding-right': '8px',
          }}
          // eslint-disable-next-line solid/no-innerhtml -- HTML from our own Shiki highlighter, safe
          innerHTML={highlightSearchInHtml(props.highlightedHtml, props.searchQuery)}
        />
      ) : (
        <span
          style={{
            'white-space': 'pre',
            'overflow-x': 'auto',
            'padding-right': '8px',
          }}
        >
          {highlightSearchMatches(props.line.content, props.searchQuery)}
        </span>
      )}
    </div>
  );
}

function HunkView(props: { hunk: Hunk; lang: string; searchQuery?: string }) {
  const [highlighted, setHighlighted] = createSignal<string[] | null>(null);

  onMount(() => {
    const code = props.hunk.lines.map((l) => l.content).join('\n');
    highlightLines(code, props.lang)
      .then((result) => setHighlighted(result))
      .catch(() => {
        /* highlight failure is non-fatal — fallback to plain text */
      });
  });

  return (
    <For each={props.hunk.lines}>
      {(line, i) => (
        <DiffLineView
          line={line}
          highlightedHtml={highlighted()?.[i()] ?? null}
          searchQuery={props.searchQuery}
        />
      )}
    </For>
  );
}

function ExpandableGap(props: {
  prevHunk: Hunk;
  currentHunk: Hunk;
  lang: string;
  worktreePath: string;
  filePath: string;
  searchQuery?: string;
}) {
  const [expanded, setExpanded] = createSignal(false);
  const [lines, setLines] = createSignal<DiffLine[]>([]);
  const [highlighted, setHighlighted] = createSignal<string[] | null>(null);
  const [loading, setLoading] = createSignal(false);

  const hiddenCount = () => {
    const prevEnd = props.prevHunk.newStart + props.prevHunk.newCount;
    return props.currentHunk.newStart - prevEnd;
  };

  async function expand() {
    if (expanded() || loading()) return;
    setLoading(true);
    try {
      const result = await invoke<FileDiffResult>(IPC.GetFileDiff, {
        worktreePath: props.worktreePath,
        filePath: props.filePath,
      });
      const fileLines = result.newContent.split('\n');
      const startLine = props.prevHunk.newStart + props.prevHunk.newCount;
      const endLine = props.currentHunk.newStart;
      const gapLines: DiffLine[] = [];
      for (let n = startLine; n < endLine; n++) {
        gapLines.push({
          type: 'context',
          content: fileLines[n - 1] ?? '',
          oldLine:
            n -
            (props.currentHunk.newStart - props.currentHunk.oldStart) +
            (props.prevHunk.newStart - props.prevHunk.oldStart),
          newLine: n,
        });
      }
      setLines(gapLines);
      setExpanded(true);

      // Highlight expanded lines
      const code = gapLines.map((l) => l.content).join('\n');
      highlightLines(code, props.lang)
        .then(setHighlighted)
        .catch(() => {});
    } catch {
      /* fetch failed — keep collapsed */
    } finally {
      setLoading(false);
    }
  }

  return (
    <Show
      when={expanded()}
      fallback={
        <div
          onClick={expand}
          style={{
            padding: '2px 0',
            'text-align': 'center',
            color: theme.fgSubtle,
            'font-size': sf(11),
            'font-family': "'JetBrains Mono', monospace",
            background: theme.bgElevated,
            'border-top': `1px solid ${theme.borderSubtle}`,
            'border-bottom': `1px solid ${theme.borderSubtle}`,
            'user-select': 'none',
            cursor: hiddenCount() > 0 ? 'pointer' : 'default',
          }}
        >
          {loading()
            ? 'Loading...'
            : hiddenCount() > 0
              ? `${hiddenCount()} lines hidden`
              : '\u00B7\u00B7\u00B7'}
        </div>
      }
    >
      <For each={lines()}>
        {(line, i) => (
          <DiffLineView
            line={line}
            highlightedHtml={highlighted()?.[i()] ?? null}
            searchQuery={props.searchQuery}
          />
        )}
      </For>
    </Show>
  );
}

function FileSection(props: {
  file: FileDiff;
  worktreePath: string;
  ref: (el: HTMLDivElement) => void;
  dimmed: boolean;
  searchQuery?: string;
}) {
  const [collapsed, setCollapsed] = createSignal(false);
  const lang = () => detectLang(props.file.path);
  const added = () =>
    props.file.hunks.reduce((s, h) => s + h.lines.filter((l) => l.type === 'add').length, 0);
  const removed = () =>
    props.file.hunks.reduce((s, h) => s + h.lines.filter((l) => l.type === 'remove').length, 0);

  return (
    <div
      ref={props.ref}
      style={{
        margin: '16px 10px',
        border: `1px solid ${theme.border}`,
        'border-radius': '8px',
        overflow: 'hidden',
        background: theme.bgElevated,
        opacity: props.dimmed ? '0.25' : '0.9',
        transition: 'opacity 5s ease-out',
      }}
    >
      {/* Sticky file header */}
      <div
        onClick={() => setCollapsed(!collapsed())}
        style={{
          position: 'sticky',
          top: '0',
          'z-index': '1',
          display: 'flex',
          'align-items': 'center',
          gap: '8px',
          padding: '3px 10px',
          background: `color-mix(in srgb, ${theme.bgElevated} 96%, white)`,
          'border-bottom': `1px solid ${theme.border}`,
          cursor: 'pointer',
        }}
      >
        {/* Collapse indicator */}
        <span
          style={{
            color: theme.fgSubtle,
            'font-size': sf(11),
            'user-select': 'none',
            transition: 'transform 0.15s',
            transform: collapsed() ? 'rotate(-90deg)' : 'rotate(0deg)',
            display: 'inline-block',
          }}
        >
          ▾
        </span>

        {/* Status badge */}
        <span
          style={{
            'font-size': sf(11),
            'font-weight': '600',
            padding: '2px 8px',
            'border-radius': '4px',
            color: getStatusColor(props.file.status),
            background: 'rgba(255,255,255,0.06)',
          }}
        >
          {STATUS_LABELS[props.file.status] ?? props.file.status}
        </span>

        {/* File path */}
        <span
          style={{
            flex: '1',
            'font-size': sf(12),
            'font-family': "'JetBrains Mono', monospace",
            color: theme.fg,
            overflow: 'hidden',
            'text-overflow': 'ellipsis',
            'white-space': 'nowrap',
          }}
        >
          {props.file.path}
        </span>

        <span
          style={{
            'font-size': sf(11),
            color: theme.success,
            'font-family': "'JetBrains Mono', monospace",
          }}
        >
          +{added()}
        </span>
        <span
          style={{
            'font-size': sf(11),
            color: theme.error,
            'font-family': "'JetBrains Mono', monospace",
          }}
        >
          -{removed()}
        </span>

        {/* Open in editor button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            openFileInEditor(props.worktreePath, props.file.path);
          }}
          disabled={!props.worktreePath}
          style={{
            background: 'transparent',
            border: 'none',
            color: theme.fgMuted,
            cursor: props.worktreePath ? 'pointer' : 'default',
            opacity: props.worktreePath ? '1' : '0.3',
            padding: '4px',
            display: 'flex',
            'align-items': 'center',
            'border-radius': '4px',
          }}
          title="Open in editor"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M3.5 2a1.5 1.5 0 0 0-1.5 1.5v9A1.5 1.5 0 0 0 3.5 14h9a1.5 1.5 0 0 0 1.5-1.5v-3a.75.75 0 0 1 1.5 0v3A3 3 0 0 1 12.5 16h-9A3 3 0 0 1 0 12.5v-9A3 3 0 0 1 3.5 0h3a.75.75 0 0 1 0 1.5h-3ZM10 .75a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0V2.56L8.53 8.53a.75.75 0 0 1-1.06-1.06L13.44 1.5H10.75A.75.75 0 0 1 10 .75Z" />
          </svg>
        </button>
      </div>

      {/* File body */}
      <Show when={!collapsed()}>
        <Show when={props.file.binary}>
          <div
            style={{
              padding: '24px',
              'text-align': 'center',
              color: theme.fgMuted,
              'font-size': sf(12),
            }}
          >
            Binary file — cannot display diff
          </div>
        </Show>

        <Show when={!props.file.binary}>
          <div style={{ 'padding-bottom': '8px', background: 'rgba(0, 0, 0, 0.15)' }}>
            <For each={props.file.hunks}>
              {(hunk, hunkIdx) => (
                <>
                  <Show when={hunkIdx() > 0}>
                    <ExpandableGap
                      prevHunk={props.file.hunks[hunkIdx() - 1]}
                      currentHunk={hunk}
                      lang={lang()}
                      worktreePath={props.worktreePath}
                      filePath={props.file.path}
                      searchQuery={props.searchQuery}
                    />
                  </Show>
                  <HunkView hunk={hunk} lang={lang()} searchQuery={props.searchQuery} />
                </>
              )}
            </For>
          </div>
        </Show>
      </Show>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ScrollingDiffView(props: ScrollingDiffViewProps) {
  const sectionRefs = new Map<string, HTMLDivElement>();
  const [dimOthers, setDimOthers] = createSignal(false);
  let dimTimer: ReturnType<typeof setTimeout> | undefined;
  let containerRef: HTMLDivElement | undefined;

  onCleanup(() => clearTimeout(dimTimer));

  /** Scroll to a file section when scrollToPath changes. */
  createEffect(() => {
    const target = props.scrollToPath;
    if (!target) return;
    clearTimeout(dimTimer);
    setDimOthers(true);
    // Start fade-in on next frame so the browser registers the dimmed state first
    requestAnimationFrame(() => setDimOthers(false));
    // Wait for DOM to settle before scrolling
    requestAnimationFrame(() => {
      const el = sectionRefs.get(target);
      if (el && containerRef) {
        const containerTop = containerRef.getBoundingClientRect().top;
        const elTop = el.getBoundingClientRect().top;
        const scrollPos = elTop - containerTop + containerRef.scrollTop - 50;
        containerRef.scrollTop = Math.max(0, scrollPos);
      }
    });
  });

  /** Scroll to first search match when query changes. */
  createEffect(() => {
    const q = props.searchQuery;
    if (!q) return;
    requestAnimationFrame(() => {
      const mark = containerRef?.querySelector('mark');
      if (mark && containerRef) {
        const containerTop = containerRef.getBoundingClientRect().top;
        const markTop = mark.getBoundingClientRect().top;
        const scrollPos = markTop - containerTop + containerRef.scrollTop - 80;
        containerRef.scrollTop = Math.max(0, scrollPos);
      }
    });
  });

  return (
    <div
      ref={containerRef}
      style={{
        height: '100%',
        'overflow-y': 'auto',
        background: '#000',
      }}
    >
      <For each={props.files}>
        {(file) => (
          <FileSection
            file={file}
            worktreePath={props.worktreePath}
            ref={(el) => sectionRefs.set(file.path, el)}
            dimmed={dimOthers() && file.path !== props.scrollToPath}
            searchQuery={props.searchQuery}
          />
        )}
      </For>

      <Show when={props.files.length === 0}>
        <div
          style={{
            padding: '40px',
            'text-align': 'center',
            color: theme.fgMuted,
            'font-size': sf(12),
          }}
        >
          No changes to display
        </div>
      </Show>
    </div>
  );
}
