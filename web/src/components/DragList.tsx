import React, { useRef, useState } from 'react';

export type DropSide = 'before' | 'after';

export interface DragHandleProps {
  isDragging: boolean;
  dropSide: DropSide | null;
  draggable: true;
  /** Mirror onto the control as `data-drag-handle` so the list can refocus it. */
  handleIndex: number;
  onDragStart: (event: React.DragEvent) => void;
  onDragEnd: () => void;
  onKeyDown: (event: React.KeyboardEvent) => void;
  onFocus: () => void;
  onBlur: () => void;
  focused: boolean;
}

interface DragListProps<T> {
  items: readonly T[];
  /** Stable key per row. Falls back to the index when omitted. */
  getKey?: (item: T, index: number) => string;
  onReorder: (from: number, to: number) => void;
  renderItem: (
    item: T,
    index: number,
    handle: DragHandleProps,
  ) => React.ReactNode;
  className?: string;
}

/**
 * A vertical reorderable list built on the native drag-and-drop protocol.
 *
 * No dependency: these lists are single-column, short, and reordered by one
 * pointer, which is the shape the native protocol handles without ceremony.
 * Rows stay reachable without a mouse — the handle is focusable and
 * ArrowUp/ArrowDown move the row — so ordering never depends on dragging.
 *
 * `onReorder` receives the corrected slot index, so callers only apply the
 * move; where the pointer sat within a row is resolved here.
 */
export function DragList<T>({
  items,
  getKey,
  onReorder,
  renderItem,
  className,
}: DragListProps<T>): React.ReactElement {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [over, setOver] = useState<{ index: number; side: DropSide } | null>(
    null,
  );
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const resetDrag = () => {
    setDragIndex(null);
    setOver(null);
  };

  const sideFromEvent = (event: React.DragEvent): DropSide => {
    const box = event.currentTarget.getBoundingClientRect();
    return event.clientY < box.top + box.height / 2 ? 'before' : 'after';
  };

  const handleDragStart = (index: number) => (event: React.DragEvent) => {
    setDragIndex(index);
    event.dataTransfer.effectAllowed = 'move';
    // The source index travels with the drag operation itself, so the drop
    // handler reads the truth rather than a state snapshot that may lag.
    event.dataTransfer.setData('text/plain', String(index));
  };

  const handleDragOver = (index: number) => (event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const side = sideFromEvent(event);
    setOver((previous) =>
      previous?.index === index && previous.side === side
        ? previous
        : { index, side },
    );
  };

  const handleDrop = (index: number) => (event: React.DragEvent) => {
    event.preventDefault();
    // Readable only here, where the browser lifts protected-mode restrictions.
    const carried = Number.parseInt(event.dataTransfer.getData('text/plain'), 10);
    const side = sideFromEvent(event);
    resetDrag();
    const from = Number.isNaN(carried) ? dragIndex : carried;
    if (from === null) {
      return;
    }
    // The pointer sat either side of row `index`, i.e. in the gap before or
    // after that slot. Removing the dragged row shifts later slots down by one.
    let to = side === 'after' ? index + 1 : index;
    if (from < to) {
      to -= 1;
    }
    if (from !== to) {
      onReorder(from, to);
    }
  };

  const handleKeyDown = (index: number) => (event: React.KeyboardEvent) => {
    let target: number;
    if (event.key === 'ArrowUp') {
      target = index - 1;
    } else if (event.key === 'ArrowDown') {
      target = index + 1;
    } else {
      return;
    }
    if (target < 0 || target >= items.length) {
      return;
    }
    event.preventDefault();
    onReorder(index, target);
    // Focus follows the row that moved, so consecutive presses keep moving the
    // same entry instead of re-grabbing whatever landed in the old slot. The
    // index is resolved after commit, once the rows have re-rendered.
    requestAnimationFrame(() => {
      setFocusedIndex(target);
      rootRef.current
        ?.querySelector<HTMLElement>(`[data-drag-handle="${target}"]`)
        ?.focus();
    });
  };

  return (
    <div className={className} ref={rootRef}>
      {items.map((item, index) => {
        const key = getKey?.(item, index) ?? String(index);
        const dropSide =
          over?.index === index && dragIndex !== index ? over.side : null;

        const handle: DragHandleProps = {
          isDragging: dragIndex === index,
          dropSide,
          draggable: true,
          handleIndex: index,
          onDragStart: handleDragStart(index),
          onDragEnd: resetDrag,
          onKeyDown: handleKeyDown(index),
          onFocus: () => setFocusedIndex(index),
          onBlur: () =>
            setFocusedIndex((previous) =>
              previous === index ? null : previous,
            ),
          focused: focusedIndex === index,
        };

        return (
          // The whole row is the drop target: the pointer should not have to
          // land on the grip for a drop to register.
          <div
            key={key}
            data-drag-row={index}
            className="relative"
            onDragOver={handleDragOver(index)}
            onDragLeave={() =>
              setOver((previous) =>
                previous?.index === index ? null : previous,
              )
            }
            onDrop={handleDrop(index)}
          >
            {/* Insertion line: the gap the drop will land in. */}
            {dropSide === 'before' && (
              <div className="absolute -top-px left-0 right-0 h-0.5 bg-emerald-400 z-10 pointer-events-none" />
            )}
            {dropSide === 'after' && (
              <div className="absolute -bottom-px left-0 right-0 h-0.5 bg-emerald-400 z-10 pointer-events-none" />
            )}
            {renderItem(item, index, handle)}
          </div>
        );
      })}
    </div>
  );
}