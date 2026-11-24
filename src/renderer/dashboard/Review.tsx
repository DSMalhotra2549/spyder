// End-of-day review (plan §12, P24, design/DESIGN.md §4 Review).
import clsx from 'clsx';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { DaySummary } from '../../core/aggregate';
import { fmtDuration, fmtTime } from '../../core/format';
import type { Kpi, ReviewItem } from '../../core/review';
import type { Tag } from '../../core/types';
import { AnswerInput, Btn, inputCls } from '../ui/controls';
import { Timeline } from './Timeline';
import { TimeSplit } from './TimeSplit';
import { Card, TopBar, useLoader } from './parts';
import { dur, effSub, pct } from './stats';
import { showEditResult } from './toast';

export function Review({ date, onDate, onChanged }: { date?: string; onDate: (d: string) => void; onChanged: () => void }) {
  const [vm, reload] = useLoader(() => window.spyder.getReview(date), date ?? '', true);
  const refresh = async () => {
    await reload();
    onChanged();
  };
  if (!vm) return <TopBar title="Review" />;
  const blocked = vm.leftoverCount > 0;
  const complete = async () => {
    await window.spyder.completeReview(vm.date);
    await refresh();
  };
  return (
    <>
      <TopBar
        title="Review"
        date={vm.date}
        today={vm.today}
        onDate={onDate}
        actions={
          <>
            {vm.completedMs !== null && (
              <span data-testid="reviewed-chip" className="flex h-7 items-center gap-1.5 rounded-control bg-green/12 px-2.5 text-[12px] font-medium text-green">
                ✓ Reviewed at {fmtTime(vm.completedMs)}
              </span>
            )}
            <span title={blocked ? `Account for ${vm.leftoverCount} leftover item${vm.leftoverCount > 1 ? 's' : ''} first` : undefined}>
              <Btn variant="primary" data-testid="complete-review" disabled={blocked} onClick={() => void complete()}>
                {vm.completedMs !== null ? 'Update review' : 'Complete review'}
              </Btn>
            </span>
          </>
        }
      />
      <div className="grid flex-1 grid-cols-12 gap-4 overflow-y-auto p-6" data-testid="review">
        <div className="col-span-7 flex min-w-0 flex-col gap-4">
          <Card title="Leftover" right={vm.leftoverCount ? `${vm.leftoverCount} to account for` : undefined}>
            <Leftovers s={vm.summary} onChanged={refresh} />
          </Card>
          <Card title="Day summary">
            <MiniStats s={vm.summary} />
            <div className="mt-4 border-t border-border pt-4">
              <TimeSplit s={vm.summary} />
            </div>
            <div className="mt-4">
              <Timeline s={vm.summary} nowMs={-1} compact />
            </div>
          </Card>
        </div>
        <div className="col-span-5 flex min-w-0 flex-col gap-4">
          <Card title="Today's wins">
            <Bullets key={`w${vm.date}`} date={vm.date} kind="win" items={vm.items.filter((i) => i.kind === 'win')} placeholder="Something that went well" />
          </Card>
          <Card title="How I'll improve">
            <Bullets
              key={`i${vm.date}`}
              date={vm.date}
              kind="improve"
              items={vm.items.filter((i) => i.kind === 'improve')}
              placeholder="One thing to do differently"
            />
          </Card>
          <Kpis key={vm.date} date={vm.date} kpis={vm.kpis} values={vm.kpiValues} onChanged={refresh} />
        </div>
      </div>
    </>
  );
}

function MiniStats({ s }: { s: DaySummary }) {
  const items: [string, string, string?][] = [
    ['Productive', dur(s.productiveSec)],
    ['Work', dur(s.workSec)],
    ['Day score', pct(s.score)],
    // P75: the user's own rating, with the effective time under it.
    ['Efficiency', pct(s.efficiency), effSub(s.ratedSec, s.effectiveSec)],
    ['Break', dur(s.breakSec)],
    ['Distracting', dur(s.distractingSec)],
  ];
  return (
    <div className="grid grid-cols-3 gap-x-3 gap-y-4">
      {items.map(([k, v, sub]) => (
        <div key={k} className="min-w-0">
          <div className="section-label mb-1">{k}</div>
          <div data-testid={k === 'Efficiency' ? 'review-efficiency' : undefined} className="text-[17px] font-semibold tabular">
            {v}
          </div>
          {sub && <div className="mt-0.5 truncate text-[11px] text-muted tabular">{sub}</div>}
        </div>
      ))}
    </div>
  );
}

// ---- leftovers (P60): blocks not accounted for -------------------------------------------
function Leftovers({ s, onChanged }: { s: DaySummary; onChanged: () => Promise<void> }) {
  const blocks = s.sessions.filter((x) => x.name === null && x.kind !== 'break' && !x.running);
  if (!blocks.length)
    return (
      <div data-testid="all-accounted" className="flex items-center gap-2 py-4 text-[13px] text-green">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-green/15">✓</span>
        All time accounted for
      </div>
    );
  return (
    <div className="flex flex-col divide-y divide-border">
      {blocks.map((x) => (
        <LeftoverRow key={x.id} id={x.id} startMs={x.startMs} endMs={x.endMs ?? x.startMs} sec={x.elapsedSec} onChanged={onChanged} />
      ))}
    </div>
  );
}

function LeftoverRow({ id, startMs, endMs, sec, onChanged }: { id: string; startMs: number; endMs: number; sec: number; onChanged: () => Promise<void> }) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Save makes it a work block; Break a break, keeping any typed text (P66).
  const save = async (tag: Tag) => {
    if (tag === 'work' && !text.trim()) return setError('Say what you did, or pick Break');
    const r = await window.spyder.answerBlocks([{ id, answer: text.trim() || null, tag }]);
    if ('error' in r) return setError(r.message);
    await onChanged();
  };
  return (
    <div data-testid="leftover-block" className="py-3">
      <div className="mb-2 text-[13px]">
        What did you do {fmtTime(startMs)}–{fmtTime(endMs)}? <span className="text-muted tabular">({fmtDuration(sec)})</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <AnswerInput value={text} onChange={setText} onEnter={() => void save('work')} />
        </div>
        <Btn variant="primary" disabled={!text.trim()} onClick={() => void save('work')}>
          Save
        </Btn>
        <Btn data-testid="leftover-break" onClick={() => void save('break')}>
          Break
        </Btn>
      </div>
      {error && <div className="mt-1 text-[12px] text-red">{error}</div>}
      <button
        data-testid="leftover-delete"
        className="mt-1.5 text-[12px] text-muted hover:text-red"
        onClick={async () => {
          // A leftover is answered or deleted; deleting makes its time untracked (P64).
          const r = await window.spyder.deleteBlocks([id]);
          showEditResult(r, () => void onChanged());
          await onChanged();
        }}
      >
        Delete block
      </button>
    </div>
  );
}

// ---- wins / improvements -----------------------------------------------------------
interface Row {
  key: string;
  text: string;
}

let keySeq = 0;
const newKey = () => `k${++keySeq}`;

function Bullets({ date, kind, items, placeholder }: { date: string; kind: ReviewItem['kind']; items: ReviewItem[]; placeholder: string }) {
  const [initial] = useState(() => items.map((i) => ({ key: newKey(), item: i })));
  const [rows, setRows] = useState<Row[]>(() => initial.map(({ key, item }) => ({ key, text: item.text })));
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const refs = useRef(new Map<string, HTMLInputElement>());
  // Saved state per row key. Refs, not state: Enter and the blur that follows both save, and the
  // second save must see the id the first one got.
  const ids = useRef(new Map(initial.map(({ key, item }) => [key, item.id])));
  const saved = useRef(new Map(initial.map(({ key, item }) => [key, item.text])));
  const queue = useRef(Promise.resolve());
  const latest = useRef(rows);
  useEffect(() => {
    latest.current = rows;
  });

  // Layout effect: focus moves in the same commit as the click, so no keystroke is lost.
  useLayoutEffect(() => {
    if (focusKey) refs.current.get(focusKey)?.focus();
  }, [focusKey]);

  /** Saves run one at a time, in order. */
  const enqueue = (fn: () => Promise<void>) => {
    queue.current = queue.current.then(fn).catch((e: unknown) => console.error(e));
    return queue.current;
  };

  const persist = (key: string, text: string) =>
    enqueue(async () => {
      const t = text.trim();
      const id = ids.current.get(key);
      if (id && t === saved.current.get(key)) return;
      if (!t) {
        if (id) await window.spyder.deleteReviewItem(id);
        ids.current.delete(key);
        saved.current.delete(key);
        return;
      }
      const sort = latest.current.findIndex((r) => r.key === key);
      const it = await window.spyder.saveReviewItem({ id, date, kind, text: t, sort: Math.max(0, sort) });
      ids.current.set(key, it.id);
      saved.current.set(key, t);
    });

  const addAfter = (i: number) => {
    const k = newKey();
    setRows((rs) => [...rs.slice(0, i + 1), { key: k, text: '' }, ...rs.slice(i + 1)]);
    setFocusKey(k);
  };

  const remove = (key: string) => {
    setRows((rs) => rs.filter((x) => x.key !== key));
    void enqueue(async () => {
      const id = ids.current.get(key);
      if (id) await window.spyder.deleteReviewItem(id);
      ids.current.delete(key);
    });
  };

  const drop = (to: number) => {
    if (drag === null || drag === to) return setDrag(null);
    const next = [...latest.current];
    const [moved] = next.splice(drag, 1);
    next.splice(to, 0, moved);
    setRows(next);
    setDrag(null);
    void enqueue(async () => {
      for (const [i, r] of next.entries()) {
        const id = ids.current.get(r.key);
        if (id) await window.spyder.saveReviewItem({ id, date, kind, text: saved.current.get(r.key) ?? r.text, sort: i });
      }
    });
  };

  return (
    <div data-testid={`bullets-${kind}`}>
      {rows.map((r, i) => (
        <div
          key={r.key}
          className={clsx('group flex h-9 items-center gap-1.5', drag === i && 'opacity-40')}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => drop(i)}
        >
          <span
            draggable
            onDragStart={() => setDrag(i)}
            onDragEnd={() => setDrag(null)}
            title="Drag to reorder"
            className="cursor-grab px-1 text-[13px] text-faint select-none hover:text-muted"
          >
            ⋮⋮
          </span>
          <input
            ref={(el) => {
              if (el) refs.current.set(r.key, el);
              else refs.current.delete(r.key);
            }}
            data-testid="bullet-input"
            value={r.text}
            placeholder={placeholder}
            onChange={(e) => setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, text: e.target.value } : x)))}
            // Empty rows stay until deleted: removing one on blur would shift the layout under the click
            // that caused the blur. Unsaved empty rows are gone on the next load.
            onBlur={() => void persist(r.key, r.text)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && r.text.trim()) {
                void persist(r.key, r.text);
                addAfter(i);
              }
            }}
            className="h-8 min-w-0 flex-1 rounded-control border border-transparent bg-transparent px-2 text-[13px] text-text outline-none placeholder:text-faint hover:border-border focus:border-accent focus:bg-surface-2"
          />
          <button
            aria-label="Delete"
            onClick={() => remove(r.key)}
            className="h-6 w-6 rounded-chip text-[14px] text-faint opacity-0 group-hover:opacity-100 hover:bg-surface-2 hover:text-text"
          >
            ×
          </button>
        </div>
      ))}
      <button
        data-testid={`add-${kind}`}
        onClick={() => addAfter(rows.length - 1)}
        className="mt-1 h-8 px-2 text-[12px] text-muted hover:text-text"
      >
        + Add
      </button>
    </div>
  );
}

// ---- KPIs --------------------------------------------------------------------------
/** KPIs are set up here, where they're filled in (P80): add, and with Edit rename or remove (archived, so past values stay). */
function Kpis({ date, kpis, values, onChanged }: { date: string; kpis: Kpi[]; values: Record<string, number>; onChanged: () => Promise<void> }) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('');
  const add = async () => {
    if (!name.trim()) return;
    await window.spyder.saveKpi({ name, unit });
    setName('');
    setUnit('');
    setAdding(false);
    await onChanged();
  };
  const edit = kpis.length > 0 && (
    <button data-testid="kpi-edit" onClick={() => setEditing((e) => !e)} className="rounded-control px-1.5 py-0.5 text-[12px] text-accent hover:bg-accent/10">
      {editing ? 'Done' : 'Edit'}
    </button>
  );
  return (
    <Card title="KPIs" right={edit}>
      {kpis.length === 0 && !adding && <div className="pb-2 text-[12px] text-faint">No KPIs yet. Add numbers you want to track daily.</div>}
      {kpis.map((k) =>
        editing ? <KpiEdit key={k.id} kpi={k} onChanged={onChanged} /> : <KpiInput key={k.id} date={date} kpi={k} value={values[k.id]} />,
      )}
      {adding ? (
        <div className="mt-2 flex items-center gap-2">
          <input
            autoFocus
            data-testid="kpi-name"
            className={clsx(inputCls, 'min-w-0 flex-1')}
            placeholder="KPI name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void add()}
          />
          <input
            data-testid="kpi-unit"
            className={clsx(inputCls, 'w-24')}
            placeholder="unit"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void add()}
          />
          <Btn variant="primary" disabled={!name.trim()} onClick={() => void add()}>
            Add
          </Btn>
        </div>
      ) : (
        <button data-testid="add-kpi" onClick={() => setAdding(true)} className="mt-1 h-8 px-2 text-[12px] text-muted hover:text-text">
          + Add KPI
        </button>
      )}
    </Card>
  );
}

function KpiEdit({ kpi, onChanged }: { kpi: Kpi; onChanged: () => Promise<void> }) {
  const [name, setName] = useState(kpi.name);
  const [unit, setUnit] = useState(kpi.unit ?? '');
  const save = async (archived = false) => {
    if (!name.trim()) return setName(kpi.name);
    await window.spyder.saveKpi({ id: kpi.id, name, unit, archived });
    await onChanged();
  };
  return (
    <div data-testid="kpi-edit-row" className="flex h-11 items-center gap-2 border-b border-border text-[13px] last-of-type:border-0">
      <input
        aria-label="KPI name"
        className={clsx(inputCls, 'h-8 min-w-0 flex-1')}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => name !== kpi.name && void save()}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      <input
        aria-label="Unit"
        placeholder="unit"
        className={clsx(inputCls, 'h-8 w-24')}
        value={unit}
        onChange={(e) => setUnit(e.target.value)}
        onBlur={() => unit !== (kpi.unit ?? '') && void save()}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      <Btn size="sm" variant="ghost" aria-label={`Remove ${kpi.name}`} onClick={() => void save(true)}>
        Remove
      </Btn>
    </div>
  );
}

function KpiInput({ date, kpi, value }: { date: string; kpi: Kpi; value: number | undefined }) {
  const [v, setV] = useState(value === undefined ? '' : String(value));
  const save = () => {
    const n = v.trim() === '' ? null : Number(v);
    if (n !== null && !Number.isFinite(n)) return;
    void window.spyder.setKpiValue(date, kpi.id, n);
  };
  return (
    <label className="flex h-11 items-center gap-3 border-b border-border text-[13px] last-of-type:border-0">
      <span className="min-w-0 flex-1 truncate">{kpi.name}</span>
      <input
        data-testid="kpi-input"
        data-kpi={kpi.name}
        type="number"
        inputMode="decimal"
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        className={clsx(inputCls, 'h-8 w-24 text-right tabular')}
      />
      <span className="w-14 text-muted">{kpi.unit ?? ''}</span>
    </label>
  );
}
