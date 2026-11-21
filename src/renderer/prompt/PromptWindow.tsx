// Prompt window (#/prompt): one prompt at a time (P22) or the start-session popover (plan §12, DESIGN.md §3).
import clsx from 'clsx';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { PromptVM } from '../../core/promptView';
import type { AwayClassification, EngineError, PromptType } from '../../core/types';
import type { Ok, PromptWindowState } from '../../preload/api';
import { Btn, NameInput, ProjectSelect, inputCls } from '../ui/controls';
import { StartPopover } from './StartPopover';

const TYPE_COLOR: Record<PromptType, string> = {
  away: 'var(--color-away)',
  recovery: 'var(--color-away)',
  timeUp: 'var(--color-planned)',
  label: 'var(--color-accent)',
  checkIn: 'var(--color-accent)',
  breakEnd: 'var(--color-break)',
};

export function PromptWindow() {
  const [st, setSt] = useState<PromptWindowState>(null);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    void window.spyder.getPrompt().then(setSt);
    return window.spyder.onPrompt(setSt);
  }, []);
  // The window's height follows the content.
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const ro = new ResizeObserver(() => void window.spyder.resizePrompt(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={root} className="p-2">
      {st?.view === 'start' && <StartPopover key="start" tab={st.tab} defaultDirection={st.defaultDirection} />}
      {st?.view === 'prompt' && <PromptCard key={st.prompt.id} p={st.prompt} />}
    </div>
  );
}

export function Card({ color, heading, right, children }: { color: string; heading: string; right?: ReactNode; children: ReactNode }) {
  return (
    <div
      className="flex flex-col gap-3 rounded-card border border-border-strong bg-surface px-5 pt-4 pb-5 shadow-[var(--shadow-float)]"
      style={{ borderTop: `2px solid ${color}` }}
    >
      <div className="drag flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
        <span className="caps" style={{ color }}>
          {heading}
        </span>
        <span className="ml-auto text-[11px] text-muted">{right}</span>
      </div>
      {children}
    </div>
  );
}

type Res = Ok | EngineError;
const errText = (r: Res) => ('error' in r ? ('message' in r ? r.message : 'Something went wrong') : null);

function PromptCard({ p }: { p: PromptVM }) {
  const [name, setName] = useState(p.labelled ? (p.name ?? '') : '');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [mode, setMode] = useState<'main' | 'custom' | 'offline' | 'relabel'>('main');
  const [custom, setCustom] = useState('10');
  const [error, setError] = useState<string | null>(null);

  const send = async (a: Parameters<typeof window.spyder.answer>[1]) => {
    const r = await window.spyder.answer(p.id, a);
    setError(errText(r));
  };
  const needName = async (fn: (n: string) => Promise<void>) => {
    if (!name.trim()) return setError('Enter what you worked on');
    await fn(name.trim());
  };

  const nameFields = (onEnter: () => void) => (
    <div className="flex flex-col gap-2">
      <NameInput value={name} onChange={setName} onEnter={onEnter} autoFocus placeholder="What did you work on?" />
      <ProjectSelect value={projectId} onChange={setProjectId} />
    </div>
  );

  let body: ReactNode;
  switch (p.type) {
    case 'timeUp':
      body =
        mode === 'custom' ? (
          <Row>
            <input
              className={clsx(inputCls, 'w-24')}
              type="number"
              min={1}
              value={custom}
              autoFocus
              aria-label="Minutes"
              onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void send({ extend: Math.max(1, Number(custom)) * 60 })}
            />
            <span className="text-muted">min</span>
            <Btn pill variant="primary" onClick={() => void send({ extend: Math.max(1, Number(custom)) * 60 })}>
              Add time
            </Btn>
            <Btn pill onClick={() => setMode('main')}>
              Back
            </Btn>
          </Row>
        ) : (
          <Row>
            <Btn pill variant="primary" autoFocus onClick={() => void send('done')}>
              Done
            </Btn>
            <Btn pill onClick={() => void send({ extend: 300 })}>
              +5 min
            </Btn>
            <Btn pill onClick={() => void send({ extend: 900 })}>
              +15 min
            </Btn>
            <Btn pill onClick={() => setMode('custom')}>
              Custom…
            </Btn>
            <Btn pill onClick={() => void send('switch')}>
              Switch task
            </Btn>
          </Row>
        );
      break;
    case 'label': {
      const save = () => void needName((n) => send({ name: n, projectId }));
      body = (
        <>
          {nameFields(save)}
          <Row>
            <Btn pill variant="primary" onClick={save}>
              Save
            </Btn>
          </Row>
        </>
      );
      break;
    }
    case 'checkIn': {
      const log = (action: 'continue' | 'fresh') => () => void needName((n) => send({ action, name: n, projectId }));
      if (p.labelled && mode !== 'relabel') {
        body = (
          <Row>
            <Btn pill variant="primary" autoFocus onClick={() => void send({ action: 'still' })}>
              Yes, still on it
            </Btn>
            <Btn pill onClick={() => void send({ action: 'fresh', name: p.name!, projectId: null })}>
              Log &amp; start fresh
            </Btn>
            <Btn pill onClick={() => setMode('relabel')}>
              Change label
            </Btn>
          </Row>
        );
      } else {
        body = (
          <>
            {nameFields(log('continue'))}
            <Row>
              <Btn pill variant="primary" onClick={log('continue')}>
                Log &amp; continue
              </Btn>
              <Btn pill onClick={log('fresh')}>
                Log &amp; start fresh
              </Btn>
            </Row>
          </>
        );
      }
      break;
    }
    case 'away':
    case 'recovery': {
      const pick = (c: AwayClassification) => () => void send({ classification: c });
      body =
        mode === 'offline' ? (
          <>
            <NameInput
              value={name}
              onChange={setName}
              autoFocus
              placeholder="What did you work on offline?"
              onEnter={() => void needName((n) => send({ classification: 'offline_work', label: n }))}
            />
            <Row>
              <Btn pill variant="primary" onClick={() => void needName((n) => send({ classification: 'offline_work', label: n }))}>
                Save
              </Btn>
              <Btn pill onClick={() => setMode('main')}>
                Back
              </Btn>
            </Row>
          </>
        ) : (
          <Row>
            <Btn pill onClick={pick('break')}>
              Break
            </Btn>
            <Btn pill onClick={pick('meeting')}>
              Meeting / call
            </Btn>
            <Btn pill onClick={() => setMode('offline')}>
              Offline work…
            </Btn>
            <Btn pill onClick={pick('not_working')}>
              Not working
            </Btn>
            <Btn pill variant="outline" onClick={pick('working')}>
              I was working
            </Btn>
          </Row>
        );
      break;
    }
    case 'breakEnd':
      body = (
        <Row>
          <Btn pill variant="primary" autoFocus onClick={() => void send('back')}>
            Back to work
          </Btn>
          <Btn pill onClick={() => void send({ extend: 300 })}>
            +5 min
          </Btn>
        </Row>
      );
      break;
  }

  return (
    <Card color={TYPE_COLOR[p.type]} heading={p.heading} right={p.count > 1 ? `1 of ${p.count}` : null}>
      <div className="flex flex-col gap-1">
        <h2 data-testid="prompt-title" className="text-[17px] leading-snug font-semibold">
          {p.title}
        </h2>
        {p.body && <p className="text-muted">{p.body}</p>}
      </div>
      {body}
      {error && <p className="text-[12px] text-red">{error}</p>}
    </Card>
  );
}

export function Row({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx('flex flex-wrap items-center gap-2', className)}>{children}</div>;
}
