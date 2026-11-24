// Prompt window (#/prompt): accounting for ended blocks (P60, with P70's asks) or the start reminder (P59). DESIGN.md §3.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { AccountBlockVM, AccountVM, ReminderVM } from '../../core/promptView';
import type { Efficiency, EngineError, Tag } from '../../core/types';
import type { BlockAnswer, Ok, PromptWindowState } from '../../preload/api';
import { fmtHM } from '../../core/format';
import { CategoryButtons, Segmented } from '../dashboard/parts';
import { AnswerInput, Btn, EfficiencyPicker } from '../ui/controls';

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
      {st?.view === 'account' && <AccountCard key={st.blocks.map((b) => b.id).join()} p={st} />}
      {st?.view === 'reminder' && <ReminderCard p={st} />}
    </div>
  );
}

function Card({ color, heading, right, testId, children }: { color: string; heading: string; right?: ReactNode; testId: string; children: ReactNode }) {
  return (
    <div
      data-testid={testId}
      className="flex flex-col gap-3 rounded-card border border-border-strong bg-surface px-5 pt-4 pb-5 shadow-[var(--shadow-float)]"
      style={{ borderTop: `2px solid ${color}` }}
    >
      <div className="drag flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
        <span className="caps" style={{ color }}>
          {heading}
        </span>
        <span className="no-drag ml-auto text-[11px] text-muted">{right}</span>
      </div>
      {children}
    </div>
  );
}

const errText = (r: Ok | EngineError) => ('error' in r ? r.message : null);
const NEED = 'Say what you did, or pick Break';

function BlockLine({ b, right }: { b: AccountBlockVM; right?: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-2 text-[12px]">
      <span className="tnum font-medium text-text">{b.range}</span>
      <span className="tnum text-faint">{b.length}</span>
      {b.hint && <span className="min-w-0 truncate text-muted">{b.hint}</span>}
      {right && <span className="ml-auto">{right}</span>}
    </div>
  );
}

/**
 * A row's answer in "Each separately": text, whether it's a break (P66: a break may have text too), and its
 * efficiency (P75, work only).
 */
type RowAnswer = { text: string; isBreak: boolean; efficiency: Efficiency | null };

/** "What did you do?" for every ended, unanswered block of today (P60). */
function AccountCard({ p }: { p: AccountVM }) {
  const many = p.blocks.length > 1;
  const [mode, setMode] = useState<'all' | 'each'>('all');
  const [text, setText] = useState('');
  const [efficiency, setEfficiency] = useState<Efficiency | null>(null);
  const [rows, setRows] = useState<Record<string, RowAnswer>>({});
  const [error, setError] = useState<string | null>(null);

  const send = async (answers: BlockAnswer[]) => {
    if (!answers.length) return setError(NEED);
    setError(errText(await window.spyder.answerBlocks(answers)));
  };
  // Save makes work blocks, with the efficiency if one is picked (P75); Break makes breaks, keeping any typed text (P66).
  const all = (answer: string, tag: Tag) => {
    if (tag === 'work' && !answer.trim()) return setError(NEED);
    void send(p.blocks.map((b) => ({ id: b.id, answer: answer.trim() || null, tag, ...(tag === 'work' && efficiency !== null && { efficiency }) })));
  };
  const row = (id: string): RowAnswer => rows[id] ?? { text: '', isBreak: false, efficiency: null };
  const setRow = (id: string, r: Partial<RowAnswer>) => setRows((all) => ({ ...all, [id]: { ...row(id), ...r } }));
  // Rows left empty stay pending for later.
  const saveEach = () =>
    void send(
      p.blocks.flatMap((b): BlockAnswer[] => {
        const r = row(b.id);
        if (r.isBreak) return [{ id: b.id, answer: r.text.trim() || null, tag: 'break' }];
        return r.text.trim() ? [{ id: b.id, answer: r.text, tag: 'work', ...(r.efficiency !== null && { efficiency: r.efficiency }) }] : [];
      }),
    );

  const keepWorking = p.canContinue && (
    <button type="button" data-testid="account-keep-working" className="text-accent hover:underline" onClick={() => void window.spyder.keepWorking()}>
      Keep working
    </button>
  );

  return (
    <Card testId="prompt-account" color="var(--color-accent)" heading={p.heading} right={keepWorking}>
      <div className="text-[15px] font-semibold text-text">{p.title}</div>
      {!many && <BlockLine b={p.blocks[0]} />}
      {many && (
        <Segmented
          testId="account-mode"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'all', label: 'One answer for all' },
            { value: 'each', label: 'Each separately' },
          ]}
        />
      )}
      {many && mode === 'all' && (
        <div className="flex max-h-28 flex-col gap-1 overflow-y-auto">
          {p.blocks.map((b) => (
            <BlockLine key={b.id} b={b} />
          ))}
        </div>
      )}
      {!many || mode === 'all' ? (
        <>
          <AnswerInput value={text} onChange={setText} onEnter={() => all(text, 'work')} autoFocus />
          <EfficiencyPicker label="Efficiency" value={efficiency} onChange={setEfficiency} testId="account-efficiency" />
          <div className="flex flex-wrap items-center gap-2">
            <Btn pill variant="primary" data-testid="account-save" onClick={() => all(text, 'work')}>
              Save
            </Btn>
            <Btn pill data-testid="account-break" onClick={() => all(text, 'break')}>
              Break
            </Btn>
            {p.lastAnswer && (
              <Btn pill variant="ghost" data-testid="account-same" title="Same as last" onClick={() => all(p.lastAnswer ?? '', 'work')}>
                <span className="max-w-[180px] truncate">Same: {p.lastAnswer}</span>
              </Btn>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="flex max-h-[260px] flex-col gap-2.5 overflow-y-auto pr-1">
            {p.blocks.map((b, i) => (
              <div key={b.id} data-testid="account-row" className="flex flex-col gap-1">
                <BlockLine
                  b={b}
                  right={
                    !row(b.id).isBreak && (
                      <EfficiencyPicker value={row(b.id).efficiency} onChange={(e) => setRow(b.id, { efficiency: e })} testId="account-row-efficiency" />
                    )
                  }
                />
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <AnswerInput value={row(b.id).text} onChange={(v) => setRow(b.id, { text: v })} onEnter={saveEach} autoFocus={i === 0} />
                  </div>
                  <Btn
                    size="sm"
                    variant={row(b.id).isBreak ? 'outline' : 'secondary'}
                    data-testid="account-row-break"
                    onClick={() => setRow(b.id, { isBreak: !row(b.id).isBreak })}
                  >
                    Break
                  </Btn>
                </div>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Btn pill variant="primary" data-testid="account-save" onClick={saveEach}>
              Save
            </Btn>
            <span className="text-[11px] text-muted">Blocks left empty stay for later.</span>
          </div>
        </>
      )}
      {error && <div className="text-[12px] text-red">{error}</div>}
      <Asks p={p} />
    </Card>
  );
}

/** P70: apps and sites these blocks used that still want the user's label. Optional: answering the block doesn't wait. */
function Asks({ p }: { p: AccountVM }) {
  const [done, setDone] = useState<string[]>([]);
  const asks = p.asks.filter((a) => !done.includes(a.key));
  if (!asks.length) return null;
  return (
    <div data-testid="prompt-asks" className="flex flex-col gap-2 border-t border-border pt-3">
      <span className="caps text-muted">{p.askTitle}</span>
      {asks.map((a) => (
        <div key={a.key} data-testid="ask-row" className="flex flex-col gap-1">
          <div className="flex min-w-0 items-baseline gap-2 text-[12px]">
            <span className="truncate text-text">{a.key}</span>
            <span className="tnum shrink-0 text-faint">{fmtHM(a.sec)}</span>
          </div>
          <CategoryButtons
            size="sm"
            current={a.category}
            onPick={(c) => {
              setDone((d) => [...d, a.key]);
              void window.spyder.saveRule({ ...a.ruleTarget, category: c });
            }}
          />
        </div>
      ))}
    </div>
  );
}

/** Work hours with no loop running (P59). */
function ReminderCard({ p }: { p: ReminderVM }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <Card testId="prompt-reminder" color="var(--color-away)" heading={p.heading}>
      <div className="text-[15px] font-semibold text-text">{p.title}</div>
      <div className="text-[13px] text-muted">{p.body}</div>
      <div className="flex items-center gap-2">
        <Btn pill variant="primary" autoFocus data-testid="reminder-start" onClick={() => void window.spyder.start(p.lengthSec).then((r) => setError(errText(r)))}>
          Start
        </Btn>
        <Btn pill data-testid="reminder-later" onClick={() => void window.spyder.dismissReminder()}>
          Not now
        </Btn>
      </div>
      {error && <div className="text-[12px] text-red">{error}</div>}
    </Card>
  );
}
