// Spotify's slider is authoritative. Keep only a brief optimistic value while
// React handles a slider write; never invent a volume when the DOM isn't ready.
export function createVolumeMonitor({ read, write, apply, active, onError,
  schedule = setTimeout, unschedule = clearTimeout, now = Date.now }) {
  let pending = null, last = null, settledAt = 0, timer = null, applied = null;
  const valid = value => Number.isFinite(value) && value >= 0 && value <= 1;
  function value() {
    if (pending !== null || now() < settledAt) return pending ?? last;
    const observed = read();
    if (valid(observed)) last = observed;
    return last;
  }
  function sync(force = false) {
    const next = value();
    if (!active()) { applied = null; return; }
    if (next === null || (!force && next === applied)) return;
    applied = next;
    return Promise.resolve(apply(next)).catch(reason => { applied = null; if (active()) onError(reason); });
  }
  function set(next) {
    if (!valid(next)) throw new Error('Invalid listening volume.');
    pending = last = next;
    if (timer !== null) return;
    timer = schedule(() => {
      timer = null;
      const target = pending;
      pending = null;
      try {
        write(target);
        settledAt = now() + 200;
        void sync();
      } catch (reason) { settledAt = 0; onError(reason); }
    }, 32);
  }
  function dispose() { if (timer !== null) unschedule(timer); timer = null; pending = null; }
  return { value, set, sync, dispose };
}
