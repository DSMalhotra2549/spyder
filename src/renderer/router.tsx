import { useEffect, useSyncExternalStore } from 'react';
import { Widget } from './widget/Widget';
import { Dashboard } from './dashboard/Dashboard';
import { PromptWindow } from './prompt/PromptWindow';

const subscribe = (cb: () => void) => {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
};
const getHash = () => window.location.hash.replace(/^#\/?/, '');

export function useRoute(): string[] {
  const hash = useSyncExternalStore(subscribe, getHash);
  return hash.split('/').filter(Boolean);
}

export function navigate(path: string): void {
  window.location.hash = `/${path.replace(/^\//, '')}`;
}

export function Router() {
  const [root, ...rest] = useRoute();
  useEffect(() => {
    document.body.className = root === 'dashboard' ? 'dashboard' : 'transparent';
  }, [root]);
  useEffect(() => window.spyder?.onNavigate((r) => navigate(`dashboard/${r}`)), []);
  if (root === 'widget') return <Widget />;
  if (root === 'prompt') return <PromptWindow />;
  if (root === 'dashboard') return <Dashboard page={rest[0] ?? 'today'} />;
  return null;
}
