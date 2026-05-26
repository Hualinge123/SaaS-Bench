import type { DesktopResizeDirection } from '@green/hooks/useDesktopWindowControls';
import { useDesktopWindowControls } from '@green/hooks/useDesktopWindowControls';
import type { MouseEvent } from 'react';

type ResizeHandle = {
  direction: DesktopResizeDirection;
  className: string;
};

const RESIZE_HANDLES: ResizeHandle[] = [
  { direction: 'top', className: 'desktop-resize-top' },
  { direction: 'right', className: 'desktop-resize-right' },
  { direction: 'bottom', className: 'desktop-resize-bottom' },
  { direction: 'left', className: 'desktop-resize-left' },
  { direction: 'top-left', className: 'desktop-resize-top-left' },
  { direction: 'top-right', className: 'desktop-resize-top-right' },
  { direction: 'bottom-left', className: 'desktop-resize-bottom-left' },
  { direction: 'bottom-right', className: 'desktop-resize-bottom-right' },
];

export function GreenDesktopResizeHandles() {
  const { isDesktopHost, isMaximized, startResize } = useDesktopWindowControls();

  if (!isDesktopHost || isMaximized) {
    return null;
  }

  const handleMouseDown = (direction: DesktopResizeDirection) => (event: MouseEvent<HTMLButtonElement>) => {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    startResize(direction);
  };

  return (
    <div className="desktop-resize-handles" aria-hidden="true">
      {RESIZE_HANDLES.map((handle) => (
        <button
          key={handle.direction}
          type="button"
          aria-label={`Resize ${handle.direction}`}
          className={`desktop-resize-handle ${handle.className}`}
          onMouseDown={handleMouseDown(handle.direction)}
        />
      ))}
    </div>
  );
}
