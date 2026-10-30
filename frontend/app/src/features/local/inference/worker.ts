import * as ort from 'onnxruntime-web/webgpu'
import { MODEL, loadModelBytes } from './model.ts'
import { separateWithRunner } from './pipeline.ts'
import { MODEL_SPEC_BINS, MODEL_SPEC_FRAMES, prepareModelInput, reconstructStems } from './splitModel.ts'
import { STEM_NAMES, type ProgressCallback, type WorkerRequest, type WorkerResponse } from './types.ts'

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null
  postMessage: (message: WorkerResponse, transfer?: Transferable[]) => void
}
let session: ort.InferenceSession | undefined
let backend = ''
let busy = false

async function getSession(request: WorkerRequest, progress: ProgressCallback): Promise<ort.InferenceSession> {
  if (session) return session
  ort.env.wasm.wasmPaths = request.runtimeBaseUrl
  // Extension pages need not be cross-origin isolated; one thread always works.
  ort.env.wasm.numThreads = 1
  ort.env.wasm.proxy = false
  const bytes = await loadModelBytes(fraction => progress({ phase: 'download', fraction, message: `Downloading model (${Math.round(fraction * 100)}%)` }),
    { onActivity: message => progress({ phase: 'loading', fraction: 0, message }) })
  const useGpu = request.backend !== 'wasm' && 'gpu' in navigator
  if (request.backend === 'webgpu' && !useGpu) throw new Error('WebGPU is unavailable in this browser.')
  progress({ phase: 'loading', fraction: 0, message: useGpu ? 'Initializing GPU model…' : 'Initializing CPU model…' })
  try {
    session = await ort.InferenceSession.create(bytes, {
      executionProviders: useGpu ? ['webgpu', 'wasm'] : ['wasm'],
      graphOptimizationLevel: 'basic',
      enableCpuMemArena: false,
      enableMemPattern: false,
    })
    backend = useGpu ? 'WebGPU (WASM operator fallback)' : 'WASM'
  } catch (error) {
    if (!useGpu || request.backend === 'webgpu') throw error
    progress({ phase: 'loading', fraction: 0, message: 'WebGPU initialization failed; preparing local WASM inference' })
    session = await ort.InferenceSession.create(bytes, {
      executionProviders: ['wasm'], graphOptimizationLevel: 'basic', enableCpuMemArena: false, enableMemPattern: false,
    })
    backend = 'WASM'
  }
  if (session.inputNames.join(',') !== 'input,x' || session.outputNames.join(',') !== 'output,add_67') {
    await session.release(); session = undefined
    throw new Error('The pinned model has an unexpected input/output signature.')
  }
  return session
}

scope.onmessage = async ({ data: request }) => {
  if (busy) {
    scope.postMessage({ id: request.id, type: 'error', message: 'A separation is already in progress.' })
    return
  }
  busy = true
  const started = performance.now()
  const progress: ProgressCallback = value => scope.postMessage({ id: request.id, type: 'progress', progress: value })
  try {
    const activeSession = await getSession(request, progress)
    const stems = await separateWithRunner(request.audio, async (samples, frames, reportStep) => {
      reportStep('Preparing frequency input')
      const prepared = prepareModelInput(samples.subarray(0, frames), samples.subarray(frames))
      const tensor = new ort.Tensor('float32', samples, [1, 2, frames])
      const spectrogram = new ort.Tensor('float32', prepared.magSpec, [1, 4, MODEL_SPEC_BINS, MODEL_SPEC_FRAMES])
      let result: ort.InferenceSession.ReturnType | undefined
      try {
        reportStep(backend.startsWith('WebGPU') ? 'Running GPU model' : 'Running CPU model')
        result = await activeSession.run({ input: tensor, x: spectrogram })
        const time = result.add_67, frequency = result.output
        if (time.type !== 'float32' || time.dims.join(',') !== `1,4,2,${frames}` || !(time.data instanceof Float32Array)
          || frequency.type !== 'float32' || frequency.dims.join(',') !== `1,4,4,${MODEL_SPEC_BINS},${MODEL_SPEC_FRAMES}` || !(frequency.data instanceof Float32Array)) {
          throw new Error('The model returned an invalid output layout.')
        }
        reportStep('Reconstructing stems')
        return reconstructStems(time.data, frequency.data)
      } finally {
        tensor.dispose()
        spectrogram.dispose()
        if (result) for (const output of Object.values(result)) output.dispose()
      }
    }, progress)
    const result = {
      ...stems,
      metadata: {
        model: MODEL.name, modelSha256: MODEL.sha256, modelSampleRate: MODEL.sampleRate,
        inputSampleRate: request.audio.sampleRate, inputFrames: request.audio.left.length,
        resampled: request.audio.sampleRate !== MODEL.sampleRate, backend, elapsedMs: performance.now() - started,
        shifts: 0 as const, conditioning: 'global-mono-mean-unbiased-std' as const,
      },
    }
    progress({ phase: 'complete', fraction: 1, message: 'All four Float32 stems are ready' })
    scope.postMessage({ id: request.id, type: 'result', result }, STEM_NAMES.flatMap(name => [result[name].left.buffer as ArrayBuffer, result[name].right.buffer as ArrayBuffer]))
  } catch (error) {
    scope.postMessage({ id: request.id, type: 'error', message: error instanceof Error ? error.message : String(error) })
  } finally { busy = false }
}
