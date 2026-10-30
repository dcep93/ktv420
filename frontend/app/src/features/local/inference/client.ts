import { validateStereo, type StereoAudio } from '../audio/types.ts'
import { watchInference } from './watchdog.ts'
import type { ProgressCallback, SeparationResult, WorkerRequest, WorkerResponse } from './types.ts'

/** One reusable local model worker. dispose() cancels promptly by terminating it. */
export class LocalSeparator {
  private worker: Worker | undefined
  private nextId = 1
  private watchdog: ReturnType<typeof watchInference> | undefined
  private pending: {
    id: number
    resolve: (result: SeparationResult) => void
    reject: (reason: Error) => void
    progress?: ProgressCallback
  } | undefined
  private readonly backend?: 'webgpu' | 'wasm'

  constructor(options: { backend?: 'webgpu' | 'wasm' } = {}) {
    this.backend = options.backend
  }

  separateStereo(audio: StereoAudio, onProgress?: ProgressCallback): Promise<SeparationResult> {
    validateStereo(audio)
    if (!audio.left.length) return Promise.reject(new Error('The recording is empty.'))
    if (this.pending) return Promise.reject(new Error('A separation is already in progress.'))
    if (!this.worker) {
      this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
      this.worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
        const pending = this.pending
        if (!pending || data.id !== pending.id) return
        if (data.type === 'progress') {
          this.watchdog?.progress(data.progress)
          pending.progress?.(data.progress)
        }
        else {
          this.watchdog?.stop(); this.watchdog = undefined
          this.pending = undefined
          if (data.type === 'result') pending.resolve(data.result)
          else pending.reject(new Error(data.message))
        }
      }
      this.worker.onerror = event => {
        this.fail(new Error(event.message || 'The inference worker stopped unexpectedly.'))
      }
      this.worker.onmessageerror = () => this.fail(new Error('The inference worker returned an unreadable message. Retry separation in Settings.'))
    }
    const id = this.nextId++
    // Copy before transfer: the original recording remains available for playback and persistence.
    const left = new Float32Array(audio.left), right = new Float32Array(audio.right)
    const request: WorkerRequest = {
      id, audio: { left, right, sampleRate: audio.sampleRate }, backend: this.backend,
      runtimeBaseUrl: new URL(`${import.meta.env.BASE_URL}ort/${import.meta.env.VITE_ORT_VERSION}/`, document.baseURI).href,
    }
    return new Promise((resolve, reject) => {
      this.pending = { id, resolve, reject, progress: onProgress }
      this.watchdog = watchInference(error => this.fail(error))
      try { this.worker!.postMessage(request, [left.buffer, right.buffer]) } catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  dispose(): void {
    this.fail(new DOMException('Separation cancelled.', 'AbortError'))
  }

  private fail(error: Error): void {
    this.watchdog?.stop(); this.watchdog = undefined
    this.worker?.terminate(); this.worker = undefined
    this.pending?.reject(error)
    this.pending = undefined
  }
}
