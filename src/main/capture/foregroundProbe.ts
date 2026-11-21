// Utility process (plan §9.1): answers 'sample' with the foreground window. Isolated so a native
// crash in x-win can't take down the main process.
import { activeWindow } from '@miniben90/x-win';

export interface ProbeReply {
  ok: boolean;
  title?: string;
  path?: string;
  name?: string;
  error?: string;
}

process.parentPort.on('message', (e) => {
  if (e.data !== 'sample') return;
  let reply: ProbeReply;
  try {
    // Getters, not toObject(): toObject() also loads the icon and is ~5× slower.
    const w = activeWindow();
    const info = w.info;
    reply = { ok: true, title: w.title, path: info.path, name: info.name };
  } catch (err) {
    reply = { ok: false, error: String(err) };
  }
  process.parentPort.postMessage(reply);
});
