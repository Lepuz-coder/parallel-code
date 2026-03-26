type ShortcutHandler = (e: KeyboardEvent) => void;

interface Shortcut {
  key: string;
  ctrl?: boolean;
  cmdOrCtrl?: boolean;
  alt?: boolean;
  shift?: boolean;
  /** When true, the shortcut fires even when an input/textarea/select is focused (e.g. inside a terminal). */
  global?: boolean;
  /** When true, the shortcut fires even when a dialog overlay is open. */
  dialogSafe?: boolean;
  handler: ShortcutHandler;
}

const shortcuts: Shortcut[] = [];

function keyMatches(e: KeyboardEvent, key: string): boolean {
  if (e.key.toLowerCase() === key.toLowerCase()) return true;
  // Fallback: match via e.code for non-ASCII keyboard layouts
  // e.g. on Turkish layout Cmd+Shift+P may produce a different e.key
  if (key.length === 1 && /^[a-z]$/i.test(key)) {
    return e.code.toLowerCase() === `key${key.toLowerCase()}`;
  }
  return false;
}

function matches(e: KeyboardEvent, s: Shortcut): boolean {
  const ctrlMatch = s.cmdOrCtrl ? e.ctrlKey || e.metaKey : !!e.ctrlKey === !!s.ctrl;
  // For non-cmdOrCtrl shortcuts, require metaKey to not be pressed
  const metaMatch = s.cmdOrCtrl || !e.metaKey;

  return (
    keyMatches(e, s.key) &&
    ctrlMatch &&
    metaMatch &&
    !!e.altKey === !!s.alt &&
    !!e.shiftKey === !!s.shift
  );
}

export function registerShortcut(shortcut: Shortcut): () => void {
  shortcuts.push(shortcut);
  return () => {
    const idx = shortcuts.indexOf(shortcut);
    if (idx >= 0) shortcuts.splice(idx, 1);
  };
}

/** Returns true if the event matches any shortcut with `global: true`. */
export function matchesGlobalShortcut(e: KeyboardEvent): boolean {
  return shortcuts.some((s) => s.global && matches(e, s));
}

export function initShortcuts(): () => void {
  const handler = (e: KeyboardEvent) => {
    // Don't intercept when typing in input/textarea — unless the shortcut is global
    const tag = (e.target as HTMLElement)?.tagName;
    const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

    // Suppress non-dialog-safe shortcuts when a dialog overlay is open
    const dialogOpen = document.querySelector('.dialog-overlay') !== null;

    for (const s of shortcuts) {
      if (matches(e, s) && (!inInput || s.global) && (!dialogOpen || s.dialogSafe)) {
        e.preventDefault();
        e.stopPropagation();
        s.handler(e);
        return;
      }
    }
  };

  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}
