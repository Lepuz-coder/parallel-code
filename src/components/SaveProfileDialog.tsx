import { createSignal, createEffect } from 'solid-js';
import { Dialog } from './Dialog';
import { theme } from '../lib/theme';
import { store, saveCurrentAsProfile, toggleSaveProfileDialog } from '../store/store';

export function SaveProfileDialog() {
  const [name, setName] = createSignal('');
  let inputRef: HTMLInputElement | undefined;

  createEffect(() => {
    if (!store.showSaveProfileDialog) return;
    setName(`Profile ${store.profiles.length + 1}`);
    requestAnimationFrame(() => {
      inputRef?.focus();
      inputRef?.select();
    });
  });

  function handleSave() {
    const trimmed = name().trim();
    if (!trimmed) return;
    saveCurrentAsProfile(trimmed);
    toggleSaveProfileDialog(false);
  }

  return (
    <Dialog open={store.showSaveProfileDialog} onClose={() => toggleSaveProfileDialog(false)}>
      <h2
        style={{
          margin: '0',
          'font-size': '16px',
          color: theme.fg,
          'font-weight': '600',
        }}
      >
        Save Profile
      </h2>

      <div style={{ 'font-size': '13px', color: theme.fgMuted, 'line-height': '1.5' }}>
        Save the current workspace layout as a profile.
      </div>

      <input
        ref={inputRef}
        type="text"
        value={name()}
        onInput={(e) => setName(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSave();
        }}
        placeholder="Profile name"
        style={{
          padding: '9px 12px',
          background: theme.bgInput,
          border: `1px solid ${theme.border}`,
          'border-radius': '8px',
          color: theme.fg,
          'font-size': '13px',
          outline: 'none',
          width: '100%',
          'box-sizing': 'border-box',
        }}
      />

      <div
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
          onClick={() => toggleSaveProfileDialog(false)}
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
          type="button"
          class="btn-primary"
          disabled={!name().trim()}
          onClick={handleSave}
          style={{
            padding: '9px 20px',
            background: theme.accent,
            border: 'none',
            'border-radius': '8px',
            color: theme.accentText,
            cursor: !name().trim() ? 'not-allowed' : 'pointer',
            'font-size': '13px',
            'font-weight': '500',
            opacity: !name().trim() ? '0.5' : '1',
          }}
        >
          Save
        </button>
      </div>
    </Dialog>
  );
}
