import { For, onCleanup, onMount, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import { theme } from '../lib/theme';
import { sf } from '../lib/fontScale';

export interface ContextMenuItem {
  label: string;
  icon?: JSX.Element;
  onClick: () => void;
}

interface ContextMenuProps {
  items: ContextMenuItem[];
  position: { x: number; y: number };
  onClose: () => void;
}

export function ContextMenu(props: ContextMenuProps) {
  let menuRef: HTMLDivElement | undefined;

  onMount(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (menuRef && !menuRef.contains(e.target as Node)) {
        props.onClose();
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose();
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    onCleanup(() => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    });
  });

  // Clamp position to keep menu on-screen
  const pos = () => {
    const menuW = 200;
    const menuH = props.items.length * 32 + 8;
    const x = Math.min(props.position.x, window.innerWidth - menuW - 8);
    const y = Math.min(props.position.y, window.innerHeight - menuH - 8);
    return { x: Math.max(4, x), y: Math.max(4, y) };
  };

  return (
    <Portal>
      <div
        ref={menuRef}
        style={{
          position: 'fixed',
          left: `${pos().x}px`,
          top: `${pos().y}px`,
          'min-width': '180px',
          background: theme.bgElevated,
          border: `1px solid ${theme.border}`,
          'border-radius': '8px',
          padding: '4px 0',
          'z-index': '2000',
          'box-shadow': '0 4px 16px rgba(0,0,0,0.4)',
        }}
      >
        <For each={props.items}>
          {(item) => (
            <button
              onClick={() => {
                item.onClick();
                props.onClose();
              }}
              style={{
                display: 'flex',
                'align-items': 'center',
                gap: '8px',
                width: '100%',
                padding: '6px 12px',
                background: 'transparent',
                border: 'none',
                color: theme.fg,
                'font-size': sf(12),
                cursor: 'pointer',
                'text-align': 'left',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.background = theme.bgHover;
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background = 'transparent';
              }}
            >
              {item.icon && (
                <span style={{ 'flex-shrink': '0', display: 'flex' }}>{item.icon}</span>
              )}
              {item.label}
            </button>
          )}
        </For>
      </div>
    </Portal>
  );
}
