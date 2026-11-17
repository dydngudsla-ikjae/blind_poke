import { useEffect, useId, useRef, type ReactNode } from "react";

export default function BaseDialog({
  title,
  onClose,
  wide = false,
  children,
}: {
  title: string;
  onClose: () => void;
  wide?: boolean;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const opener = document.activeElement;
    element.showModal();

    return () => {
      element.close();
      if (opener instanceof HTMLElement && opener.isConnected) {
        opener.focus();
      } else {
        document.querySelector<HTMLElement>("[data-base-heading], [data-atlas-report-heading]")?.focus();
      }
    };
  }, []);

  return (
    <dialog
      ref={dialog}
      className={wide ? "base-dialog base-dialog-wide" : "base-dialog"}
      aria-labelledby={titleId}
      onCancel={event => {
        event.preventDefault();
        onClose();
      }}
    >
      <header className="base-dialog-header">
        <h2 id={titleId}>{title}</h2>
        <button type="button" className="base-dialog-close" aria-label="닫기" onClick={onClose}>
          <span aria-hidden="true">×</span>
        </button>
      </header>
      <div className="base-dialog-body">{children}</div>
    </dialog>
  );
}
