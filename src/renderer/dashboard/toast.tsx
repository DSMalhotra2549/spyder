// The edit toast (P52): one line at the bottom of the dashboard, with Undo for ~8 s after a delete or merge.
import { useEffect, useState } from 'react';
import type { EditResult } from '../../preload/api';

interface ToastMsg {
  seq: number;
  message: string;
  error: boolean;
  undoId?: string;
  /** Called after Undo so the page can reload. */
  onUndone?: () => void;
}

let seq = 0;
let listener: ((t: ToastMsg | null) => void) | null = null;

export function showToast(message: string, o: { error?: boolean; undoId?: string; onUndone?: () => void } = {}): void {
  listener?.({ seq: ++seq, message, error: !!o.error, undoId: o.undoId, onUndone: o.onUndone });
}

const errText = (e: object) => ('message' in e && typeof e.message === 'string' ? e.message : 'That didn’t work');

/** Shows the result of a delete or merge: the message with Undo, or the error. */
export function showEditResult(r: EditResult, onUndone: () => void): void {
  if ('error' in r) showToast(errText(r), { error: true });
  else showToast(r.message, { undoId: r.undoId, onUndone });
}

const TTL_MS = 8000;

export function Toast() {
  const [t, setT] = useState<ToastMsg | null>(null);
  useEffect(() => {
    listener = setT;
    return () => {
      listener = null;
    };
  }, []);
  useEffect(() => {
    if (!t) return;
    const timer = setTimeout(() => setT((cur) => (cur?.seq === t.seq ? null : cur)), TTL_MS);
    return () => clearTimeout(timer);
  }, [t]);
  if (!t) return null;
  const undo = async () => {
    setT(null);
    const r = await window.spyder.undoEdit(t.undoId!);
    if ('error' in r) showToast(errText(r), { error: true });
    t.onUndone?.();
  };
  return (
    <div
      data-testid="toast"
      role="status"
      className="fixed bottom-5 left-1/2 z-50 flex h-10 -translate-x-1/2 items-center gap-3 rounded-card border border-border-strong bg-surface pr-1.5 pl-4 text-[13px] shadow-pop"
    >
      <span className={t.error ? 'text-red' : 'text-text'}>{t.message}</span>
      {t.undoId && (
        <button
          data-testid="toast-undo"
          onClick={() => void undo()}
          className="h-7 rounded-control px-2.5 text-[13px] font-medium text-accent hover:bg-accent/10"
        >
          Undo
        </button>
      )}
      <button
        aria-label="Dismiss"
        onClick={() => setT(null)}
        className="flex h-7 w-7 items-center justify-center rounded-control text-muted hover:bg-surface-2 hover:text-text"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <path d="M1 1l8 8M9 1 1 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
