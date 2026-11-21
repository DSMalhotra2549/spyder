// Start-session popover (plan §12, DESIGN.md §3), rendered in the prompt window.
import clsx from 'clsx';
import { useState } from 'react';
import { fmtDuration } from '../../core/format';
import type { Direction, Kind } from '../../core/types';
import { Btn, NameInput, ProjectSelect, inputCls } from '../ui/controls';
import { Card, Row } from './PromptWindow';

const TABS: { kind: Kind; label: string }[] = [
  { kind: 'planned', label: 'Planned' },
  { kind: 'timed', label: 'Timed' },
  { kind: 'open', label: 'Open' },
  { kind: 'break', label: 'Break' },
];
const PRESETS = [15, 25, 30, 45, 60, 90];

export function StartPopover({ tab, defaultDirection }: { tab: Kind; defaultDirection: Direction }) {
  const [kind, setKind] = useState<Kind>(tab);
  const [name, setName] = useState('');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [minutes, setMinutes] = useState<number | null>(kind === 'break' || kind === 'open' ? null : 30);
  const [customMin, setCustomMin] = useState('');
  const [direction, setDirection] = useState<Direction>(defaultDirection);
  const [error, setError] = useState<string | null>(null);
  // P21: the running session must be labelled before switching.
  const [pending, setPending] = useState<{ sessionId: string; elapsedSec: number } | null>(null);
  const [prevName, setPrevName] = useState('');
  const [prevProject, setPrevProject] = useState<string | null>(null);

  const hasName = kind === 'planned' || kind === 'open';
  const hasDuration = kind !== 'open';
  const durationRequired = kind === 'planned' || kind === 'timed';

  const submit = async () => {
    setError(null);
    if (kind === 'planned' && !name.trim()) return setError('Name the session');
    if (durationRequired && !minutes) return setError('Pick a duration');
    if (pending) {
      if (!prevName.trim()) return setError('Label the previous session first');
      const r = await window.spyder.label(pending.sessionId, prevName.trim(), prevProject);
      if ('error' in r) return setError('Could not save the label');
      setPending(null);
    }
    const r = await window.spyder.start({
      kind,
      name: hasName ? name.trim() || null : null,
      projectId: kind === 'break' ? null : projectId,
      plannedSec: hasDuration && minutes ? minutes * 60 : null,
      direction: kind === 'planned' ? direction : null,
    });
    if ('ok' in r) return;
    if (r.error === 'needs_label') setPending({ sessionId: r.sessionId, elapsedSec: r.elapsedSec ?? 0 });
    else setError('message' in r ? r.message : 'Could not start');
  };

  return (
    <Card color="var(--color-accent)" heading="Start a session">
      {pending && (
        <div data-testid="needs-label" className="flex flex-col gap-2 rounded-control border border-border bg-surface-2/50 p-3">
          <div className="text-[13px] font-semibold">What were you doing for the last {fmtDuration(pending.elapsedSec)}?</div>
          <NameInput value={prevName} onChange={setPrevName} autoFocus placeholder="Previous session" onEnter={() => void submit()} />
          <ProjectSelect value={prevProject} onChange={setPrevProject} />
        </div>
      )}
      <div role="tablist" className="no-drag flex rounded-pill bg-surface-2 p-0.5">
        {TABS.map((t) => (
          <button
            key={t.kind}
            role="tab"
            type="button"
            aria-selected={t.kind === kind}
            onClick={() => {
              setKind(t.kind);
              if (t.kind === 'open') setMinutes(null);
              else if (t.kind !== 'break' && !minutes) setMinutes(30);
            }}
            className={clsx(
              'h-7 flex-1 rounded-pill text-[12px] font-semibold',
              t.kind === kind ? 'bg-accent text-white' : 'text-muted hover:text-text',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {hasName && (
        <div className="flex flex-col gap-1.5">
          <label className="text-[12px] text-muted">
            What are you working on?{kind === 'open' && ' (optional)'}
          </label>
          <NameInput value={name} onChange={setName} autoFocus={!pending} onEnter={() => void submit()} />
        </div>
      )}
      {kind !== 'break' && <ProjectSelect value={projectId} onChange={setProjectId} />}
      {hasDuration && (
        <div className="flex flex-col gap-1.5">
          <label className="text-[12px] text-muted">Duration{kind === 'break' && ' (optional)'}</label>
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMinutes(minutes === m && kind === 'break' ? null : m);
                  setCustomMin('');
                }}
                className={clsx(
                  'no-drag tabular h-7 min-w-10 rounded-pill border px-2.5 text-[12px] font-semibold',
                  minutes === m && !customMin
                    ? 'border-accent bg-accent/15 text-text'
                    : 'border-border bg-surface-2 text-muted hover:text-text',
                )}
              >
                {m}
              </button>
            ))}
            <input
              className={clsx(inputCls, 'h-7 w-[84px] rounded-pill px-2.5 text-[12px]', customMin && 'border-accent')}
              placeholder="custom m"
              aria-label="Custom minutes"
              inputMode="numeric"
              value={customMin}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, '');
                setCustomMin(v);
                setMinutes(v ? Number(v) : null);
              }}
            />
          </div>
        </div>
      )}
      {kind === 'planned' && (
        <div className="flex items-center gap-3">
          <span className="text-[12px] text-muted">Count</span>
          <div className="no-drag flex rounded-pill bg-surface-2 p-0.5">
            {(['down', 'up'] as const).map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={direction === d}
                onClick={() => setDirection(d)}
                className={clsx(
                  'h-6 rounded-pill px-3 text-[12px] font-semibold',
                  direction === d ? 'bg-accent text-white' : 'text-muted',
                )}
              >
                {d === 'down' ? '↓ down' : '↑ up'}
              </button>
            ))}
          </div>
        </div>
      )}
      {error && <p className="text-[12px] text-red">{error}</p>}
      <Row className="justify-end">
        <Btn pill onClick={() => void window.spyder.closeStart()}>
          Cancel
        </Btn>
        <Btn pill variant="primary" onClick={() => void submit()}>
          Start ▶
        </Btn>
      </Row>
    </Card>
  );
}
