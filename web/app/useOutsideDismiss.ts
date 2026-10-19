import { useEffect, type RefObject } from 'react';

export function useOutsideDismiss(
  enabled: boolean,
  regions: RefObject<HTMLElement | null>[],
  dismiss: () => void,
) {
  useEffect(() => {
    if (!enabled) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Element;
      if (regions.some((region) => region.current?.contains(target))) return;
      // A native modal can be portalled out of its owning inspector.
      const modal = target.closest('dialog[open]');
      if (modal && !regions.some((region) => region.current && modal.contains(region.current)))
        return;
      dismiss();
    };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [enabled, regions, dismiss]);
}
