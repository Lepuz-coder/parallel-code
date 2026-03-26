import { createSignal, createEffect, Show, onCleanup } from 'solid-js';
import { Dialog } from './Dialog';
import { invoke } from '../lib/ipc';
import { IPC } from '../../electron/ipc/channels';
import {
  store,
  createTask,
  toggleNewTaskDialog,
  loadAgents,
  setPrefillPrompt,
  setDockerAvailable,
  setDockerImage,
} from '../store/store';
import { cleanTaskName } from '../lib/clean-task-name';
import { theme, sectionLabelStyle, bannerStyle } from '../lib/theme';
import { AgentSelector } from './AgentSelector';
import { ProjectSelect } from './ProjectSelect';
import type { AgentDef } from '../ipc/types';

interface NewTaskDialogProps {
  open: boolean;
  onClose: () => void;
}

export function NewTaskDialog(props: NewTaskDialogProps) {
  const [prompt, setPrompt] = createSignal('');
  const [name, setName] = createSignal('');
  const [selectedAgent, setSelectedAgent] = createSignal<AgentDef | null>(null);
  const [selectedProjectId, setSelectedProjectId] = createSignal<string | null>(null);
  const [error, setError] = createSignal('');
  const [loading, setLoading] = createSignal(false);
  const [skipPermissions, setSkipPermissions] = createSignal(false);
  const [dockerMode, setDockerMode] = createSignal(false);
  const [dockerImageReady, setDockerImageReady] = createSignal<boolean | null>(null);
  const [dockerBuilding, setDockerBuilding] = createSignal(false);
  const [dockerBuildOutput, setDockerBuildOutput] = createSignal('');
  const [dockerBuildError, setDockerBuildError] = createSignal('');
  let promptRef!: HTMLTextAreaElement;
  let formRef!: HTMLFormElement;
  let buildOutputRef!: HTMLPreElement;

  const focusableSelector =
    'textarea:not(:disabled), input:not(:disabled), select:not(:disabled), button:not(:disabled), [tabindex]:not([tabindex="-1"])';

  function navigateDialogFields(direction: 'up' | 'down'): void {
    if (!formRef) return;
    const sections = Array.from(formRef.querySelectorAll<HTMLElement>('[data-nav-field]'));
    if (sections.length === 0) return;

    const active = document.activeElement as HTMLElement | null;
    const currentIdx = active ? sections.findIndex((s) => s.contains(active)) : -1;

    let nextIdx: number;
    if (currentIdx === -1) {
      nextIdx = direction === 'down' ? 0 : sections.length - 1;
    } else if (direction === 'down') {
      nextIdx = (currentIdx + 1) % sections.length;
    } else {
      nextIdx = (currentIdx - 1 + sections.length) % sections.length;
    }

    const target = sections[nextIdx];
    const focusable = target.querySelector<HTMLElement>(focusableSelector);
    focusable?.focus();
  }

  function navigateWithinField(direction: 'left' | 'right'): void {
    if (!formRef) return;
    const active = document.activeElement as HTMLElement | null;
    if (!active) return;

    const section = active.closest<HTMLElement>('[data-nav-field]');
    if (!section) return;

    const focusables = Array.from(section.querySelectorAll<HTMLElement>(focusableSelector));
    if (focusables.length <= 1) return;

    const idx = focusables.indexOf(active);
    if (idx === -1) return;

    let nextIdx: number;
    if (direction === 'right') {
      nextIdx = (idx + 1) % focusables.length;
    } else {
      nextIdx = (idx - 1 + focusables.length) % focusables.length;
    }
    focusables[nextIdx].focus();
  }

  createEffect(() => {
    if (!props.open) return;

    setPrompt('');
    setName('');
    setError('');
    setLoading(false);
    setSkipPermissions(false);
    setDockerMode(false);
    setDockerImageReady(null);
    setDockerBuilding(false);
    setDockerBuildOutput('');
    setDockerBuildError('');

    void (async () => {
      invoke<boolean>(IPC.CheckDockerAvailable).then(
        (available) => setDockerAvailable(available),
        () => setDockerAvailable(false),
      );
      if (store.availableAgents.length === 0) {
        await loadAgents();
      }
      const lastAgent = store.lastAgentId
        ? (store.availableAgents.find((a) => a.id === store.lastAgentId) ?? null)
        : null;
      setSelectedAgent(lastAgent ?? store.availableAgents[0] ?? null);

      const fallbackProjectId = store.lastProjectId ?? store.projects[0]?.id ?? null;
      setSelectedProjectId(fallbackProjectId);

      const prefill = store.newTaskPrefillPrompt;
      if (prefill) {
        setPrompt(prefill.prompt);
        if (prefill.projectId) setSelectedProjectId(prefill.projectId);
      }

      promptRef?.focus();
    })();

    const handleAltArrow = (e: KeyboardEvent) => {
      if (!e.altKey) return;
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopImmediatePropagation();
        navigateDialogFields(e.key === 'ArrowDown' ? 'down' : 'up');
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const tag = (document.activeElement as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        e.preventDefault();
        e.stopImmediatePropagation();
        navigateWithinField(e.key === 'ArrowRight' ? 'right' : 'left');
      }
    };
    window.addEventListener('keydown', handleAltArrow, true);

    onCleanup(() => {
      window.removeEventListener('keydown', handleAltArrow, true);
    });
  });

  createEffect(() => {
    if (skipPermissions() && store.dockerAvailable) {
      setDockerMode(true);
    }
  });

  let checkTimer: ReturnType<typeof setTimeout>;
  createEffect(() => {
    if (dockerMode() && store.dockerAvailable) {
      const image = store.dockerImage || 'parallel-code-agent:latest';
      clearTimeout(checkTimer);
      checkTimer = setTimeout(() => {
        invoke<boolean>(IPC.CheckDockerImageExists, { image }).then(
          (exists) => setDockerImageReady(exists),
          () => setDockerImageReady(false),
        );
      }, 300);
    } else {
      setDockerImageReady(null);
    }
  });

  createEffect(() => {
    dockerBuildOutput();
    if (buildOutputRef) {
      buildOutputRef.scrollTop = buildOutputRef.scrollHeight;
    }
  });

  async function handleBuildImage() {
    setDockerBuilding(true);
    setDockerBuildOutput('');
    setDockerBuildError('');

    const channelId = `docker-build-${Date.now()}`;

    const cleanup = window.electron.ipcRenderer.on(`channel:${channelId}`, (...args: unknown[]) => {
      setDockerBuildOutput((prev) => prev + String(args[0] ?? ''));
    });

    try {
      const result = await invoke<{ ok: boolean; error?: string }>(IPC.BuildDockerImage, {
        onOutputChannel: `channel:${channelId}`,
      });
      if (result.ok) {
        setDockerImageReady(true);
        setDockerBuildOutput((prev) => prev + '\nImage built successfully!');
      } else {
        setDockerBuildError(result.error || 'Build failed');
      }
    } catch (err) {
      setDockerBuildError(String(err));
    } finally {
      setDockerBuilding(false);
      if (cleanup) cleanup();
    }
  }

  const effectiveName = () => {
    const n = name().trim();
    if (n) return n;
    const p = prompt().trim();
    if (!p) return '';
    const firstLine = cleanTaskName(p.split('\n')[0]);
    if (firstLine.length <= 40) return firstLine;
    return firstLine.slice(0, 40).replace(/\s+\S*$/, '') || firstLine.slice(0, 40);
  };

  const agentSupportsSkipPermissions = () => {
    const agent = selectedAgent();
    return !!agent?.skip_permissions_args?.length;
  };

  const canSubmit = () => {
    const hasContent = !!effectiveName();
    return hasContent && !!selectedProjectId() && !loading();
  };

  async function handleSubmit(e: Event) {
    e.preventDefault();
    const n = effectiveName();
    if (!n) return;

    const agent = selectedAgent();
    if (!agent) {
      setError('Select an agent');
      return;
    }

    const projectId = selectedProjectId();
    if (!projectId) {
      setError('Select a project');
      return;
    }

    setLoading(true);
    setError('');

    const p = prompt().trim() || undefined;
    try {
      const taskId = await createTask({
        name: n,
        agentDef: agent,
        projectId,
        initialPrompt: p,
        skipPermissions: agentSupportsSkipPermissions() && skipPermissions(),
        dockerMode: dockerMode() || undefined,
        dockerImage: dockerMode() ? store.dockerImage : undefined,
      });
      if (p) {
        setPrefillPrompt(taskId, p);
      }
      toggleNewTaskDialog(false);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog
      open={props.open}
      onClose={props.onClose}
      width={store.availableAgents.length > 8 ? '540px' : '420px'}
      panelStyle={{ gap: '20px' }}
    >
      <form
        ref={formRef}
        onSubmit={handleSubmit}
        style={{
          display: 'flex',
          'flex-direction': 'column',
          gap: '20px',
        }}
      >
        <div>
          <h2
            style={{
              margin: '0 0 6px',
              'font-size': '16px',
              color: theme.fg,
              'font-weight': '600',
            }}
          >
            New Task
          </h2>
          <p
            style={{ margin: '0', 'font-size': '12px', color: theme.fgMuted, 'line-height': '1.5' }}
          >
            Create a new terminal session for an AI agent to work on a task.
          </p>
        </div>

        {/* Project selector */}
        <div
          data-nav-field="project"
          style={{ display: 'flex', 'flex-direction': 'column', gap: '8px' }}
        >
          <label style={sectionLabelStyle}>Project</label>
          <ProjectSelect value={selectedProjectId()} onChange={setSelectedProjectId} />
        </div>

        {/* Prompt input (optional) */}
        <div
          data-nav-field="prompt"
          style={{ display: 'flex', 'flex-direction': 'column', gap: '8px' }}
        >
          <label style={sectionLabelStyle}>
            Prompt <span style={{ opacity: '0.5', 'text-transform': 'none' }}>(optional)</span>
          </label>
          <textarea
            ref={promptRef}
            class="input-field"
            value={prompt()}
            onInput={(e) => setPrompt(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                e.stopPropagation();
                if (canSubmit()) handleSubmit(e);
              }
            }}
            placeholder="What should the agent work on?"
            rows={3}
            style={{
              background: theme.bgInput,
              border: `1px solid ${theme.border}`,
              'border-radius': '8px',
              padding: '10px 14px',
              color: theme.fg,
              'font-size': '13px',
              'font-family': "'JetBrains Mono', monospace",
              outline: 'none',
              resize: 'vertical',
            }}
          />
        </div>

        <div
          data-nav-field="task-name"
          style={{ display: 'flex', 'flex-direction': 'column', gap: '8px' }}
        >
          <label style={sectionLabelStyle}>
            Task name{' '}
            <span style={{ opacity: '0.5', 'text-transform': 'none' }}>
              (optional — derived from prompt)
            </span>
          </label>
          <input
            class="input-field"
            type="text"
            value={name()}
            onInput={(e) => setName(e.currentTarget.value)}
            placeholder={effectiveName() || 'Add user authentication'}
            style={{
              background: theme.bgInput,
              border: `1px solid ${theme.border}`,
              'border-radius': '8px',
              padding: '10px 14px',
              color: theme.fg,
              'font-size': '13px',
              outline: 'none',
            }}
          />
        </div>

        <AgentSelector
          agents={store.availableAgents}
          selectedAgent={selectedAgent()}
          onSelect={setSelectedAgent}
        />

        {/* Skip permissions toggle */}
        <Show when={agentSupportsSkipPermissions()}>
          <div
            data-nav-field="skip-permissions"
            style={{ display: 'flex', 'flex-direction': 'column', gap: '8px' }}
          >
            <label
              style={{
                display: 'flex',
                'align-items': 'center',
                gap: '8px',
                'font-size': '12px',
                color: theme.fg,
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={skipPermissions()}
                onChange={(e) => setSkipPermissions(e.currentTarget.checked)}
                style={{ 'accent-color': theme.accent, cursor: 'inherit' }}
              />
              Dangerously skip all confirms
            </label>
            <Show when={skipPermissions()}>
              <div
                style={{
                  ...bannerStyle(theme.warning),
                  'font-size': '12px',
                }}
              >
                The agent will run without asking for confirmation. It can read, write, and delete
                files, and execute commands without your approval.
              </div>
              <Show when={!dockerMode() && store.dockerAvailable}>
                <div style={{ 'font-size': '11px', color: theme.fgMuted }}>
                  Tip: Enable Docker isolation to limit the blast radius of skip-permissions mode.
                </div>
              </Show>
              <Show when={!store.dockerAvailable}>
                <div style={{ 'font-size': '11px', color: theme.fgMuted }}>
                  Install Docker to enable container isolation for safer skip-permissions mode.
                </div>
              </Show>
            </Show>
          </div>
        </Show>

        {/* Docker isolation toggle */}
        <Show when={store.dockerAvailable}>
          <div
            data-nav-field="docker-mode"
            style={{ display: 'flex', 'flex-direction': 'column', gap: '8px' }}
          >
            <label
              style={{
                display: 'flex',
                'align-items': 'center',
                gap: '8px',
                'font-size': '12px',
                color: theme.fg,
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={dockerMode()}
                onChange={(e) => setDockerMode(e.currentTarget.checked)}
                style={{ 'accent-color': theme.accent, cursor: 'inherit' }}
              />
              Run in Docker container
            </label>
            <Show when={dockerMode()}>
              <div
                style={{
                  'font-size': '12px',
                  color: theme.success ?? theme.accent,
                  background: `color-mix(in srgb, ${theme.success ?? theme.accent} 8%, transparent)`,
                  padding: '8px 12px',
                  'border-radius': '8px',
                  border: `1px solid color-mix(in srgb, ${theme.success ?? theme.accent} 20%, transparent)`,
                }}
              >
                The agent will run inside a Docker container. Only the project directory is mounted
                — files outside the project are protected from accidental deletion.
              </div>
              <div style={{ display: 'flex', 'align-items': 'center', gap: '8px' }}>
                <label
                  style={{ 'font-size': '11px', color: theme.fgMuted, 'white-space': 'nowrap' }}
                >
                  Image:
                </label>
                <input
                  type="text"
                  value={store.dockerImage}
                  onInput={(e) => setDockerImage(e.currentTarget.value)}
                  placeholder="parallel-code-agent:latest"
                  style={{
                    flex: '1',
                    background: theme.bgInput,
                    border: `1px solid ${theme.border}`,
                    'border-radius': '6px',
                    padding: '5px 10px',
                    color: theme.fg,
                    'font-size': '12px',
                    'font-family': "'JetBrains Mono', monospace",
                    outline: 'none',
                  }}
                />
              </div>
              <Show when={dockerImageReady() === false && !dockerBuilding()}>
                <div
                  style={{
                    display: 'flex',
                    'align-items': 'center',
                    gap: '8px',
                    'font-size': '11px',
                    color: theme.fgMuted,
                  }}
                >
                  <span>Image not found locally.</span>
                  <Show
                    when={store.dockerImage === 'parallel-code-agent:latest' || !store.dockerImage}
                  >
                    <button
                      type="button"
                      onClick={handleBuildImage}
                      style={{
                        background: theme.accent,
                        color: theme.accentText,
                        border: 'none',
                        'border-radius': '4px',
                        padding: '3px 10px',
                        'font-size': '11px',
                        cursor: 'pointer',
                      }}
                    >
                      Build Image
                    </button>
                  </Show>
                </div>
              </Show>
              <Show when={dockerBuilding()}>
                <div
                  style={{
                    'font-size': '11px',
                    color: theme.fgMuted,
                    display: 'flex',
                    'align-items': 'center',
                    gap: '6px',
                  }}
                >
                  <span class="inline-spinner" aria-hidden="true" />
                  Building image... this may take a few minutes.
                </div>
                <Show when={dockerBuildOutput()}>
                  <pre
                    ref={buildOutputRef}
                    style={{
                      'font-size': '10px',
                      color: theme.fgSubtle,
                      background: theme.bgInput,
                      'border-radius': '4px',
                      padding: '6px 8px',
                      'max-height': '120px',
                      'overflow-y': 'auto',
                      'white-space': 'pre-wrap',
                      'word-break': 'break-all',
                      margin: '0',
                    }}
                  >
                    {dockerBuildOutput()}
                  </pre>
                </Show>
              </Show>
              <Show when={dockerBuildError()}>
                <div style={{ 'font-size': '11px', color: theme.error }}>
                  Build failed: {dockerBuildError()}
                </div>
              </Show>
              <Show when={dockerImageReady() === true && !dockerBuilding()}>
                <div style={{ 'font-size': '11px', color: theme.success ?? theme.accent }}>
                  Image ready.
                </div>
              </Show>
            </Show>
          </div>
        </Show>

        <Show when={error()}>
          <div
            style={{
              ...bannerStyle(theme.error),
              'font-size': '12px',
            }}
          >
            {error()}
          </div>
        </Show>

        <div
          data-nav-field="footer"
          style={{
            display: 'flex',
            gap: '8px',
            'justify-content': 'flex-end',
            'padding-top': '4px',
          }}
        >
          <button
            type="button"
            class="btn-secondary"
            onClick={() => props.onClose()}
            style={{
              padding: '9px 18px',
              background: theme.bgInput,
              border: `1px solid ${theme.border}`,
              'border-radius': '8px',
              color: theme.fgMuted,
              cursor: 'pointer',
              'font-size': '13px',
            }}
          >
            Cancel
          </button>
          <button
            type="submit"
            class="btn-primary"
            disabled={!canSubmit()}
            style={{
              padding: '9px 20px',
              background: theme.accent,
              border: 'none',
              'border-radius': '8px',
              color: theme.accentText,
              cursor: 'pointer',
              'font-size': '13px',
              'font-weight': '500',
              opacity: !canSubmit() ? '0.4' : '1',
              display: 'inline-flex',
              'align-items': 'center',
              gap: '8px',
            }}
          >
            <Show when={loading()}>
              <span class="inline-spinner" aria-hidden="true" />
            </Show>
            {loading() ? 'Creating...' : 'Create Task'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
