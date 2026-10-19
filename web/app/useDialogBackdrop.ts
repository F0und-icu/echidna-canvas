import { useRef, type MouseEvent, type PointerEvent } from 'react';

function outside(event: MouseEvent<HTMLDialogElement> | PointerEvent<HTMLDialogElement>) {
  const box = event.currentTarget.getBoundingClientRect();
  return (
    event.clientX < box.left ||
    event.clientX > box.right ||
    event.clientY < box.top ||
    event.clientY > box.bottom
  );
}

export function useDialogBackdrop(dismiss: () => void) {
  const startedOutside = useRef(false);
  return {
    onPointerDown: (event: PointerEvent<HTMLDialogElement>) => {
      event.stopPropagation();
      startedOutside.current = outside(event);
    },
    onClick: (event: MouseEvent<HTMLDialogElement>) => {
      if (startedOutside.current && event.target === event.currentTarget && outside(event))
        dismiss();
    },
  };
}
