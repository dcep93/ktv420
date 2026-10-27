// Acknowledged, bounded retries keep catalog bookkeeping out of the audio path.
// Serialize updates so an older title/membership cannot overtake a newer one.
export function createCollectionRegistration({ send, getPath, onError,
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)), timeoutMs = 5000 }) {
  let queue = Promise.resolve();
  const isCurrent = collection => getPath().replace(/\/$/, '') === `/${collection.path}`;
  function request(collection, started) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Extension response timed out.')), timeoutMs);
      try {
        send({ type: 'ktv420:register-collection', collection, started }, response => {
          clearTimeout(timer);
          if (response?.ok) resolve();
          else reject(new Error(response?.error || 'Extension did not acknowledge the catalog update.'));
        });
      } catch (error) { clearTimeout(timer); reject(error); }
    });
  }
  return (value, started = false) => {
    if (!value?.trackIds?.length) return Promise.resolve(false);
    const collection = { ...value, trackIds: [...value.trackIds] };
    const run = async () => {
      let failure;
      for (const delay of [0, 400, 1200]) {
        if (!isCurrent(collection)) return false;
        if (delay) await wait(delay);
        if (!isCurrent(collection)) return false;
        try {
          await request(collection, started);
          if (isCurrent(collection)) onError('');
          return true;
        } catch (error) { failure = error; }
      }
      if (isCurrent(collection)) onError(`Catalog could not be updated. Reopen this album or playlist to retry. ${failure?.message || String(failure)}`);
      return false;
    };
    const result = queue.then(run);
    queue = result.catch(() => {});
    return result;
  };
}
