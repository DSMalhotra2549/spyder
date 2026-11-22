// Today page (plan §12, P55): stat row → session log → one-track timeline → apps & sites → distractions.
import clsx from 'clsx';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { dayLog, type AppRow, type LogEntry, type SessionLine } from '../../core/aggregate';
import type { ActivityCategory } from '../../core/categorize';
import { fmtDuration, fmtHM, fmtTime } from '../../core/format';
import type { DayVM } from '../../core/review';
import { Btn, NameInput, ProjectSelect } from '../ui/controls';
import { ExportButton } from './Export';
import { AWAY_LABEL, sessionColor, Timeline } from './Timeline';
import { CAT_COLOR, CAT_LABEL, CategoryChip, Empty, TopBar, useLoader } from './parts';
import { appTexts, dur, statTexts } from './stats';
import { showEditResult } from './toast';

export function Today({ date, onDate }: { date?: string; onDate: (d: string) => void }) {
  const [vm, reload] = useLoader(() => window.spyder.getDay(date), date ?? '', true);
  // Reload as soon as the running session changes (started, labelled, paused, ended), not on the next poll.
  useEffect(() => {
    let last = '';
    return window.spyder.onWidget((w) => {
      const k = [w.mode, w.sessionId, w.kind, w.label, w.isPaused].join('|');
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
        <SessionLog vm={vm} reload={reload} picked={picked} onPick={setPicked} />

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

// ---- session log (P52–P55) ------------------------------------------------------------------

const KIND_LABEL = { planned: 'Planned', timed: 'Timed', open: 'Open', break: 'Break' };
const span = (a: number, b: number | null, running = false) => `${fmtTime(a)}–${running ? 'now' : b !== null ? fmtTime(b) : ''}`;

function SessionLog({
  vm,
  reload,
  picked,
  onPick,
}: {
  vm: DayVM;
  reload: () => Promise<void>;
  picked: string | null;
  onPick: (id: string | null) => void;
}) {
  const s = vm.summary;
  const log = dayLog(s);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);
  const sessions = s.sessions;
  const chosen = sessions.filter((x) => checked.has(x.id));

  // `chosen` ignores ticks of sessions that are gone (deleted, merged).
  const toggle = (id: string) => {
    setMerging(false);
    setChecked((c) => {
      const n = new Set(c);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };
  const del = async (id: string) => {
    const r = await window.spyder.deleteSession(id);
    showEditResult(r, () => void reload());
    if (picked === id) onPick(null);
    await reload();
  };
  const merge = async (keepId: string) => {
    const r = await window.spyder.mergeSessions(keepId, chosen.map((x) => x.id));
    showEditResult(r, () => void reload());
    if (!('error' in r)) {
      setChecked(new Set());
      setMerging(false);
    }
    await reload();
  };

  const workCount = sessions.filter((x) => x.kind !== 'break').length;
  return (
    <section data-testid="session-log">
      <SectionHead
        title="Sessions"
        right={
          chosen.length === 0 ? (
            <>
              {workCount} {workCount === 1 ? 'session' : 'sessions'}
              {s.untrackedSec >= 60 && <span className="text-faint"> · {dur(s.untrackedSec)} untracked</span>}
            </>
          ) : undefined
        }
      >
        {chosen.length > 0 && (
          <div data-testid="selection-bar" className="ml-auto flex items-center gap-1.5">
            <span className="mr-1 text-[12px] text-muted tabular">{chosen.length} selected</span>
            <Btn size="sm" data-testid="merge-open" disabled={chosen.length < 2} onClick={() => setMerging(true)}>
              Merge…
            </Btn>
            <Btn size="sm" variant="ghost" onClick={() => setChecked(new Set())}>
              Clear
            </Btn>
          </div>
        )}
      </SectionHead>
      {merging && chosen.length >= 2 && <MergePanel chosen={chosen} onMerge={merge} onCancel={() => setMerging(false)} />}
      {log.length === 0 ? (
        <div className="rounded-card border border-border">
          <Empty>No sessions yet</Empty>
        </div>
      ) : (
        <ul className="overflow-hidden rounded-card border border-border bg-surface">
          {log.map((e) =>
            e.type === 'session' ? (
              editing === e.id ? (
                <EditRow
                  key={e.id}
                  x={e}
                  onDone={async (saved) => {
                    setEditing(null);
                    if (saved) await reload();
                  }}
                />
              ) : (
                <SessionRow
                  key={e.id}
                  x={e}
                  checked={checked.has(e.id)}
                  picked={picked === e.id}
                  onCheck={() => toggle(e.id)}
                  onPick={() => onPick(picked === e.id ? null : e.id)}
                  onEdit={() => setEditing(e.id)}
                  onDelete={() => void del(e.id)}
                />
              )
            ) : (
              <QuietRow key={`${e.type}${e.startMs}`} e={e} />
            ),
          )}
        </ul>
      )}
    </section>
  );
}

const rowCls = 'group flex h-10 items-center gap-3 border-b border-border pr-2 pl-3 text-[13px] last:border-0';

function Check({ on, onChange, label }: { on: boolean; onChange: () => void; label: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      aria-label={label}
      data-testid="session-check"
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
      className={clsx(
        'flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors',
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
      className={clsx(
        'flex h-7 w-7 items-center justify-center rounded-control text-muted hover:bg-surface-2',
        danger ? 'hover:text-red' : 'hover:text-text',
      )}
    >
      {children}
    </button>
  );
}

function SessionRow({
  x,
  checked,
  picked,
  onCheck,
  onPick,
  onEdit,
  onDelete,
}: {
  x: SessionLine;
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
  const over = x.deltaSec !== null && !!x.plannedSec && x.deltaSec > x.plannedSec * 0.1;
  const name = x.name ?? (x.kind === 'break' ? 'Break' : 'Unlabelled');
  return (
    <li
      ref={ref}
      data-testid="session-row"
      data-session={x.id}
      data-picked={picked || undefined}
      onClick={onPick}
      className={clsx(rowCls, 'cursor-default', picked ? 'bg-accent/8' : checked ? 'bg-surface-2/60' : 'hover:bg-surface-2/50')}
    >
      <Check on={checked} onChange={onCheck} label={`Select ${name}`} />
      <span className="w-[92px] shrink-0 text-muted tabular">{span(x.startMs, x.endMs, x.running)}</span>
      <span className="h-4 w-[3px] shrink-0 rounded-pill" style={{ background: sessionColor(x), opacity: x.kind === 'break' ? 0.5 : 1 }} />
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <button
          data-testid="session-name"
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          title="Rename"
          className={clsx('min-w-0 truncate text-left hover:underline hover:decoration-border-strong hover:underline-offset-4', !x.name && 'text-muted')}
        >
          {name}
        </button>
        {x.projectName && <span className="shrink-0 truncate text-[12px] text-muted">{x.projectName}</span>}
        {x.running && (
          <span className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-accent">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
            Running
          </span>
        )}
      </span>
      <span className={clsx('w-[104px] shrink-0 text-right text-[12px] tabular', over ? 'text-red' : 'text-faint')}>
        {x.plannedSec !== null ? `${KIND_LABEL[x.kind]} · ${dur(x.plannedSec)}` : KIND_LABEL[x.kind]}
      </span>
      <span data-testid="session-dur" className="w-[64px] shrink-0 text-right tabular">
        {dur(x.daySec)}
      </span>
      <span className="flex w-[60px] shrink-0 justify-end opacity-0 group-hover:opacity-100 focus-within:opacity-100">
        <IconBtn label="Rename" testId="session-rename" onClick={onEdit}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M10.5 2.5l3 3L6 13H3v-3z" />
          </svg>
        </IconBtn>
        <IconBtn label="Delete" testId="session-delete" onClick={onDelete} danger>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4" />
          </svg>
        </IconBtn>
      </span>
    </li>
  );
}

/** Rename: name + project in one inline edit (P52). Enter saves, Escape cancels. */
function EditRow({ x, onDone }: { x: SessionLine; onDone: (saved: boolean) => Promise<void> }) {
  const [name, setName] = useState(x.name ?? '');
  const [project, setProject] = useState<string | null>(x.projectId);
  const save = async () => {
    if (!name.trim()) return;
    await window.spyder.label(x.id, name.trim(), project);
    await onDone(true);
  };
  return (
    <li
      data-testid="session-edit"
      className="flex items-center gap-2 border-b border-border bg-surface-2/50 py-2 pr-2 pl-3 last:border-0"
      onKeyDown={(e) => {
        if (e.key === 'Escape') void onDone(false);
      }}
    >
      <span className="w-[92px] shrink-0 pl-7 text-[13px] text-muted tabular">{fmtTime(x.startMs)}</span>
      <div className="min-w-0 flex-1">
        <NameInput value={name} onChange={setName} onEnter={() => void save()} placeholder="Name this session" autoFocus />
      </div>
      <div className="w-[180px] shrink-0">
        <ProjectSelect value={project} onChange={setProject} />
      </div>
      <Btn variant="primary" disabled={!name.trim()} onClick={() => void save()}>
        Save
      </Btn>
      <Btn variant="ghost" onClick={() => void onDone(false)}>
        Cancel
      </Btn>
    </li>
  );
}

/** Away periods and untracked spans: read-only lines in the log. */
function QuietRow({ e }: { e: Exclude<LogEntry, { type: 'session' }> }) {
  const away = e.type === 'away';
  const text = away
    ? e.classification
      ? `Away · ${e.label ?? AWAY_LABEL[e.classification]}`
      : 'Away · not classified'
    : 'Untracked';
  return (
    <li data-testid={away ? 'log-away' : 'log-untracked'} className={clsx(rowCls, 'text-muted')}>
      <span className="w-4 shrink-0" />
      <span className="w-[92px] shrink-0 tabular">{span(e.startMs, e.endMs)}</span>
      <span
        className={clsx('h-4 w-[3px] shrink-0 rounded-pill', !away && 'bg-faint/60')}
        style={away ? { background: 'var(--color-away)', opacity: e.classification ? 0.6 : 0.35 } : undefined}
      />
      <span className={clsx('min-w-0 flex-1 truncate', !away && 'text-faint')}>{text}</span>
      <span className="w-[64px] shrink-0 text-right tabular">{dur(e.sec)}</span>
      <span className="w-[60px] shrink-0" />
    </li>
  );
}

/** Pick the session that keeps its name (P54): the longest is pre-picked; a running one is always kept. */
function MergePanel({ chosen, onMerge, onCancel }: { chosen: SessionLine[]; onMerge: (keepId: string) => Promise<void>; onCancel: () => void }) {
  const running = chosen.find((x) => x.running);
  const longest = [...chosen].sort((a, b) => b.elapsedSec - a.elapsedSec)[0];
  const [keep, setKeep] = useState((running ?? longest).id);
  const breaks = chosen.filter((x) => x.kind === 'break').length;
  const mixed = breaks > 0 && breaks < chosen.length;
  const keepId = running?.id ?? (chosen.some((x) => x.id === keep) ? keep : longest.id);
  return (
    <div data-testid="merge-panel" className="mb-3 rounded-card border border-border-strong bg-surface p-4 shadow-pop">
      <div className="mb-1 section-title">Merge {chosen.length} sessions</div>
      <p className="mb-3 text-[12px] text-muted">
        {running
          ? 'The running session is kept and keeps running; the others’ time moves into it.'
          : 'Keep the name, project and plan of:'}
      </p>
      <div className="mb-4 flex flex-col gap-1">
        {chosen.map((x) => (
          <label
            key={x.id}
            className={clsx(
              'flex h-8 items-center gap-2.5 rounded-control px-2 text-[13px]',
              keepId === x.id ? 'bg-surface-2' : 'hover:bg-surface-2/60',
              running && x.id !== running.id && 'opacity-50',
            )}
          >
            <input
              type="radio"
              name="merge-keep"
              data-testid="merge-keep"
              value={x.id}
              checked={keepId === x.id}
              disabled={!!running && x.id !== running.id}
              onChange={() => setKeep(x.id)}
              className="accent-[var(--color-accent)]"
            />
            <span className="w-[92px] text-muted tabular">{span(x.startMs, x.endMs, x.running)}</span>
            <span className={clsx('min-w-0 flex-1 truncate', !x.name && 'text-muted')}>
              {x.name ?? (x.kind === 'break' ? 'Break' : 'Unlabelled')}
            </span>
            <span className="text-muted tabular">{dur(x.daySec)}</span>
          </label>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Btn variant="primary" data-testid="merge-confirm" disabled={mixed} onClick={() => void onMerge(keepId)}>
          Merge
        </Btn>
        <Btn variant="ghost" onClick={onCancel}>
          Cancel
        </Btn>
        {mixed && <span className="text-[12px] text-red">Breaks merge only with breaks</span>}
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
      {item(<span className="h-2 w-2 rounded-[2px] bg-accent" />, 'Session')}
      {item(<span className="h-2 w-2 rounded-[2px] bg-break/50" />, 'Break')}
      {item(<span className="h-2 w-2 rounded-[2px] bg-away/50" />, 'Away')}
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
