// Rules page (plan §12, design/DESIGN.md §4 Rules): rules, title patterns, the To sort list (P70),
// projects and KPI definitions.
import clsx from 'clsx';
import { useState, type ReactNode } from 'react';
import type { Category, MatchType, PatternMatch } from '../../core/defaults';
import { fmtHM } from '../../core/format';
import { Btn, inputCls } from '../ui/controls';
import {
  CAT_COLOR,
  CAT_LABEL,
  Card,
  CategoryButtons,
  DefaultChip,
  Empty,
  Segmented,
  Toggle,
  TopBar,
  useLoader,
} from './parts';

type Tab = 'rules' | 'patterns' | 'inbox' | 'kpis';
const TABS: { value: Tab; label: string }[] = [
  { value: 'rules', label: 'Rules' },
  { value: 'patterns', label: 'Title patterns' },
  { value: 'inbox', label: 'To sort' },
  { value: 'kpis', label: 'KPIs' },
];
const CATS: Category[] = ['productive', 'neutral', 'distracting'];
const TYPE_LABEL: Record<MatchType, string> = { app: 'App (exe)', domain: 'Domain', title: 'Title contains' };
const sel = clsx(inputCls, 'h-8 cursor-default px-2');
const inp = clsx(inputCls, 'h-8');

export function Rules() {
  const [tab, setTab] = useState<Tab>('rules');
  return (
    <>
      <TopBar title="Rules" />
      <div className="flex-1 overflow-x-hidden overflow-y-auto p-6" data-testid="rules">
        <Segmented value={tab} options={TABS} onChange={setTab} testId="rules-tabs" />
        <div className="mt-4">
          {tab === 'rules' && <RulesTab />}
          {tab === 'patterns' && <PatternsTab />}
          {tab === 'inbox' && <InboxTab />}
          {tab === 'kpis' && <KpisTab />}
        </div>
      </div>
    </>
  );
}

function CategorySelect({
  value,
  onChange,
  testId,
}: {
  value: Category;
  onChange: (c: Category) => void;
  testId?: string;
}) {
  return (
    <select
      aria-label="Category"
      data-testid={testId}
      className={clsx(sel, 'w-[130px]')}
      value={value}
      onChange={(e) => onChange(e.target.value as Category)}
      style={{ color: CAT_COLOR[value] }}
    >
      {CATS.map((c) => (
        <option key={c} value={c}>
          {CAT_LABEL[c]}
        </option>
      ))}
    </select>
  );
}

const Row = ({ children, testId, muted }: { children: ReactNode; testId?: string; muted?: boolean }) => (
  <div
    data-testid={testId}
    className={clsx(
      'flex h-11 items-center gap-3 border-b border-border px-2 text-[13px] last:border-0 hover:bg-surface-2',
      muted && 'text-muted',
    )}
  >
    {children}
  </div>
);

const DelBtn = ({ onClick, label }: { onClick: () => void; label: string }) => (
  <button
    aria-label={label}
    title={label}
    onClick={onClick}
    className="flex h-7 w-7 items-center justify-center rounded-chip text-faint hover:bg-surface hover:text-red"
  >
    ×
  </button>
);

// ---- rules -------------------------------------------------------------------------------
function RulesTab() {
  const [rules, reload] = useLoader(() => window.spyder.listRules(), 'rules');
  const [type, setType] = useState<MatchType>('domain');
  const [pattern, setPattern] = useState('');
  const [cat, setCat] = useState<Category>('distracting');
  const [filter, setFilter] = useState('');
  const add = async () => {
    if (!pattern.trim()) return;
    await window.spyder.saveRule({ matchType: type, pattern, category: cat });
    setPattern('');
    await reload();
  };
  const f = filter.trim().toLowerCase();
  const shown = (rules ?? []).filter((r) => !f || r.pattern.includes(f));
  // A user rule hides the default with the same pattern (it wins anyway).
  const userKeys = new Set(shown.filter((r) => !r.isDefault).map((r) => `${r.matchType}:${r.pattern}`));
  return (
    <Card title="Categorization rules" right="user rules beat defaults · longest pattern wins">
      <div className="mb-3 flex items-center gap-2" data-testid="rule-add">
        <select
          aria-label="Match type"
          className={clsx(sel, 'w-[140px]')}
          value={type}
          onChange={(e) => setType(e.target.value as MatchType)}
        >
          {(Object.keys(TYPE_LABEL) as MatchType[]).map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
            </option>
          ))}
        </select>
        <input
          className={clsx(inp, 'min-w-0 flex-1')}
          placeholder={
            type === 'app'
              ? 'e.g. spotify.exe'
              : type === 'domain'
                ? 'e.g. news.ycombinator.com'
                : 'text in the window title'
          }
          aria-label="Pattern"
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void add()}
        />
        <CategorySelect value={cat} onChange={setCat} />
        <Btn variant="primary" onClick={() => void add()} disabled={!pattern.trim()}>
          + Add rule
        </Btn>
        <input
          className={clsx(inp, 'ml-4 w-[180px]')}
          placeholder="Filter…"
          aria-label="Filter rules"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      {!rules ? null : shown.length === 0 ? (
        <Empty>No rules match</Empty>
      ) : (
        shown
          .filter((r) => !r.isDefault || !userKeys.has(`${r.matchType}:${r.pattern}`))
          .map((r) => (
            <Row key={r.id} testId="rule-row">
              <span className="w-[110px] shrink-0 text-muted">{TYPE_LABEL[r.matchType]}</span>
              <span className="min-w-0 flex-1 truncate">{r.pattern}</span>
              {r.isDefault && <DefaultChip />}
              <CategorySelect
                value={r.category}
                onChange={async (c) => {
                  // Editing a default creates a user rule with the same pattern.
                  await window.spyder.saveRule({
                    id: r.isDefault ? undefined : r.id,
                    matchType: r.matchType,
                    pattern: r.pattern,
                    category: c,
                  });
                  await reload();
                }}
              />
              <span className="w-7">
                {!r.isDefault && (
                  <DelBtn
                    label="Delete rule"
                    onClick={async () => {
                      await window.spyder.deleteRule(r.id);
                      await reload();
                    }}
                  />
                )}
              </span>
            </Row>
          ))
      )}
    </Card>
  );
}

// ---- title patterns ----------------------------------------------------------------------
const MATCHES: PatternMatch[] = ['contains', 'prefix', 'suffix'];

function PatternsTab() {
  const [rows, reload] = useLoader(() => window.spyder.listTitlePatterns(), 'patterns');
  const [match, setMatch] = useState<PatternMatch>('contains');
  const [pattern, setPattern] = useState('');
  const [domain, setDomain] = useState('');
  const add = async () => {
    if (!pattern.trim() || !domain.trim()) return;
    await window.spyder.saveTitlePattern({ match, pattern, domain });
    setPattern('');
    setDomain('');
    await reload();
  };
  return (
    <Card
      title="Firefox title patterns"
      right="map a Firefox page title to a site; also re-labels past activity"
    >
      <div className="mb-3 flex items-center gap-2" data-testid="pattern-add">
        <MatchSelect value={match} onChange={setMatch} />
        <input
          className={clsx(inp, 'min-w-0 flex-1')}
          placeholder="Title text, e.g. Hacker News"
          aria-label="Title pattern"
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
        />
        <span className="text-muted">→</span>
        <input
          className={clsx(inp, 'w-[220px]')}
          placeholder="domain, e.g. news.ycombinator.com"
          aria-label="Domain"
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void add()}
        />
        <Btn variant="primary" onClick={() => void add()} disabled={!pattern.trim() || !domain.trim()}>
          + Add pattern
        </Btn>
      </div>
      {rows?.map((p) =>
        p.isDefault ? (
          <Row key={p.id} testId="pattern-row">
            <span className="w-[110px] shrink-0 text-muted">{p.match}</span>
            <span className="min-w-0 flex-1 truncate">“{p.pattern}”</span>
            <span className="w-[220px] truncate text-muted">→ {p.domain}</span>
            <DefaultChip />
            <span className="w-7" />
          </Row>
        ) : (
          <UserPattern key={p.id} p={p} reload={reload} />
        ),
      )}
    </Card>
  );
}

function MatchSelect({ value, onChange }: { value: PatternMatch; onChange: (m: PatternMatch) => void }) {
  return (
    <select
      aria-label="Match"
      className={clsx(sel, 'w-[110px]')}
      value={value}
      onChange={(e) => onChange(e.target.value as PatternMatch)}
    >
      {MATCHES.map((m) => (
        <option key={m} value={m}>
          {m}
        </option>
      ))}
    </select>
  );
}

function UserPattern({
  p,
  reload,
}: {
  p: { id: string; match: PatternMatch; pattern: string; domain: string };
  reload: () => Promise<void>;
}) {
  const [pattern, setPattern] = useState(p.pattern);
  const [domain, setDomain] = useState(p.domain);
  const save = async (o: Partial<typeof p>) => {
    const next = { ...p, pattern, domain, ...o };
    if (!next.pattern.trim() || !next.domain.trim()) return;
    await window.spyder.saveTitlePattern(next);
    await reload();
  };
  return (
    <Row testId="pattern-row">
      <MatchSelect value={p.match} onChange={(m) => void save({ match: m })} />
      <input
        className={clsx(inp, 'min-w-0 flex-1')}
        aria-label="Title pattern"
        value={pattern}
        onChange={(e) => setPattern(e.target.value)}
        onBlur={() => pattern !== p.pattern && void save({})}
      />
      <input
        className={clsx(inp, 'w-[220px]')}
        aria-label="Domain"
        value={domain}
        onChange={(e) => setDomain(e.target.value)}
        onBlur={() => domain !== p.domain && void save({})}
      />
      <span className="w-[52px]" />
      <DelBtn
        label="Delete pattern"
        onClick={async () => {
          await window.spyder.deleteTitlePattern(p.id);
          await reload();
        }}
      />
    </Row>
  );
}

// ---- to sort (P70) ----------------------------------------------------------------------
function InboxTab() {
  const [rows, reload] = useLoader(() => window.spyder.listToAsk(), 'inbox', true);
  return (
    <Card title="To sort" right="used 3 min or more, no category you picked yet · all time">
      {!rows ? null : rows.length === 0 ? (
        <Empty>Everything you use has a category you picked</Empty>
      ) : (
        rows.map((a) => (
          <Row key={a.key} testId="inbox-row">
            <span className="min-w-0 flex-1 truncate">{a.key}</span>
            {a.category !== 'uncategorized' && <DefaultChip />}
            <span className="w-14 text-right text-muted tabular">{fmtHM(a.sec)}</span>
            <CategoryButtons
              current={a.category}
              onPick={async (c) => {
                await window.spyder.saveRule({ ...a.ruleTarget, category: c });
                await reload();
              }}
            />
          </Row>
        ))
      )}
    </Card>
  );
}

// ---- projects ----------------------------------------------------------------------------
function KpisTab() {
  const [rows, reload] = useLoader(() => window.spyder.listKpis(), 'kpis');
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('');
  const add = async () => {
    if (!name.trim()) return;
    await window.spyder.saveKpi({ name, unit });
    setName('');
    setUnit('');
    await reload();
  };
  return (
    <Card title="KPIs" right="numbers you log in each day's review">
      <div className="mb-3 flex items-center gap-2" data-testid="kpi-add">
        <input
          className={clsx(inp, 'w-[280px]')}
          placeholder="KPI name, e.g. Emails answered"
          aria-label="KPI name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void add()}
        />
        <input
          className={clsx(inp, 'w-[120px]')}
          placeholder="unit (optional)"
          aria-label="Unit"
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void add()}
        />
        <Btn variant="primary" onClick={() => void add()} disabled={!name.trim()}>
          + Add KPI
        </Btn>
      </div>
      {!rows ? null : rows.length === 0 ? (
        <Empty>No KPIs yet</Empty>
      ) : (
        rows.map((k) => <KpiRow key={k.id} k={k} reload={reload} />)
      )}
    </Card>
  );
}

function KpiRow({
  k,
  reload,
}: {
  k: { id: string; name: string; unit: string | null; archived: boolean };
  reload: () => Promise<void>;
}) {
  const [name, setName] = useState(k.name);
  const [unit, setUnit] = useState(k.unit ?? '');
  const save = async (o: { archived?: boolean } = {}) => {
    if (!name.trim()) return;
    await window.spyder.saveKpi({ id: k.id, name, unit, archived: o.archived ?? k.archived });
    await reload();
  };
  return (
    <Row testId="kpi-row" muted={k.archived}>
      <input
        className={clsx(inp, 'w-[280px]')}
        aria-label="KPI name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => name !== k.name && void save()}
      />
      <input
        className={clsx(inp, 'w-[120px]')}
        aria-label="Unit"
        placeholder="unit"
        value={unit}
        onChange={(e) => setUnit(e.target.value)}
        onBlur={() => unit !== (k.unit ?? '') && void save()}
      />
      <span className="ml-auto flex items-center gap-2 text-[12px] text-muted">
        Archived
        <Toggle label="Archived" on={k.archived} onChange={(v) => void save({ archived: v })} />
      </span>
    </Row>
  );
}
