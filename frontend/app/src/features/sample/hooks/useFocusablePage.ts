import { useEffect, type RefObject } from "react";

const isInteractiveElement = (target: HTMLElement | null) =>
  target instanceof HTMLInputElement ||
  target instanceof HTMLTextAreaElement ||
  target instanceof HTMLSelectElement ||
  target instanceof HTMLButtonElement ||
  Boolean(target?.isContentEditable);

export const useFocusablePage = (pageRef: RefObject<HTMLElement | null>) => {
  useEffect(() => {
    const focusPage = () => {
      pageRef.current?.focus({ preventScroll: true });
    };

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;

      if (!isInteractiveElement(target)) {
        focusPage();
      }
    };

    focusPage();
    window.addEventListener("focus", focusPage);
    window.addEventListener("pointerdown", handlePointerDown);

    return () => {
      window.removeEventListener("focus", focusPage);
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [pageRef]);
};
