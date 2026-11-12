import { useId, useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";

export function Dialog({
  title,
  children,
  onClose,
  wide = false,
  drawer = false,
  returnFocusTo,
}: {
  title: string;
  children: ReactNode;
  onClose?: () => void;
  wide?: boolean;
  drawer?: boolean;
  returnFocusTo?: RefObject<HTMLElement | null>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useLayoutEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    dialog.showModal();
    return () => {
      dialog.close();
      (returnFocusTo?.current ?? previous)?.focus({ preventScroll: true });
    };
  }, [returnFocusTo]);
  return (
    <dialog
      ref={ref}
      className={drawer ? "dialog drawer" : wide ? "dialog wide" : "dialog"}
      onCancel={(e) => {
        e.preventDefault();
        onClose?.();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
          "a[href], button, input, select, textarea, summary, [tabindex]",
        )).filter(item => item.tabIndex >= 0 && !item.matches(":disabled") && item.getClientRects().length > 0);
        const first = items[0];
        const last = items.at(-1);
        const edge = event.shiftKey ? first : last;
        if (edge && document.activeElement === edge) {
          event.preventDefault();
          (event.shiftKey ? last : first)?.focus();
        }
      }}
      aria-labelledby={titleId}
    >
      <div className="dialog-head">
        <h2 id={titleId}>{title}</h2>
        {onClose && (
          <button type="button" onClick={onClose} aria-label="关闭对话框" className="icon-button">
            ×
          </button>
        )}
      </div>
      {children}
    </dialog>
  );
}
