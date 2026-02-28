export type ChordSnapshot = {
  time: number
  chord: string
  confidence: number
}

const REFERENCE_OCTAVE = 4
const STANDARD_A4_FREQUENCY = 440

type ChordQuality =
  | "major"
  | "minor"
  | "power"
  | "sus2"
  | "suspended"
  | "dom7"
  | "maj7"
  | "min7"
  | "maj9"
  | "min9"
  | "dim"
  | "aug"
  | "unknown"

type ChordAnalysisOptions = {
  windowSeconds?: number
  hopSeconds?: number
  minimumConfidence?: number
  stableFrameCount?: number
  yieldEveryFrames?: number
  targetSampleRate?: number
}

const NOTE_LABELS = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
]

const CHORD_TEMPLATES: Array<{
  quality: ChordQuality
  intervals: number[]
  weight: number
}> = [
  { quality: "major", intervals: [0, 4, 7], weight: 1.15 },
  { quality: "minor", intervals: [0, 3, 7], weight: 1.14 },
  { quality: "dom7", intervals: [0, 4, 7, 10], weight: 0.92 },
  { quality: "maj7", intervals: [0, 4, 7, 11], weight: 0.9 },
  { quality: "min7", intervals: [0, 3, 7, 10], weight: 0.9 },
  { quality: "maj9", intervals: [0, 4, 7, 2], weight: 0.82 },
  { quality: "min9", intervals: [0, 3, 7, 2], weight: 0.82 },
  { quality: "sus2", intervals: [0, 2, 7], weight: 0.98 },
  { quality: "suspended", intervals: [0, 5, 7], weight: 0.98 },
  { quality: "power", intervals: [0, 7], weight: 0.88 },
  { quality: "dim", intervals: [0, 3, 6], weight: 0.72 },
  { quality: "aug", intervals: [0, 4, 8], weight: 0.72 },
]

const MIN_MIDI_NOTE = 36 // C2
const MAX_MIDI_NOTE = 79 // G5
const HARMONIC_WEIGHTS = [1, 0.6, 0.34, 0.2]
const TUNING_SCAN_MIN_CENTS = -70
const TUNING_SCAN_MAX_CENTS = 70
const TUNING_FINE_STEP_CENTS = 2
const MIN_REFERENCE_A4 = 415
const MAX_REFERENCE_A4 = 466
const EXTENSION_INTERVALS: Record<ChordQuality, number | null> = {
  major: null,
  minor: null,
  power: null,
  sus2: null,
  suspended: null,
  dom7: 10,
  maj7: 11,
  min7: 10,
  maj9: 2,
  min9: 2,
  dim: null,
  aug: null,
  unknown: null,
}

const buildHarmonicFrequenciesByPitchClass = (referenceA4: number): number[][] => {
  const pitchClassBuckets: number[][] = Array.from({ length: 12 }, () => [])

  for (let midi = MIN_MIDI_NOTE; midi <= MAX_MIDI_NOTE; midi++) {
    const pitchClass = midi % 12
    const frequency = referenceA4 * Math.pow(2, (midi - 69) / 12)
    pitchClassBuckets[pitchClass]?.push(frequency)
  }

  return pitchClassBuckets
}

const createMonoBuffer = (buffer: AudioBuffer): Float32Array => {
  const { length, numberOfChannels } = buffer
  const mono = new Float32Array(length)

  for (let channel = 0; channel < numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel)
    for (let i = 0; i < length; i++) {
      mono[i] += data[i] ?? 0
    }
  }

  // Normalize by channel count to avoid volume inflation.
  const normalization = Math.max(1, numberOfChannels)
  for (let i = 0; i < length; i++) {
    mono[i] /= normalization
  }

  return mono
}

const downsampleMonoBuffer = (
  mono: Float32Array,
  sampleRate: number,
  targetSampleRate?: number
): { samples: Float32Array; sampleRate: number } => {
  if (!targetSampleRate || targetSampleRate >= sampleRate || targetSampleRate <= 0) {
    return { samples: mono, sampleRate }
  }

  const stride = Math.max(1, Math.floor(sampleRate / targetSampleRate))
  if (stride === 1) {
    return { samples: mono, sampleRate }
  }

  const nextLength = Math.ceil(mono.length / stride)
  const downsampled = new Float32Array(nextLength)

  for (let i = 0, j = 0; i < mono.length; i += stride, j += 1) {
    downsampled[j] = mono[i] ?? 0
  }

  return { samples: downsampled, sampleRate: sampleRate / stride }
}

const applyHannWindow = (frame: Float32Array): Float32Array => {
  const length = frame.length
  if (length === 0) {
    return frame
  }

  let mean = 0
  for (let i = 0; i < length; i++) {
    mean += frame[i] ?? 0
  }
  mean /= length

  const windowed = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (length - 1))
    windowed[i] = ((frame[i] ?? 0) - mean) * window
  }

  return windowed
}

const computeRms = (frame: Float32Array): number => {
  if (!frame.length) {
    return 0
  }

  let sumSquares = 0
  for (let i = 0; i < frame.length; i++) {
    const sample = frame[i] ?? 0
    sumSquares += sample * sample
  }

  return Math.sqrt(sumSquares / frame.length)
}

const goertzelMagnitude = (
  samples: Float32Array,
  sampleRate: number,
  targetFrequency: number
): number => {
  // Lightweight spectral measurement specialized for a single target frequency.
  const normalizedFrequency = targetFrequency / sampleRate
  const coefficient = 2 * Math.cos(2 * Math.PI * normalizedFrequency)

  let q0 = 0
  let q1 = 0
  let q2 = 0

  for (let i = 0; i < samples.length; i++) {
    q0 = coefficient * q1 - q2 + samples[i]!
    q2 = q1
    q1 = q0
  }

  const real = q1 - q2 * Math.cos(2 * Math.PI * normalizedFrequency)
  const imag = q2 * Math.sin(2 * Math.PI * normalizedFrequency)

  return Math.sqrt(real * real + imag * imag)
}

const weightedMedian = (
  values: Array<{ value: number; weight: number }>
): number | null => {
  if (!values.length) {
    return null
  }

  const sorted = [...values].sort((a, b) => a.value - b.value)
  const totalWeight =
    sorted.reduce((sum, entry) => sum + Math.max(0, entry.weight), 0) + 1e-6
  const midpoint = totalWeight / 2
  let running = 0

  for (const entry of sorted) {
    running += Math.max(0, entry.weight)
    if (running >= midpoint) {
      return entry.value
    }
  }

  return sorted[sorted.length - 1]?.value ?? null
}

const normalizePitchEnergies = (energies: number[], smoothing = 0.18): number[] => {
  const mean =
    energies.reduce((sum, value) => sum + value, 0) / Math.max(1, energies.length)
  const centered = energies.map((value) => Math.max(0, value - mean * 0.5))

  const smoothed = centered.map((value, index) => {
    const prev = centered[(index + 11) % 12] ?? 0
    const next = centered[(index + 1) % 12] ?? 0
    return value * (1 - smoothing) + (prev + next) * (smoothing / 2)
  })

  const tempered = smoothed.map((value) => Math.pow(value, 0.85))
  const total = tempered.reduce((sum, value) => sum + value, 0) + 1e-6
  return tempered.map((value) => value / total)
}

const computePitchClarity = (energies: number[]): number => {
  const total = energies.reduce((sum, value) => sum + value, 0) + 1e-6
  const sorted = [...energies].sort((a, b) => b - a)
  const topEnergy = (sorted[0] ?? 0) + (sorted[1] ?? 0) + (sorted[2] ?? 0)
  return topEnergy / total
}

const computePitchClassEnergies = (
  frame: Float32Array,
  sampleRate: number,
  harmonicFrequenciesByPitchClass: number[][]
): { energies: number[]; bassEnergies: number[] } => {
  const energies: number[] = []
  const bassEnergies: number[] = []

  harmonicFrequenciesByPitchClass.forEach((frequencies, pitchClass) => {
    let energy = 0
    let bassEnergy = 0

    frequencies.forEach((frequency) => {
      let harmonicSum = 0
      HARMONIC_WEIGHTS.forEach((weight, index) => {
        const harmonic = goertzelMagnitude(
          frame,
          sampleRate,
          frequency * (index + 1)
        )
        harmonicSum += harmonic * weight
      })

      const tilt = 1 / Math.sqrt(Math.max(1, frequency / 55))
      energy += harmonicSum * tilt
      if (frequency <= 196) {
        bassEnergy += harmonicSum * 1.3 * tilt
      }
    })

    energies[pitchClass] = Math.log1p(energy)
    bassEnergies[pitchClass] = Math.log1p(bassEnergy)
  })

  const normalized = normalizePitchEnergies(
    energies.map((value) => Math.pow(value, 1.3))
  )
  const normalizedBass = normalizePitchEnergies(
    bassEnergies.map((value) => Math.pow(value, 1.1)),
    0.1
  )

  return { energies: normalized, bassEnergies: normalizedBass }
}

const getBaseIntervals = (quality: ChordQuality): number[] => {
  switch (quality) {
    case "major":
    case "dom7":
    case "maj7":
    case "maj9":
      return [0, 4, 7]
    case "minor":
    case "min7":
    case "min9":
      return [0, 3, 7]
    case "sus2":
      return [0, 2, 7]
    case "suspended":
      return [0, 5, 7]
    case "power":
      return [0, 7]
    case "dim":
      return [0, 3, 6]
    case "aug":
      return [0, 4, 8]
    default:
      return [0, 4, 7]
  }
}

const scoreChordTemplate = (
  root: number,
  template: (typeof CHORD_TEMPLATES)[number],
  pitchEnergies: number[]
): { chord: string; score: number; confidence: number } => {
  const { quality, intervals } = template
  const baseIntervals = getBaseIntervals(quality)
  const baseIntervalSet = new Set(baseIntervals)
  const chordMask = new Array(12).fill(0)
  const extensionInterval = EXTENSION_INTERVALS[quality]

  intervals.forEach((interval, index) => {
    const isRoot = index === 0
    const isBase = baseIntervalSet.has(interval)
    const weight = isRoot ? 1.4 : isBase ? 1.1 : interval === 2 ? 0.55 : 0.7
    chordMask[(root + interval) % 12] = weight
  })

  let matchEnergy = 0
  let baseEnergy = 0
  let offEnergy = 0
  let weightedEnergy = 0
  let weightedChord = 0
  let extensionEnergy = 0

  pitchEnergies.forEach((energy, pitchClass) => {
    const weight = chordMask[pitchClass] ?? 0
    weightedEnergy += energy * energy
    if (weight > 0) {
      matchEnergy += energy * weight
      weightedChord += weight * weight
      if (weight >= 1) {
        baseEnergy += energy * weight
      }
    } else {
      offEnergy += energy
    }
    if (extensionInterval !== null && pitchClass === (root + extensionInterval) % 12) {
      extensionEnergy = energy
    }
  })

  const coverage = matchEnergy
  const cosine =
    matchEnergy /
    (Math.sqrt(weightedEnergy) * Math.sqrt(weightedChord) + 1e-6)
  const purity = Math.max(0, 1 - offEnergy * 0.95)
  const stability = baseEnergy * 0.65 + coverage * 0.35
  const extensionPenalty =
    extensionInterval === null ? 1 : extensionEnergy < 0.06 ? 0.84 : 1
  const score =
    (cosine * 0.6 + stability * 0.4) * purity * template.weight * extensionPenalty
  const confidence = Math.min(1, cosine * 0.7 + stability * 0.35) * extensionPenalty
  const label = formatChordLabel(root, quality)

  return { chord: label, score, confidence }
}

const formatChordLabel = (root: number, quality: ChordQuality): string => {
  const note = NOTE_LABELS[root] ?? "?"

  switch (quality) {
    case "major":
      return note
    case "minor":
      return `${note}m`
    case "power":
      return `${note}5`
    case "sus2":
      return `${note}sus2`
    case "suspended":
      return `${note}sus4`
    case "dom7":
      return `${note}7`
    case "maj7":
      return `${note}maj7`
    case "min7":
      return `${note}m7`
    case "maj9":
      return `${note}maj9`
    case "min9":
      return `${note}m9`
    case "dim":
      return `${note}dim`
    case "aug":
      return `${note}aug`
    default:
      return `${note} ${quality}`
  }
}

const estimateReferenceTuning = (
  samples: Float32Array,
  sampleRate: number
): number => {
  const frameSize = Math.min(4096, samples.length)
  if (frameSize < 1024) {
    return STANDARD_A4_FREQUENCY
  }

  const frameCount = 8
  const span = Math.max(1, samples.length - frameSize)
  const candidateFrames: Float32Array[] = []

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
    const start = Math.floor((span * frameIndex) / Math.max(1, frameCount - 1))
    const frame = samples.subarray(start, start + frameSize)
    const windowed = applyHannWindow(frame)
    if (computeRms(windowed) > 0.01) {
      candidateFrames.push(windowed)
    }
  }

  if (!candidateFrames.length) {
    return STANDARD_A4_FREQUENCY
  }

  const midiNotes: number[] = []
  for (let midi = 40; midi <= 76; midi += 1) {
    midiNotes.push(midi)
  }

  const centsSamples: Array<{ value: number; weight: number }> = []

  candidateFrames.forEach((frame) => {
    const coarseCandidates = midiNotes
      .map((midi) => {
        const standardFundamental =
          STANDARD_A4_FREQUENCY * Math.pow(2, (midi - 69) / 12)
        if (standardFundamental >= sampleRate / 2) {
          return null
        }

        const harmonic2 = standardFundamental * 2
        const baseMagnitude =
          goertzelMagnitude(frame, sampleRate, standardFundamental) +
          (harmonic2 < sampleRate / 2
            ? goertzelMagnitude(frame, sampleRate, harmonic2) * 0.4
            : 0)

        return { midi, baseMagnitude }
      })
      .filter((entry): entry is { midi: number; baseMagnitude: number } => Boolean(entry))
      .sort((a, b) => b.baseMagnitude - a.baseMagnitude)
      .slice(0, 10)

    coarseCandidates.forEach(({ midi, baseMagnitude }) => {
      let bestCents = 0
      let bestMagnitude = -Infinity

      for (
        let cents = TUNING_SCAN_MIN_CENTS;
        cents <= TUNING_SCAN_MAX_CENTS;
        cents += TUNING_FINE_STEP_CENTS
      ) {
        const tuningScale = Math.pow(2, cents / 1200)
        const tunedFundamental =
          STANDARD_A4_FREQUENCY * Math.pow(2, (midi - 69) / 12) * tuningScale
        if (tunedFundamental >= sampleRate / 2) {
          continue
        }

        const tunedHarmonic2 = tunedFundamental * 2
        const magnitude =
          goertzelMagnitude(frame, sampleRate, tunedFundamental) +
          (tunedHarmonic2 < sampleRate / 2
            ? goertzelMagnitude(frame, sampleRate, tunedHarmonic2) * 0.4
            : 0)

        if (magnitude > bestMagnitude) {
          bestMagnitude = magnitude
          bestCents = cents
        }
      }

      if (bestMagnitude > 0) {
        centsSamples.push({
          value: bestCents,
          weight: Math.log1p(bestMagnitude) + Math.log1p(baseMagnitude),
        })
      }
    })
  })

  const medianCents = weightedMedian(centsSamples)
  if (medianCents === null) {
    return STANDARD_A4_FREQUENCY
  }

  const referenceA4 = STANDARD_A4_FREQUENCY * Math.pow(2, medianCents / 1200)
  return Math.min(MAX_REFERENCE_A4, Math.max(MIN_REFERENCE_A4, referenceA4))
}

const formatTonalCenter = (referenceA4: number): string => {
  const frequency = referenceA4
  return `A${REFERENCE_OCTAVE} ${frequency.toFixed(2)}Hz`
}

const pickBestChord = (
  pitchEnergies: number[],
  bassEnergies: number[],
  minimumConfidence: number,
  referenceA4: number
): { chord: string; confidence: number; tonalCenter: string | null } => {
  const bassAverage =
    bassEnergies.reduce((sum, value) => sum + value, 0) / bassEnergies.length
  const clarity = computePitchClarity(pitchEnergies)
  const dynamicMinimum =
    minimumConfidence + Math.max(0, 0.28 - clarity) * 0.7

  let best: { chord: string; score: number; confidence: number } = {
    chord: "Unclear",
    score: 0,
    confidence: 0,
  }

  for (let root = 0; root < 12; root++) {
    CHORD_TEMPLATES.forEach((template) => {
      const candidate = scoreChordTemplate(root, template, pitchEnergies)
      const rootBass = bassEnergies[root] ?? 0
      const fifthBass = bassEnergies[(root + 7) % 12] ?? 0
      const bassBoost =
        Math.max(0, rootBass - bassAverage) * 0.9 +
        Math.max(0, fifthBass - bassAverage) * 0.3
      const weightedScore = candidate.score + bassBoost

      if (weightedScore > best.score) {
        best = candidate
        best.score = weightedScore
      }
    })
  }

  if (best.confidence < dynamicMinimum) {
    return { chord: "Unclear", confidence: best.confidence, tonalCenter: null }
  }

  const tonalCenter = formatTonalCenter(referenceA4)

  return { chord: best.chord, confidence: best.confidence, tonalCenter }
}

const yieldToBrowser = () =>
  new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => resolve())
    } else {
      setTimeout(resolve, 0)
    }
  })

const smoothChordFrames = (
  frames: ChordSnapshot[],
  stableFrameCount: number
): ChordSnapshot[] => {
  if (!frames.length) {
    return []
  }

  if (stableFrameCount <= 1) {
    return frames
  }

  const snapshots: ChordSnapshot[] = []
  const window = Math.max(3, stableFrameCount * 2 - 1)

  for (let i = 0; i < frames.length; i++) {
    const start = Math.max(0, i - Math.floor(window / 2))
    const end = Math.min(frames.length, start + window)
    const tally = new Map<string, { count: number; confidence: number }>()

    for (let j = start; j < end; j++) {
      const frame = frames[j]!
      if (frame.chord === "Unclear") {
        continue
      }

      const entry = tally.get(frame.chord) ?? { count: 0, confidence: 0 }
      entry.count += 1
      entry.confidence += frame.confidence
      tally.set(frame.chord, entry)
    }

    let bestChord = "Unclear"
    let bestCount = 0
    let bestConfidence = 0

    tally.forEach((entry, chord) => {
      if (entry.count > bestCount) {
        bestChord = chord
        bestCount = entry.count
        bestConfidence = entry.confidence / entry.count
      }
    })

    const chord = bestCount >= stableFrameCount ? bestChord : "Unclear"
    if (!snapshots.length || snapshots[snapshots.length - 1]!.chord !== chord) {
      snapshots.push({
        time: frames[i]!.time,
        chord,
        confidence: chord === "Unclear" ? 0 : bestConfidence,
      })
    }
  }

  return snapshots
}

export const analyzeChordTimeline = async (
  buffer: AudioBuffer,
  options: ChordAnalysisOptions = {}
): Promise<ChordSnapshot[]> => {
  const windowSeconds = options.windowSeconds ?? 1.4
  const hopSeconds = options.hopSeconds ?? 0.4
  const minimumConfidence = options.minimumConfidence ?? 0.18
  const stableFrameCount = options.stableFrameCount ?? 4
  const yieldEveryFrames = options.yieldEveryFrames ?? 10
  const silenceThreshold = 0.006
  const targetSampleRate = options.targetSampleRate ?? 11025

  const mono = createMonoBuffer(buffer)
  const { samples, sampleRate } = downsampleMonoBuffer(
    mono,
    buffer.sampleRate,
    targetSampleRate
  )
  const windowSize = Math.max(1, Math.floor(sampleRate * windowSeconds))
  const hopSize = Math.max(1, Math.floor(sampleRate * hopSeconds))
  const referenceA4 = estimateReferenceTuning(samples, sampleRate)
  const harmonicFrequenciesByPitchClass = buildHarmonicFrequenciesByPitchClass(
    referenceA4
  )

  const frames: ChordSnapshot[] = []
  let frameIndex = 0

  for (let start = 0; start < samples.length; start += hopSize) {
    const end = Math.min(start + windowSize, samples.length)
    const frame = samples.subarray(start, end)
    const windowed = applyHannWindow(frame)
    const rms = computeRms(windowed)

    if (rms < silenceThreshold) {
      frames.push({
        time: start / sampleRate,
        chord: "Unclear",
        confidence: 0,
      })
      frameIndex += 1
      if (yieldEveryFrames > 0 && frameIndex % yieldEveryFrames === 0) {
        await yieldToBrowser()
      }
      continue
    }

    const { energies, bassEnergies } = computePitchClassEnergies(
      windowed,
      sampleRate,
      harmonicFrequenciesByPitchClass
    )
    const { chord, confidence, tonalCenter } = pickBestChord(
      energies,
      bassEnergies,
      minimumConfidence,
      referenceA4
    )

    frames.push({
      time: start / sampleRate,
      chord: tonalCenter ? `${chord} (${tonalCenter})` : chord,
      confidence,
    })

    frameIndex += 1
    if (yieldEveryFrames > 0 && frameIndex % yieldEveryFrames === 0) {
      await yieldToBrowser()
    }
  }

  const smoothedFrames = smoothChordFrames(frames, stableFrameCount)

  return smoothedFrames
}
