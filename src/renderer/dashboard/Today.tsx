// Today page (plan §12, P55, P64): stat row → block log → one-track timeline → apps & sites → distractions.
import clsx from 'clsx';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { dayLog, type AppRow, type LogEntry, type SessionLine } from '../../core/aggregate';
import type { ActivityCategory } from '../../core/categorize';
import { fmtDuration, fmtHM, fmtTime } from '../../core/format';
import type { DayVM } from '../../core/review';
import type { EngineError } from '../../core/types';
import type { EditResult, Ok } from '../../preload/api';
import { AnswerInput, Btn } from '../ui/controls';
import { ExportButton } from './Export';
import { answerText, blockColor, Timeline } from './Timeline';
import { CAT_COLOR, CAT_LABEL, CategoryChip, Empty, TopBar, useLoader } from './parts';
import { appTexts, dur, statTexts } from './stats';
import { showEditResult } from './toast';

export function Today({ date, onDate }: { date?: string; onDate: (d: string) => void }) {
  const [vm, reload] = useLoader(() => window.spyder.getDay(date), date ?? '', true);
  // Reload as soon as a block starts or ends or an answer lands, not on the next poll.
  useEffect(() => {
    let last = '';
    return window.spyder.onWidget((w) => {
      const k = [w.mode, w.blockId, w.pendingCount].join('|');
      if (k !== last) void reload(); // the first push too: the page may have loaded before it
      last = k;
    });
  }, [reload]);
  if (!vm) return <TopBar title="Today" />;
  return (
    <>
      <TopBar title="Today" date={vm.date} today={vm.today} onDate={onDate} actions={<ExportButton />} />
      <TodayBody key={vm.date} vm={vm} reload={reload} />
    </>
  );
}

function TodayBody({ vm, reload }: { vm: DayVM; reload: () => Promise<void> }) {
  const s = vm.summary;
  const t = statTexts(s, vm.streak);
  const [picked, setPicked] = useState<string | null>(null);
  return (
    <div className="flex-1 overflow-x-hidden overflow-y-auto" data-testid="today">
      <div className="mx-auto flex max-w-[960px] flex-col gap-8 px-8 pt-6 pb-16">
        <StatRow vm={vm} t={t} />
        <BlockLog vm={vm} reload={reload} picked={picked} onPick={setPicked} />

        <section data-testid="timeline-card">
          <SectionHead title="Timeline" right={<TimelineLegend />} />
          <Timeline
            s={s}
            nowMs={vm.date === vm.today ? vm.nowMs : -1}
            selected={picked}
            onPick={(id) => setPicked((cur) => (cur === id ? null : id))}
          />
        </section>

        <section>
          <SectionHead title="Apps & sites" right={s.scope === 'work_hours' ? 'Work hours' : 'All day'} />
          <CategoryBar totals={s.categoryTotals} />
          <TopApps rows={s.apps} reload={reload} />
        </section>

        {(s.flags.length > 0 || s.distractingSec > 0) && <Distractions vm={vm} t={t} />}

        {s.offHoursActivitySec > 0 && (
          <p data-testid="off-hours-note" className="-mt-4 text-[12px] text-faint">
            {fmtDuration(s.offHoursActivitySec)} of activity outside work hours
            {s.scope === 'work_hours' ? ' (not in the percentages)' : ''}.
          </p>
        )}
      </div>
    </div>
  );
}

function SectionHead({ title, right, children }: { title: string; right?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-3 flex min-h-7 items-center gap-3">
      <h2 className="section-title">{title}</h2>
      {children}
      {right && <div className="ml-auto text-[12px] text-muted tabular">{right}</div>}
    </div>
  );
}

// ---- stat row --------------------------------------------------------------------------

/** Productive vs goal (with a thin bar), worked, day score, streak — one bordered strip. */
function StatRow({ vm, t }: { vm: DayVM; t: ReturnType<typeof statTexts> }) {
  const s = vm.summary;
  const frac = s.goalSec > 0 ? Math.min(1, s.productiveSec / s.goalSec) : 0;
  return (
    <section className="grid grid-cols-4 divide-x divide-border rounded-card border border-border bg-surface">
      <StatCell label="Productive" id="stat-productive" value={t.productive} sub={t.productiveSub} tone={s.goalMet ? 'green' : undefined}>
        <div className="mt-2 h-1 overflow-hidden rounded-pill bg-surface-2">
          <div className={clsx('h-full rounded-pill', s.goalMet ? 'bg-green' : 'bg-accent')} style={{ width: `${frac * 100}%` }} />
        </div>
      </StatCell>
      <StatCell label="Worked" id="stat-work" value={t.work} sub={t.workSub} />
      <StatCell label="Day score" id="stat-score" value={t.score} sub={t.scoreSub} />
      <StatCell label="Streak" id="stat-streak" value={t.streak} sub="goal met in a row" />
    </section>
  );
}

function StatCell({
  label,
  id,
  value,
  sub,
  tone,
  children,
}: {
  label: string;
  id: string;
  value: string;
  sub: string;
  tone?: 'green';
  children?: ReactNode;
}) {
  return (
    <div className="min-w-0 px-4 py-3">
      <div className="section-label mb-1">{label}</div>
      <div data-testid={id} className={clsx('text-[20px] leading-tight font-semibold tabular', tone === 'green' && 'text-green')}>
        {value}
      </div>
      {children}
      <div data-testid={id === 'stat-streak' ? undefined : `${id}-sub`} className="mt-1 truncate text-[12px] text-muted tabular">
        {sub}
      </div>
    </div>
  );
}

// ---- block log (P64) ------------------------------------------------------------------------

const span = (a: number, b: number | null, running = false) => `${fmtTime(a)}–${running ? 'now' : b !== null ? fmtTime(b) : ''}`;
/** Blocks this close count as adjacent (matches the merge rule in main). */
const ADJACENT_MS = 1000;
const adjacent = (a: SessionLine, b: SessionLine) => a.endMs !== null && Math.abs(b.startMs - a.endMs) <= ADJACENT_MS;
const sameAnswer = (a: SessionLine, b: SessionLine) => a.kind === b.kind && (a.kind === 'break' || (a.name !== null && a.name === b.name));

/** Why the chosen blocks can't be merged, or null when they can. */
function mergeProblem(chosen: SessionLine[]): string | null {
  if (chosen.length < 2) return 'Pick at least two blocks';
  if (chosen.some((x) => x.running)) return 'The running block can’t be edited until it ends';
  for (let i = 1; i < chosen.length; i++) if (!adjacent(chosen[i - 1], chosen[i])) return 'Only blocks next to each other can be merged';
  const breaks = chosen.filter((x) => x.kind === 'break').length;
  if (breaks && breaks !== chosen.length) return 'A break can’t be merged with work blocks';
  return null;
}

type Panel = { type: 'answer' } | { type: 'merge' } | null;

function BlockLog({ vm, reload, picked, onPick }: { vm: DayVM; reload: () => Promise<void>; picked: string | null; onPick: (id: string | null) => void }) {
  const s = vm.summary;
  const log = dayLog(s);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const blocks = s.sessions;
  // `chosen` ignores ticks of blocks that are gone (deleted, merged); it's in time order.
  const chosen = blocks.filter((x) => checked.has(x.id));

  const toggle = (id: string) => {
    setPanel(null);
    setChecked((c) => {
      const n = new Set(c);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };
  const after = async (r: EditResult | Ok | EngineError) => {
    if ('undoId' in r || 'error' in r) showEditResult(r, () => void reload());
    if (!('error' in r)) {
      setChecked(new Set());
      setPanel(null);
    }
    await reload();
  };
  const del = async (ids: string[]) => {
    if (picked && ids.includes(picked)) onPick(null);
    await after(await window.spyder.deleteBlocks(ids));
  };

  // Consecutive blocks with the same answer are shown joined (P64).
  const joinedWithPrev = new Set<string>();
  const groupOf = new Map<string, { count: number; sec: number }>();
  let head: SessionLine | null = null;
  let prev: SessionLine | null = null;
  for (const x of blocks) {
    if (prev && !x.running && !prev.running && adjacent(prev, x) && sameAnswer(prev, x)) {
      joinedWithPrev.add(x.id);
      const g = groupOf.get(head!.id) ?? { count: 1, sec: head!.daySec };
      groupOf.set(head!.id, { count: g.count + 1, sec: g.sec + x.daySec });
    } else head = x;
    prev = x;
  }

  const workCount = blocks.filter((x) => x.kind !== 'break').length;
  const pending = blocks.filter((x) => x.kind !== 'break' && x.name === null && !x.running).length;
  const problem = mergeProblem(chosen);
  return (
    <section data-testid="block-log">
      <SectionHead
        title="Blocks"
        right={
          chosen.length === 0 ? (
            <>
              {workCount} {workCount === 1 ? 'block' : 'blocks'}
              {pending > 0 && <span className="text-orange"> · {pending} not accounted for</span>}
              {s.untrackedSec >= 60 && <span className="text-faint"> · {dur(s.untrackedSec)} untracked</span>}
            </>
          ) : undefined
        }
      >
        {chosen.length > 0 && (
          <div data-testid="selection-bar" className="ml-auto flex items-center gap-1.5">
            <span className="mr-1 text-[12px] text-muted tabular">{chosen.length} selected</span>
            <Btn size="sm" data-testid="answer-open" onClick={() => setPanel({ type: 'answer' })}>
              Answer…
            </Btn>
            <Btn size="sm" data-testid="merge-open" disabled={chosen.length < 2} title={problem ?? undefined} onClick={() => setPanel({ type: 'merge' })}>
              Merge…
            </Btn>
            <Btn size="sm" variant="danger" data-testid="delete-selected" onClick={() => void del(chosen.map((x) => x.id))}>
              Delete
            </Btn>
            <Btn size="sm" variant="ghost" onClick={() => setChecked(new Set())}>
              Clear
            </Btn>
          </div>
        )}
      </SectionHead>
      {panel && chosen.length > 0 && (
        <AnswerPanel
          key={panel.type}
          chosen={chosen}
          merge={panel.type === 'merge'}
          problem={panel.type === 'merge' ? problem : null}
          onCancel={() => setPanel(null)}
          onSave={async (answer) =>
            after(
              panel.type === 'merge'
                ? await window.spyder.mergeBlocks(chosen.map((x) => x.id), answer)
                : await window.spyder.answerBlocks(chosen.map((x) => ({ id: x.id, answer }))),
            )
          }
        />
      )}
      {log.length === 0 ? (
        <div className="rounded-card border border-border">
          <Empty>No blocks yet. Press Start in the sidebar.</Empty>
        </div>
      ) : (
        <ul className="overflow-hidden rounded-card border border-border bg-surface">
          {log.map((e, i) => {
            if (e.type !== 'session') return <QuietRow key={`${e.type}${e.startMs}`} e={e} />;
            const next = log[i + 1];
            const joinedNext = next?.type === 'session' && joinedWithPrev.has(next.id);
            return editing === e.id ? (
              <EditRow
                key={e.id}
                x={e}
                onDone={async (saved) => {
                  setEditing(null);
                  if (saved) await reload();
                }}
              />
            ) : (
              <BlockRow
                key={e.id}
                x={e}
                joinedPrev={joinedWithPrev.has(e.id)}
                joinedNext={joinedNext}
                group={groupOf.get(e.id) ?? null}
                checked={checked.has(e.id)}
                picked={picked === e.id}
                onCheck={() => toggle(e.id)}
                onPick={() => onPick(picked === e.id ? null : e.id)}
                onEdit={() => setEditing(e.id)}
                onDelete={() => void del([e.id])}
              />
            );
          })}
        </ul>
      )}
    </section>
  );
}

const rowCls = 'group flex h-10 items-center gap-3 border-b border-border pr-2 pl-3 text-[13px] last:border-0';

function Check({ on, onChange, label, disabled }: { on: boolean; onChange: () => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      data-testid="block-check"
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
      className={clsx(
        'flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors disabled:invisible',
        on ? 'border-accent bg-accent text-on-accent' : 'border-border-strong bg-surface group-hover:border-muted',
      )}
    >
      {on && (
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <path d="M2 5.2 4.1 7.3 8 3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}

function IconBtn({ label, testId, onClick, children, danger }: { label: string; testId: string; onClick: () => void; children: ReactNode; danger?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-testid={testId}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={clsx('flex h-7 w-7 items-center justify-center rounded-control text-muted hover:bg-surface-2', danger ? 'hover:text-red' : 'hover:text-text')}
    >
      {children}
    </button>
  );
}

function BlockRow({
  x,
  joinedPrev,
  joinedNext,
  group,
  checked,
  picked,
  onCheck,
  onPick,
  onEdit,
  onDelete,
}: {
  x: SessionLine;
  joinedPrev: boolean;
  joinedNext: boolean;
  group: { count: number; sec: number } | null;
  checked: boolean;
  picked: boolean;
  onCheck: () => void;
  onPick: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (picked) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [picked]);
  const text = answerText(x);
  const unanswered = x.kind !== 'break' && x.name === null;
  return (
    <li
      ref={ref}
      data-testid="block-row"
      data-session={x.id}
      data-picked={picked || undefined}
      data-joined={joinedPrev || undefined}
      onClick={onPick}
      className={clsx(
        rowCls,
        'cursor-default',
        joinedNext && 'border-b-transparent',
        picked ? 'bg-accent/8' : checked ? 'bg-surface-2/60' : 'hover:bg-surface-2/50',
      )}
    >
      <Check on={checked} onChange={onCheck} label={`Select ${text}`} disabled={x.running} />
      <span className="w-[92px] shrink-0 text-muted tabular">{span(x.startMs, x.endMs, x.running)}</span>
      <span
        className={clsx('w-[3px] shrink-0', joinedPrev || joinedNext ? 'self-stretch' : 'h-4 rounded-pill', joinedPrev && !joinedNext && 'mb-2', joinedNext && !joinedPrev && 'mt-2')}
        style={{ background: blockColor(x), opacity: x.kind === 'break' ? 0.5 : 1 }}
      />
      <span className="flex min-w-0 flex-1 items-center gap-2">
        {x.running ? (
          <span className="flex shrink-0 items-center gap-1 text-[12px] font-medium text-accent">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
            Running
          </span>
        ) : (
          <button
            data-testid="block-answer"
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
            title="Change the answer"
            className={clsx(
              'min-w-0 truncate text-left hover:underline hover:decoration-border-strong hover:underline-offset-4',
              unanswered ? 'text-orange' : joinedPrev ? 'text-faint' : undefined,
            )}
          >
            {text}
          </button>
        )}
        {group && (
          <span data-testid="block-group" className="shrink-0 text-[11px] text-faint tabular">
            {group.count} blocks · {dur(group.sec)}
          </span>
        )}
      </span>
      <span data-testid="block-dur" className="w-[64px] shrink-0 text-right tabular">
        {dur(x.daySec)}
      </span>
      <span className="flex w-[60px] shrink-0 justify-end opacity-0 group-hover:opacity-100 focus-within:opacity-100">
        {!x.running && (
          <>
            <IconBtn label="Change the answer" testId="block-edit" onClick={onEdit}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M10.5 2.5l3 3L6 13H3v-3z" />
              </svg>
            </IconBtn>
            <IconBtn label="Delete" testId="block-delete" onClick={onDelete} danger>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4" />
              </svg>
            </IconBtn>
          </>
        )}
      </span>
    </li>
  );
}

/** Re-answer one block inline (P64): text, or Break. Enter saves, Escape cancels. */
function EditRow({ x, onDone }: { x: SessionLine; onDone: (saved: boolean) => Promise<void> }) {
  const [text, setText] = useState(x.kind === 'break' ? '' : (x.name ?? ''));
  const [error, setError] = useState<string | null>(null);
  const save = async (answer: string | null) => {
    if (answer !== null && !answer.trim()) return setError('Say what you did, or pick Break');
    const r = await window.spyder.answerBlocks([{ id: x.id, answer }]);
    if ('error' in r) return setError(r.message);
    await onDone(true);
  };
  return (
    <li
      data-testid="block-edit-row"
      className="flex flex-col gap-1 border-b border-border bg-surface-2/50 py-2 pr-2 pl-3 last:border-0"
      onKeyDown={(e) => {
        if (e.key === 'Escape') void onDone(false);
      }}
    >
      <div className="flex items-center gap-2">
        <span className="w-[92px] shrink-0 pl-7 text-[13px] text-muted tabular">{span(x.startMs, x.endMs)}</span>
        <div className="min-w-0 flex-1">
          <AnswerInput value={text} onChange={setText} onEnter={() => void save(text)} autoFocus />
        </div>
        <Btn variant="primary" data-testid="edit-save" onClick={() => void save(text)}>
          Save
        </Btn>
        <Btn data-testid="edit-break" onClick={() => void save(null)}>
          Break
        </Btn>
        <Btn variant="ghost" onClick={() => void onDone(false)}>
          Cancel
        </Btn>
      </div>
      {error && <div className="pl-[124px] text-[12px] text-red">{error}</div>}
    </li>
  );
}

/** Untracked spans: read-only lines in the log. */
function QuietRow({ e }: { e: Exclude<LogEntry, { type: 'session' }> }) {
  return (
    <li data-testid={e.type === 'away' ? 'log-away' : 'log-untracked'} className={clsx(rowCls, 'text-muted')}>
      <span className="w-4 shrink-0" />
      <span className="w-[92px] shrink-0 tabular">{span(e.startMs, e.endMs)}</span>
      <span className="h-4 w-[3px] shrink-0 rounded-pill bg-faint/60" />
      <span className="min-w-0 flex-1 truncate text-faint">{e.type === 'away' ? 'Away' : 'Untracked'}</span>
      <span className="w-[64px] shrink-0 text-right tabular">{dur(e.sec)}</span>
      <span className="w-[60px] shrink-0" />
    </li>
  );
}

/** One answer for the selected blocks, or merging adjacent ones into one longer block (P64). */
function AnswerPanel({
  chosen,
  merge,
  problem,
  onSave,
  onCancel,
}: {
  chosen: SessionLine[];
  merge: boolean;
  problem: string | null;
  onSave: (answer: string | null) => Promise<void>;
  onCancel: () => void;
}) {
  const allBreaks = chosen.every((x) => x.kind === 'break');
  const names = new Set(chosen.map((x) => (x.kind === 'break' ? null : x.name)));
  const common = names.size === 1 ? [...names][0] : null;
  const [text, setText] = useState(common ?? '');
  const [error, setError] = useState<string | null>(null);
  const total = chosen.reduce((t, x) => t + x.daySec, 0);
  const save = async (answer: string | null) => {
    if (answer !== null && !answer.trim()) return setError('Say what you did, or pick Break');
    setError(null);
    await onSave(answer);
  };
  return (
    <div data-testid={merge ? 'merge-panel' : 'answer-panel'} className="mb-3 rounded-card border border-border-strong bg-surface p-4 shadow-pop">
      <div className="mb-1 section-title">{merge ? `Merge ${chosen.length} blocks` : `Answer ${chosen.length} ${chosen.length === 1 ? 'block' : 'blocks'}`}</div>
      <p className="mb-3 text-[12px] text-muted">
        {merge
          ? `They become one ${dur(total)} block, ${span(chosen[0].startMs, chosen[chosen.length - 1].endMs)}, with one answer.`
          : 'Every selected block gets this answer.'}
      </p>
      {problem ? (
        <p className="mb-3 text-[12px] text-red">{problem}</p>
      ) : (
        <div className="mb-3 flex items-center gap-2">
          {!(merge && allBreaks) && (
            <div className="min-w-0 flex-1">
              <AnswerInput value={text} onChange={setText} onEnter={() => void save(text)} autoFocus />
            </div>
          )}
          {!(merge && allBreaks) && (
            <Btn variant="primary" data-testid="panel-save" onClick={() => void save(text)}>
              {merge ? 'Merge' : 'Save'}
            </Btn>
          )}
          {(!merge || allBreaks) && (
            <Btn variant={merge ? 'primary' : 'secondary'} data-testid="panel-break" onClick={() => void save(null)}>
              {merge ? 'Merge breaks' : 'Break'}
            </Btn>
          )}
        </div>
      )}
      <div className="flex items-center gap-2">
        <Btn variant="ghost" onClick={onCancel}>
          Cancel
        </Btn>
        {error && <span className="text-[12px] text-red">{error}</span>}
      </div>
    </div>
  );
}

// ---- timeline legend, apps, distractions ---------------------------------------------------

function TimelineLegend() {
  const item = (swatch: ReactNode, label: string) => (
    <span className="flex items-center gap-1.5">
      {swatch}
      {label}
    </span>
  );
  return (
    <span className="flex items-center gap-4 text-faint">
      {item(<span className="h-2 w-2 rounded-[2px] bg-accent" />, 'Accounted for')}
      {item(<span className="h-2 w-2 rounded-[2px] bg-open" />, 'Not yet')}
      {item(<span className="h-2 w-2 rounded-[2px] bg-break/50" />, 'Break')}
      {item(<span className="hatch h-2 w-2 rounded-[2px]" />, 'Untracked')}
    </span>
  );
}

/** One thin stacked bar with an inline legend. */
function CategoryBar({ totals }: { totals: Record<ActivityCategory, number> }) {
  const data = (Object.keys(totals) as ActivityCategory[]).map((k) => ({ k, v: totals[k] })).filter((d) => d.v > 0);
  const total = data.reduce((n, d) => n + d.v, 0);
  if (!total) return <Empty>No activity recorded</Empty>;
  return (
    <div className="mb-3">
      <div className="flex h-1.5 gap-px overflow-hidden rounded-pill">
        {data.map((d) => (
          <div key={d.k} style={{ width: `${(d.v / total) * 100}%`, background: CAT_COLOR[d.k] }} />
        ))}
      </div>
      <ul className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-muted">
        {data.map((d) => (
          <li key={d.k} data-testid={`cat-${d.k}`} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-[2px]" style={{ background: CAT_COLOR[d.k] }} />
            {CAT_LABEL[d.k]}
            <span className="text-text tabular">{fmtHM(d.v)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const TOP_N = 5;

/** Top apps & sites, the rest behind "Show all". Category is a quiet, clickable label (P12). */
function TopApps({ rows, reload }: { rows: AppRow[]; reload: () => Promise<void> }) {
  const [all, setAll] = useState(false);
  if (!rows.length) return null;
  const shown = all ? rows : rows.slice(0, TOP_N);
  return (
    <>
      <ol className="rounded-card border border-border bg-surface">
        {shown.map((a) => {
          const t = appTexts(a);
          const target = a.ruleTarget;
          return (
            <li key={a.key} data-testid="app-row" className="flex h-10 items-center gap-3 border-b border-border px-3 text-[13px] last:border-0">
              <span className="h-2 w-2 shrink-0 rounded-[2px]" style={{ background: CAT_COLOR[a.category] }} />
              <span data-k="key" className="min-w-0 flex-1 truncate">
                {t.key}
              </span>
              <span data-k="time" className="w-12 text-right tabular">
                {t.time}
              </span>
              <span data-k="pct" className="w-12 text-right text-[12px] text-faint tabular">
                {t.pct}
              </span>
              <div className="flex w-[120px] justify-end">
                <CategoryChip
                  quiet
                  category={a.category}
                  onPick={
                    target
                      ? async (c) => {
                          await window.spyder.saveRule({ ...target, category: c });
                          await reload();
                        }
                      : undefined
                  }
                />
              </div>
            </li>
          );
        })}
      </ol>
      {rows.length > TOP_N && (
        <button data-testid="apps-show-all" onClick={() => setAll((v) => !v)} className="mt-2 text-[12px] text-muted hover:text-text">
          {all ? 'Show less' : `Show all ${rows.length}`}
        </button>
      )}
    </>
  );
}

function Distractions({ vm, t }: { vm: DayVM; t: ReturnType<typeof statTexts> }) {
  const s = vm.summary;
  return (
    <section>
      <SectionHead
        title="Distractions"
        right={
          <>
            <span data-testid="stat-distractions" className="text-red">
              {t.distractions}
            </span>{' '}
            {s.flags.length === 1 ? 'flag' : 'flags'} · <span data-testid="stat-distractions-sub">{t.distractionsSub}</span>
          </>
        }
      />
      {s.flags.length > 0 ? (
        <ul className="rounded-card border border-border bg-surface">
          {s.flags.map((f, i) => (
            <li key={i} data-testid="flag-row" className="flex h-10 items-center gap-3 border-b border-border px-3 text-[13px] last:border-0">
              <span className="h-2 w-2 shrink-0 rounded-full bg-red" />
              <span className="w-12 text-muted tabular">{fmtTime(f.tsMs)}</span>
              <span className="min-w-0 flex-1 truncate">{f.target}</span>
              <span className="text-muted tabular">{fmtDuration(f.continuousSec)} straight</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[12px] text-muted">No single distraction lasted long enough to flag.</p>
      )}
    </section>
  );
}

/** Ranked apps & sites with a category chip per row (Week's top 10). */
export function AppsList({ rows, reload, compact }: { rows: AppRow[]; reload: () => Promise<void>; compact?: boolean }) {
  if (!rows.length) return <Empty>No activity recorded</Empty>;
  return (
    <ol>
      {rows.map((a, i) => {
        const t = appTexts(a);
        const target = a.ruleTarget;
        return (
          <li key={a.key} data-testid="app-row" className="relative flex h-9 items-center gap-3 border-b border-border px-2 text-[13px] last:border-0">
            <div className="absolute inset-y-1.5 left-0 rounded-bar" style={{ width: `${a.pct}%`, background: CAT_COLOR[a.category], opacity: 0.12 }} />
            <span className="relative w-5 text-faint tabular">{i + 1}</span>
            <span data-k="key" className="relative min-w-0 flex-1 truncate">
              {t.key}
            </span>
            <span data-k="time" className={clsx('relative text-right tabular', compact ? 'w-11' : 'w-14')}>
              {t.time}
            </span>
            <span data-k="pct" className={clsx('relative text-right text-muted tabular', compact ? 'w-12' : 'w-14')}>
              {t.pct}
            </span>
            {!compact && (
              <div className="relative flex w-[124px] justify-end">
                <CategoryChip
                  category={a.category}
                  onPick={
                    target
                      ? async (c) => {
                          await window.spyder.saveRule({ ...target, category: c });
                          await reload();
                        }
                      : undefined
                  }
                />
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
