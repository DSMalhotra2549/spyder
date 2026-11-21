// Phase 1 placeholder: static Full-style pill per design/DESIGN.md §2. Phase 3 wires it to the engine.
export function Widget() {
  return (
    <div className="p-2">
      <div className="drag relative flex h-16 w-80 items-center gap-3 rounded-pill border-[1.5px] border-border-strong bg-surface pr-4 pl-4 shadow-[var(--shadow-float)]">
        <div className="tabular w-[68px] text-[22px] leading-none font-bold text-muted">--:--</div>
        <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
          <div className="truncate text-[13px] font-semibold text-muted">Starting…</div>
          <div className="h-1 rounded-bar bg-surface-2" />
          <div className="caps text-muted">Spyder</div>
        </div>
        <div className="flex h-[34px] w-[34px] items-center justify-center rounded-full border-[3px] border-border text-[11px] font-bold">
          –
        </div>
      </div>
    </div>
  );
}
