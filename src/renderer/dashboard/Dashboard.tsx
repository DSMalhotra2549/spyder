import clsx from 'clsx';
import { navigate } from '../router';

const GROUPS: { title: string; items: { id: string; label: string }[] }[] = [
  { title: 'Today', items: [{ id: 'today', label: 'Today' }, { id: 'review', label: 'Review' }] },
  { title: 'Trends', items: [{ id: 'week', label: 'Week' }, { id: 'month', label: 'Month' }] },
  { title: 'Setup', items: [{ id: 'rules', label: 'Rules' }, { id: 'settings', label: 'Settings' }] },
];
const LABELS: Record<string, string> = Object.fromEntries(
  GROUPS.flatMap((g) => g.items.map((i) => [i.id, i.label])),
);

export function Dashboard({ page }: { page: string }) {
  return (
    <div className="flex h-full">
      <aside className="flex w-[220px] shrink-0 flex-col border-r border-border bg-surface px-3 py-4">
        <div className="mb-6 flex items-center gap-2 px-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-accent text-[13px] font-bold text-white">
            S
          </div>
          <span className="text-[15px] font-semibold">Spyder</span>
        </div>
        {GROUPS.map((g) => (
          <nav key={g.title} className="mb-5">
            <div className="section-label mb-1 px-2">{g.title}</div>
            {g.items.map((i) => (
              <button
                key={i.id}
                data-nav={i.id}
                onClick={() => navigate(`dashboard/${i.id}`)}
                className={clsx(
                  'flex h-[34px] w-full items-center rounded-control px-2 text-left text-[13px]',
                  page === i.id ? 'bg-surface-2 text-text' : 'text-muted hover:text-text',
                )}
              >
                {i.label}
              </button>
            ))}
          </nav>
        ))}
      </aside>
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center border-b border-border px-6">
          <h1 className="text-xl font-semibold">{LABELS[page] ?? 'Spyder'}</h1>
        </header>
        <section className="p-6">
          <div className="rounded-card border border-border bg-surface p-4 text-muted">
            Nothing here yet.
          </div>
        </section>
      </main>
    </div>
  );
}
