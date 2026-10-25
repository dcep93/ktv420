import type { StereoAudio } from '../audio/types.ts'

export const STEM_NAMES = ['drums', 'bass', 'other', 'vocals'] as const
export type StemName = typeof STEM_NAMES[number]
export interface SeparationProgress {
  phase: 'download' | 'loading' | 'resampling' | 'restoring' | 'separating' | 'encoding' | 'complete'
  fraction: number
  message: string
  chunk?: number
  totalChunks?: number
}
export type StemAudio = Record<StemName, StereoAudio>
export interface SeparationResult extends StemAudio {
  metadata: {
    model: string
    modelSha256: string
    modelSampleRate: number
    inputSampleRate: number
    inputFrames: number
    resampled: boolean
    backend: string
    elapsedMs: number
    shifts: 0
    conditioning: 'global-mono-mean-unbiased-std'
  }
}
export type ProgressCallback = (progress: SeparationProgress) => void

export interface WorkerRequest {
  id: number
  audio: StereoAudio
  runtimeBaseUrl: string
  backend?: 'webgpu' | 'wasm'
}
export type WorkerResponse =
  | { id: number; type: 'progress'; progress: SeparationProgress }
  | { id: number; type: 'result'; result: SeparationResult }
  | { id: number; type: 'error'; message: string }
