import { beginImport, exportCollection, exportTrack, importTrack } from './storage';
/** Direct website storage calls: no extension, frames or serialized audio copies. */
export function connectTransfer() {
  return {
    connected: Promise.resolve(),
    dispose() {},
    async request<T>(method: string, args: unknown[] = []): Promise<T> {
      switch (method) {
        case 'exportCollection':
          return (await exportCollection(args[0])) as T;
        case 'exportTrack':
          return (await exportTrack(args[0])) as T;
        case 'beginImport':
          return (await beginImport(args[0])) as T;
        case 'importTrack':
          return (await importTrack(args[0], args[1], args[2], navigator.locks, () =>
            navigator.storage.estimate(),
          )) as T;
        default:
          throw new Error('Unknown local transfer operation.');
      }
    },
  };
}
