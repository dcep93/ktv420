import {
  AMPLITUDE_WINDOW_SECONDS,
  FUTURE_WINDOW_SECONDS,
  PAST_WINDOW_SECONDS,
  type VisualizerType,
} from "./types";

const cachedPerformanceMode = true;
const HALF_PI = Math.PI / 2;
const TWO_PI = Math.PI * 2;
const KALEIDOSCOPE_EASE = 0.01;
const KALEIDOSCOPE_ENERGY_WINDOW_SECONDS = 0.5;
const KALEIDOSCOPE_ENERGY_CAP = 0.45;
const highwayStateMap = new WeakMap<
  HTMLCanvasElement,
  {
    lastTime: number;
    speed: number;
    seedOffset: number;
    stripeOffset: number;
    cacti: Map<number, { progress: number; side: number; speedBias: number }>;
    spawns: Map<
      number,
      { nextTime: number; seed: number; rng: number; sideSpeed: number }
    >;
  }
>();
type KaleidoscopeState = {
  width: number;
  height: number;
  radius: number;
  slices: number;
  zoom: number;
  offsetRotation: number;
  offsetScale: number;
  offsetX: number;
  offsetY: number;
  targetX: number;
  targetY: number;
  rotationTarget: number;
  rotationSpeed: number;
  lastTime: number;
  image: HTMLImageElement;
  pattern: CanvasPattern | null;
  onMouseMove?: (event: MouseEvent) => void;
};

const kaleidoscopeStateMap = new WeakMap<
  HTMLCanvasElement,
  KaleidoscopeState
>();

function isLowPowerMode(): boolean {
  return cachedPerformanceMode;
}

export type VisualizerInputs = {
  analyser: AnalyserNode;
  canvas: HTMLCanvasElement;
  currentTime: number;
  duration: number;
  visualizerType: VisualizerType;
  isPlaying: boolean;
  amplitudeEnvelope?: number[];
  amplitudeMaximum?: number;
  effectiveVolume?: number;
  sampleRate: number;
};

export function drawVisualizer({
  analyser,
  canvas,
  currentTime,
  duration,
  visualizerType,
  isPlaying,
  amplitudeEnvelope,
  amplitudeMaximum = 1,
  effectiveVolume = 1,
  sampleRate,
}: VisualizerInputs) {
  const context = canvas.getContext("2d");

  if (!context) {
    return;
  }

  const { width, height } = canvas;
  const performanceMode = isLowPowerMode();
  context.clearRect(0, 0, width, height);

  const timeDisplay = `${currentTime.toFixed(2)}s / ${Math.max(
    duration,
    0
  ).toFixed(2)}s`;

  context.fillStyle = "#0a0a0a";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#999";
  context.font = "12px sans-serif";
  context.fillText(timeDisplay, 10, 16);

  if (visualizerType === "laser-ladders") {
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(dataArray);
    const barWidth = (width / bufferLength) * 2.5;

    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
      const barHeight = dataArray[i] / 2;
      const gradient = context.createLinearGradient(
        0,
        height,
        0,
        height - barHeight
      );
      gradient.addColorStop(0, "#1dd3b0");
      gradient.addColorStop(1, "#6c43f3");
      context.fillStyle = gradient;
      context.fillRect(x, height - barHeight, barWidth - 1, barHeight);
      x += barWidth;
    }
  } else if (visualizerType === "spectrum-safari") {
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(dataArray);
    const sliceWidth = width / bufferLength;
    let peakIndex = 0;
    let peakValue = 0;

    for (let i = 0; i < bufferLength; i++) {
      const value = dataArray[i] ?? 0;
      if (value > peakValue) {
        peakValue = value;
        peakIndex = i;
      }
    }

    const nyquist = sampleRate / 2;
    const dominantFrequency =
      bufferLength > 0 ? (peakIndex / bufferLength) * nyquist : 0;
    const hue = Math.max(0, Math.min(280, (dominantFrequency / 2000) * 280));
    const strokeColor = `hsl(${hue}, 80%, 60%)`;
    const fillColor = `hsla(${hue}, 80%, 60%, 0.12)`;
    context.beginPath();
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
      const v = dataArray[i] / 255;
      const y = height - v * height;
      if (i === 0) {
        context.moveTo(x, y);
      } else {
        context.lineTo(x, y);
      }
      x += sliceWidth;
    }

    context.strokeStyle = strokeColor;
    context.lineWidth = 2;
    context.stroke();
    context.fillStyle = fillColor;
    context.fill();
  } else if (visualizerType === "waveform-waterline") {
    const bufferLength = analyser.fftSize;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteTimeDomainData(dataArray);

    context.fillStyle = "#0b1c2d";
    context.fillRect(0, 0, width, height);

    const centerY = height / 2;
    const sliceWidth = width / bufferLength;
    let x = 0;

    context.beginPath();
    for (let i = 0; i < bufferLength; i++) {
      const v = (dataArray[i] ?? 128) / 128;
      const y = centerY + (v - 1) * (height * 0.45);
      if (i === 0) {
        context.moveTo(x, y);
      } else {
        context.lineTo(x, y);
      }
      x += sliceWidth;
    }

    context.lineWidth = 2;
    context.strokeStyle = "#4fc3f7";
    context.stroke();

    context.fillStyle = "rgba(79, 195, 247, 0.12)";
    context.fillRect(0, centerY, width, centerY);
  } else if (visualizerType === "aurora-radar") {
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(dataArray);

    context.fillStyle = "#06090f";
    context.fillRect(0, 0, width, height);
    const centerX = width / 2;
    const centerY = height / 2;
    const maxRadius = Math.min(centerX, centerY) - 10;

    context.strokeStyle = "rgba(255, 255, 255, 0.05)";
    context.beginPath();
    for (let r = 20; r < maxRadius; r += 20) {
      context.moveTo(centerX + r, centerY);
      context.arc(centerX, centerY, r, 0, Math.PI * 2);
    }
    context.stroke();

    context.translate(centerX, centerY);
    const sweepAngle = Math.PI * 2;
    for (let i = 0; i < bufferLength; i++) {
      const magnitude = dataArray[i] ?? 0;
      const normalized = magnitude / 255;
      const angle = (i / bufferLength) * sweepAngle + currentTime * 0.6;
      const radius = normalized * maxRadius;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;

      context.beginPath();
      context.moveTo(0, 0);
      context.lineTo(x, y);
      context.strokeStyle = `hsla(${200 + normalized * 80}, 80%, 60%, ${
        0.4 + normalized * 0.5
      })`;
      context.lineWidth = 2;
      context.stroke();
    }

    context.setTransform(1, 0, 0, 1, 0, 0);
  } else if (visualizerType === "mirror-peaks") {
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(dataArray);

    context.fillStyle = "#0f0d18";
    context.fillRect(0, 0, width, height);

    const halfWidth = width / 2;
    const barWidth = Math.max(2, (halfWidth - 20) / bufferLength);
    const maxBarHeight = height - 24;

    for (let i = 0; i < bufferLength; i++) {
      const value = dataArray[i] ?? 0;
      const barHeight = (value / 255) * maxBarHeight;
      const color = `hsl(${260 - (value / 255) * 120}, 70%, 60%)`;

      const leftX = halfWidth - i * barWidth;
      const rightX = halfWidth + i * barWidth;

      context.fillStyle = color;
      context.fillRect(
        leftX - barWidth,
        height - barHeight,
        barWidth,
        barHeight
      );
      context.fillRect(rightX, height - barHeight, barWidth, barHeight);
    }

    context.fillStyle = "rgba(255, 255, 255, 0.1)";
    context.fillRect(halfWidth - 1, 0, 2, height);
  } else if (visualizerType === "pulse-grid") {
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(dataArray);

    context.fillStyle = "#050712";
    context.fillRect(0, 0, width, height);

    const columns = 16;
    const rows = 8;
    const cellWidth = width / columns;
    const cellHeight = height / rows;
    const binsPerCell = Math.max(1, Math.floor(bufferLength / columns));

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < columns; col++) {
        const startIndex = col * binsPerCell;
        const endIndex = Math.min(startIndex + binsPerCell, bufferLength);
        let sum = 0;

        for (let i = startIndex; i < endIndex; i++) {
          sum += dataArray[i] ?? 0;
        }

        const average = binsPerCell > 0 ? sum / binsPerCell : 0;
        const intensity = average / 255;
        const hue = 200 + intensity * 140 + col * 1.1;
        const lightness = 45 + intensity * 40;
        const alpha = 0.22 + intensity * 0.6;
        const offsetY = Math.sin(currentTime * 2.4 + col * 0.4) * 6;
        const x = col * cellWidth + 1;
        const y = row * cellHeight + 1 + offsetY;

        const gradient = context.createLinearGradient(
          x,
          y,
          x + cellWidth,
          y + cellHeight
        );
        gradient.addColorStop(
          0,
          `hsla(${hue - 18}, 85%, ${lightness}%, ${alpha * 0.7})`
        );
        gradient.addColorStop(
          1,
          `hsla(${hue + 18}, 90%, ${lightness + 8}%, ${alpha})`
        );

        context.fillStyle = gradient;
        context.shadowBlur = intensity * 16;
        context.shadowColor = `hsla(${hue}, 95%, ${lightness + 10}%, ${
          0.4 + intensity * 0.4
        })`;
        context.fillRect(x, y, cellWidth - 2, cellHeight - 2);

        if (intensity > 0.45) {
          context.strokeStyle = `hsla(${hue + 20}, 95%, ${lightness + 20}%, ${
            0.25 + intensity * 0.35
          })`;
          context.lineWidth = 1.3;
          context.strokeRect(x + 1.5, y + 1.5, cellWidth - 5, cellHeight - 5);
        }
      }
    }

    context.shadowBlur = 0;
    context.globalCompositeOperation = "screen";
    const sweepOffset = (currentTime * 0.8) % (cellWidth * 4);
    const sweepGradient = context.createLinearGradient(
      sweepOffset,
      0,
      sweepOffset + 160,
      0
    );
    sweepGradient.addColorStop(0, "rgba(80, 200, 255, 0)");
    sweepGradient.addColorStop(0.5, "rgba(160, 255, 220, 0.25)");
    sweepGradient.addColorStop(1, "rgba(255, 180, 255, 0)");
    context.fillStyle = sweepGradient;
    context.fillRect(0, 0, width, height);
    context.globalCompositeOperation = "source-over";

    context.strokeStyle = "rgba(255, 255, 255, 0.04)";
    for (let x = 0; x <= width; x += cellWidth) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, height);
      context.stroke();
    }
    for (let y = 0; y <= height; y += cellHeight) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
    }
  } else if (visualizerType === "luminous-orbit") {
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(dataArray);

    const centerX = width / 2;
    const centerY = height / 2;
    const maxRadius = Math.min(width, height) / 2 - 12;

    context.fillStyle = "#06080f";
    context.fillRect(0, 0, width, height);

    context.save();
    context.translate(centerX, centerY);
    const rings = 5;
    const binsPerRing = Math.max(1, Math.floor(bufferLength / rings));

    for (let ring = 0; ring < rings; ring++) {
      const radius = ((ring + 1) / rings) * maxRadius;
      const startIndex = ring * binsPerRing;
      const endIndex = Math.min(startIndex + binsPerRing, bufferLength);
      let peak = 0;

      for (let i = startIndex; i < endIndex; i++) {
        peak = Math.max(peak, dataArray[i] ?? 0);
      }

      const magnitude = peak / 255;
      const glow = 6 + magnitude * 12;
      context.beginPath();
      context.arc(0, 0, radius, 0, Math.PI * 2);
      context.strokeStyle = `hsla(${210 + magnitude * 80}, 80%, 60%, ${
        0.3 + magnitude * 0.5
      })`;
      context.lineWidth = 2 + magnitude * 4;
      context.shadowBlur = glow;
      context.shadowColor = `hsla(${210 + magnitude * 80}, 80%, 60%, 0.8)`;
      context.stroke();
    }

    context.shadowBlur = 0;
    context.rotate(currentTime * 0.2);
    context.beginPath();
    const orbitTrail = Math.min(bufferLength, 180);
    for (let i = 0; i < orbitTrail; i++) {
      const value = dataArray[i] ?? 0;
      const normalized = value / 255;
      const angle = (i / orbitTrail) * Math.PI * 2;
      const radius = normalized * maxRadius;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      if (i === 0) {
        context.moveTo(x, y);
      } else {
        context.lineTo(x, y);
      }
    }
    context.strokeStyle = "rgba(255, 255, 255, 0.35)";
    context.lineWidth = 1.5;
    context.stroke();
    context.restore();
  } else if (visualizerType === "prism-bloom") {
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(dataArray);

    context.fillStyle = "#03040b";
    context.fillRect(0, 0, width, height);

    const centerX = width / 2;
    const centerY = height / 2;
    const maxRadius = Math.min(centerX, centerY) - 12;

    context.save();
    context.translate(centerX, centerY);

    const rayCount = 28;
    for (let ray = 0; ray < rayCount; ray++) {
      const bandIndex = Math.floor((ray / rayCount) * (bufferLength - 1));
      const magnitude = (dataArray[bandIndex] ?? 0) / 255;
      const angle = ray * ((Math.PI * 2) / rayCount) + currentTime * 0.25;
      const shardLength = 24 + magnitude * maxRadius;
      const shardSpread = Math.PI / 40 + magnitude * 0.22;

      context.beginPath();
      context.arc(0, 0, shardLength, angle - shardSpread, angle + shardSpread);
      context.strokeStyle = `hsla(${210 + magnitude * 120}, 90%, 70%, ${
        0.25 + magnitude * 0.55
      })`;
      context.lineWidth = 2 + magnitude * 5;
      context.shadowBlur = 8 + magnitude * 18;
      context.shadowColor = `hsla(${210 + magnitude * 120}, 90%, 65%, 0.8)`;
      context.stroke();

      const starRadius = shardLength * 0.45;
      context.beginPath();
      context.arc(
        Math.cos(angle) * starRadius,
        Math.sin(angle) * starRadius,
        2 + magnitude * 6,
        0,
        Math.PI * 2
      );
      context.fillStyle = `hsla(${260 + ray * 3}, 95%, 75%, ${
        0.2 + magnitude * 0.5
      })`;
      context.fill();
    }

    context.shadowBlur = 0;

    context.globalCompositeOperation = "lighter";
    const haloBands = 5;
    for (let band = 0; band < haloBands; band++) {
      const progress = band / haloBands;
      const radius = 16 + progress * maxRadius;
      const pulse = (Math.sin(currentTime * 1.2 + band) + 1) / 2;
      context.beginPath();
      context.arc(0, 0, radius, 0, Math.PI * 2);
      context.strokeStyle = `hsla(${180 + pulse * 120}, 80%, ${
        50 + progress * 25
      }%, ${0.12 + pulse * 0.18})`;
      context.lineWidth = 1 + pulse * 2;
      context.stroke();
    }
    context.globalCompositeOperation = "source-over";

    context.restore();
  } else if (visualizerType === "cascade-horizon") {
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(dataArray);

    context.fillStyle = "#02060f";
    context.fillRect(0, 0, width, height);

    const layers = 8;
    const baseLine = height - 10;
    const sliceWidth = width / (bufferLength - 1);

    for (let layer = 0; layer < layers; layer++) {
      const depth = layer / layers;
      const hue = 190 + depth * 120;
      const glow = 4 + depth * 12;
      const drift = currentTime * (0.4 + depth * 0.8);
      const heightScale = 24 + depth * 90;

      context.beginPath();
      context.moveTo(0, baseLine);

      for (let i = 0; i < bufferLength; i++) {
        const v = (dataArray[i] ?? 0) / 255;
        const wave = Math.sin(i * 0.05 + drift) * (6 + depth * 10);
        const ridge = Math.sin(i * 0.12 - drift * 0.6) * (4 + depth * 6);
        const y = baseLine - v * heightScale - depth * 26 + wave + ridge;
        context.lineTo(i * sliceWidth, y);
      }

      context.lineTo(width, baseLine);
      context.closePath();
      context.fillStyle = `hsla(${hue}, 75%, ${28 + depth * 32}%, ${
        0.15 + depth * 0.14
      })`;
      context.shadowBlur = glow;
      context.shadowColor = `hsla(${hue}, 80%, 65%, 0.4)`;
      context.fill();
      context.strokeStyle = `hsla(${hue}, 90%, 72%, ${0.4 + depth * 0.25})`;
      context.lineWidth = 1.4;
      context.stroke();
    }

    context.shadowBlur = 0;
    context.fillStyle = "rgba(255, 255, 255, 0.12)";
    for (let i = 0; i < 30; i++) {
      const x = Math.random() * width;
      const y = Math.random() * height * 0.6;
      const size = Math.random() * 2 + 0.5;
      context.beginPath();
      context.arc(x, y, size, 0, Math.PI * 2);
      context.fill();
    }
  } else if (visualizerType === "nebula-trails") {
    const bufferLength = analyser.fftSize;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteTimeDomainData(dataArray);

    context.fillStyle = "rgba(6, 10, 20, 0.6)";
    context.fillRect(0, 0, width, height);

    const centerY = height / 2;
    const sliceWidth = width / bufferLength;
    const hueShift = (currentTime * 40) % 360;

    context.beginPath();
    for (let i = 0; i < bufferLength; i++) {
      const v = (dataArray[i] ?? 128) / 128;
      const y = centerY + (v - 1) * (height * 0.42);
      const x = i * sliceWidth;
      if (i === 0) {
        context.moveTo(x, y);
      } else {
        context.lineTo(x, y);
      }
    }
    context.strokeStyle = `hsla(${hueShift}, 80%, 65%, 0.9)`;
    context.lineWidth = 2.5;
    context.shadowBlur = 10;
    context.shadowColor = `hsla(${hueShift}, 80%, 65%, 0.7)`;
    context.stroke();

    context.shadowBlur = 0;
    for (let i = 0; i < bufferLength; i += 12) {
      const v = (dataArray[i] ?? 128) / 128;
      const y = centerY + (v - 1) * (height * 0.45);
      const x = i * sliceWidth;
      const size = 2 + Math.abs(v - 1) * 10;
      const alpha = 0.15 + Math.abs(v - 1) * 0.4;
      context.fillStyle = `hsla(${hueShift + i * 0.3}, 90%, 70%, ${alpha})`;
      context.beginPath();
      context.ellipse(x, y, size, size * 0.7, 0, 0, Math.PI * 2);
      context.fill();
    }
  } else if (visualizerType === "ember-mandala") {
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(dataArray);

    context.fillStyle = "#0a060e";
    context.fillRect(0, 0, width, height);

    const centerX = width / 2;
    const centerY = height / 2;
    const maxRadius = Math.min(centerX, centerY) - 12;

    context.save();
    context.translate(centerX, centerY);
    const petalCount = 30;
    for (let petal = 0; petal < petalCount; petal++) {
      const binIndex = Math.floor((petal / petalCount) * (bufferLength - 1));
      const magnitude = (dataArray[binIndex] ?? 0) / 255;
      const angle = petal * ((Math.PI * 2) / petalCount) + currentTime * 0.35;
      const spread = (Math.PI / petalCount) * (0.8 + magnitude * 1.2);
      const innerRadius = 16 + magnitude * 36;
      const outerRadius = maxRadius * (0.35 + magnitude * 0.55);

      const tipX = Math.cos(angle) * outerRadius;
      const tipY = Math.sin(angle) * outerRadius;
      const leftX = Math.cos(angle - spread) * innerRadius;
      const leftY = Math.sin(angle - spread) * innerRadius;
      const rightX = Math.cos(angle + spread) * innerRadius;
      const rightY = Math.sin(angle + spread) * innerRadius;

      const hue = 20 + magnitude * 80 + petal * 1.2;
      const glow = 6 + magnitude * 22;

      const gradient = context.createLinearGradient(0, 0, tipX, tipY);
      gradient.addColorStop(
        0,
        `hsla(${hue}, 85%, 65%, ${0.08 + magnitude * 0.35})`
      );
      gradient.addColorStop(
        1,
        `hsla(${hue + 30}, 90%, 72%, ${0.2 + magnitude * 0.55})`
      );

      context.beginPath();
      context.moveTo(leftX, leftY);
      context.quadraticCurveTo(tipX * 0.5, tipY * 0.5, tipX, tipY);
      context.quadraticCurveTo(tipX * 0.5, tipY * 0.5, rightX, rightY);
      context.closePath();
      context.fillStyle = gradient;
      context.shadowBlur = glow;
      context.shadowColor = `hsla(${hue + 10}, 95%, 70%, ${
        0.4 + magnitude * 0.4
      })`;
      context.fill();
    }

    context.shadowBlur = 0;
    const ringCount = 4;
    for (let ring = 0; ring < ringCount; ring++) {
      const progress = ring / ringCount;
      const radius = 10 + progress * maxRadius * 0.65;
      const pulse = (Math.sin(currentTime * 1.6 + ring) + 1) / 2;
      context.beginPath();
      context.arc(0, 0, radius, 0, Math.PI * 2);
      context.strokeStyle = `hsla(${progress * 80 + pulse * 30}, 80%, ${
        55 + pulse * 20
      }%, ${0.18 + pulse * 0.25})`;
      context.lineWidth = 1.2 + pulse * 2.4;
      context.stroke();
    }

    const emberCount = 28;
    for (let i = 0; i < emberCount; i++) {
      const t = (i / emberCount) * Math.PI * 2 + currentTime * 0.7;
      const orbit = maxRadius * 0.45 + Math.sin(currentTime * 1.2 + i) * 12;
      const magnitude = (dataArray[i % bufferLength] ?? 0) / 255;
      const x = Math.cos(t) * orbit;
      const y = Math.sin(t) * orbit;
      const size = 2 + magnitude * 6;
      context.beginPath();
      context.arc(x, y, size, 0, Math.PI * 2);
      context.fillStyle = `hsla(${40 + magnitude * 120}, 90%, 70%, ${
        0.5 + magnitude * 0.4
      })`;
      context.fill();
    }

    context.restore();
  } else if (visualizerType === "hippie-mirage") {
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    const waveformArray = new Uint8Array(analyser.fftSize);
    analyser.getByteFrequencyData(dataArray);
    analyser.getByteTimeDomainData(waveformArray);

    const centerX = width / 2;
    const centerY = height / 2;
    const maxRadius = Math.min(centerX, centerY) - 10;

    const hueDrift = currentTime * 18;
    const bgGradient = context.createRadialGradient(
      centerX,
      centerY,
      16,
      centerX,
      centerY,
      maxRadius
    );
    bgGradient.addColorStop(
      0,
      `hsla(${(hueDrift + 260) % 360}, 70%, 60%, 0.45)`
    );
    bgGradient.addColorStop(
      0.55,
      `hsla(${(hueDrift + 190) % 360}, 75%, 54%, 0.3)`
    );
    bgGradient.addColorStop(1, "#070910");

    context.fillStyle = bgGradient;
    context.fillRect(0, 0, width, height);

    context.save();
    context.translate(centerX, centerY);

    const petals = 12;
    const ringCount = 16;
    for (let ring = 0; ring < ringCount; ring++) {
      const t = ring / ringCount;
      const index = Math.floor(t * (bufferLength - 1));
      const magnitude = (dataArray[index] ?? 0) / 255;
      const radius =
        32 +
        t * maxRadius * 0.9 +
        Math.sin(currentTime * 1.2 + ring * 0.8) * (4 + magnitude * 10);
      const hue = (hueDrift + t * 200 + magnitude * 90) % 360;
      const wobble = Math.sin(currentTime * 1.7 + ring * 0.6) * 0.16;

      context.beginPath();
      for (let p = 0; p < petals; p++) {
        const angle = (p / petals) * Math.PI * 2 + t * 2.4 + currentTime * 0.35;
        const pulse =
          1 + Math.sin(angle * 1.6 + ring * 0.3) * 0.1 + magnitude * 0.3;
        const r = radius * pulse * (1 + wobble * Math.sin(angle * 3));
        const x = Math.cos(angle) * r;
        const y = Math.sin(angle) * r;
        if (p === 0) {
          context.moveTo(x, y);
        } else {
          context.lineTo(x, y);
        }
      }
      context.closePath();
      context.fillStyle = `hsla(${hue}, 82%, ${46 + magnitude * 26}%, ${
        0.14 + magnitude * 0.28
      })`;
      context.shadowBlur = 6 + magnitude * 10;
      context.shadowColor = `hsla(${hue}, 88%, 70%, 0.35)`;
      context.fill();
    }

    context.shadowBlur = 0;
    const trailCount = 28;
    for (let i = 0; i < trailCount; i++) {
      const angle = (i / trailCount) * Math.PI * 2 + currentTime * 0.7;
      const waveIndex = Math.floor(
        (i / trailCount) * (waveformArray.length - 1)
      );
      const waveLevel = ((waveformArray[waveIndex] ?? 128) - 128) / 128;
      const radius =
        maxRadius * 0.25 + (i / trailCount) * maxRadius * 0.65 + waveLevel * 12;
      const size = 1.8 + Math.abs(waveLevel) * 4;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      context.beginPath();
      context.arc(x, y, size, 0, Math.PI * 2);
      context.fillStyle = `hsla(${(hueDrift + i * 5) % 360}, 88%, 72%, ${
        0.28 + Math.abs(waveLevel) * 0.35
      })`;
      context.fill();
    }

    context.globalAlpha = 0.55;
    context.rotate(Math.sin(currentTime * 0.45) * 0.32);
    const bandCount = 4;
    for (let band = 0; band < bandCount; band++) {
      const gradient = context.createLinearGradient(
        -maxRadius,
        0,
        maxRadius,
        0
      );
      const hue = (hueDrift + band * 60) % 360;
      gradient.addColorStop(0, `hsla(${hue}, 75%, 60%, 0)`);
      gradient.addColorStop(0.5, `hsla(${hue + 30}, 85%, 64%, 0.3)`);
      gradient.addColorStop(1, `hsla(${hue + 70}, 75%, 58%, 0)`);
      context.fillStyle = gradient;
      const y =
        -maxRadius +
        band * (maxRadius / 2.2) +
        Math.sin(currentTime * 1.1 + band) * 10;
      context.fillRect(-maxRadius, y, maxRadius * 2, maxRadius / 2.6);
    }

    context.restore();

    // canvas-wide tie-dye sweeps
    const stripCount = 7;
    const slice = width / waveformArray.length;
    context.globalCompositeOperation = "screen";
    for (let strip = 0; strip < stripCount; strip++) {
      const verticalOffset = (strip / stripCount) * height;
      const drift = Math.sin(currentTime * 0.9 + strip) * height * 0.06;
      context.beginPath();
      for (let i = 0; i < waveformArray.length; i += 3) {
        const v = ((waveformArray[i] ?? 128) - 128) / 128;
        const x = i * slice;
        const y = verticalOffset + drift + v * height * 0.12;
        if (i === 0) {
          context.moveTo(x, y);
        } else {
          context.lineTo(x, y);
        }
      }
      const hue = (hueDrift + strip * 40) % 360;
      context.strokeStyle = `hsla(${hue}, 85%, 70%, 0.25)`;
      context.lineWidth = 6;
      context.shadowBlur = 10;
      context.shadowColor = `hsla(${hue}, 85%, 65%, 0.4)`;
      context.stroke();
    }
    context.shadowBlur = 0;
    context.globalCompositeOperation = "source-over";
  } else if (visualizerType === "hollow-echoes") {
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(dataArray);

    context.fillStyle = "#0a0c10";
    context.fillRect(0, 0, width, height);

    const columns = 24;
    const columnWidth = width / columns;
    const maxHeight = height - 30;

    for (let col = 0; col < columns; col++) {
      const startIndex = Math.floor((col / columns) * bufferLength);
      const value = (dataArray[startIndex] ?? 0) / 255;
      const columnHeight = value * maxHeight;
      const baseX = col * columnWidth + columnWidth * 0.15;
      const hue = 210 + value * 120 + col * 1.2;

      context.fillStyle = `hsla(${hue}, 80%, 62%, 0.18)`;
      context.fillRect(
        baseX,
        height - columnHeight,
        columnWidth * 0.7,
        columnHeight
      );

      const hollowHeight = columnHeight * 0.45;
      const hollowY = height - columnHeight + columnHeight * 0.25;
      context.strokeStyle = `hsla(${hue}, 90%, 75%, ${0.5 + value * 0.4})`;
      context.lineWidth = 2;
      context.strokeRect(
        baseX + 3,
        hollowY,
        columnWidth * 0.7 - 6,
        hollowHeight
      );

      const echoCount = 3;
      for (let e = 0; e < echoCount; e++) {
        const inset = e * 4;
        const opacity = 0.14 + value * 0.2 - e * 0.03;
        context.strokeStyle = `hsla(${hue + e * 6}, 85%, 70%, ${opacity})`;
        context.strokeRect(
          baseX + 3 + inset,
          hollowY + inset * 1.4,
          columnWidth * 0.7 - 6 - inset * 2,
          hollowHeight - inset * 2.4
        );
      }
    }

    context.fillStyle = "rgba(255, 255, 255, 0.08)";
    context.font = "11px sans-serif";
    context.fillText("Harmonic cavities", 10, 18);
  } else if (visualizerType === "opal-current") {
    const bufferLength = analyser.fftSize;
    const timeData = new Uint8Array(bufferLength);
    analyser.getByteTimeDomainData(timeData);

    context.fillStyle = "#04070f";
    context.fillRect(0, 0, width, height);

    const ribbonCount = 5;
    const sliceWidth = width / bufferLength;
    for (let ribbon = 0; ribbon < ribbonCount; ribbon++) {
      const depth = ribbon / ribbonCount;
      const offsetY = height * (0.3 + depth * 0.5);
      const flow = currentTime * (1 + depth * 0.4);
      const hue = 180 + depth * 80;

      context.beginPath();
      for (let i = 0; i < bufferLength; i++) {
        const v = (timeData[i] ?? 128) / 128 - 1;
        const shimmer = Math.sin(i * 0.05 + flow) * (10 + depth * 14);
        const y = offsetY + shimmer + v * (height * 0.18 - depth * 10);
        const x = i * sliceWidth;
        if (i === 0) {
          context.moveTo(x, y);
        } else {
          context.lineTo(x, y);
        }
      }

      const opacity = 0.18 + (1 - depth) * 0.16;
      const gradient = context.createLinearGradient(
        0,
        offsetY - 40,
        width,
        offsetY + 40
      );
      gradient.addColorStop(0, `hsla(${hue - 30}, 80%, 60%, ${opacity})`);
      gradient.addColorStop(1, `hsla(${hue + 40}, 90%, 70%, ${opacity + 0.1})`);

      context.strokeStyle = gradient;
      context.lineWidth = 2.2 - depth * 0.4;
      context.shadowBlur = 10 + (1 - depth) * 12;
      context.shadowColor = `hsla(${hue + 10}, 90%, 75%, 0.4)`;
      context.stroke();

      context.shadowBlur = 0;
      context.fillStyle = `hsla(${hue}, 85%, 55%, ${opacity * 0.55})`;
      context.fill();
    }

    context.shadowBlur = 0;
    context.globalCompositeOperation = "lighter";
    context.fillStyle = "rgba(255, 255, 255, 0.06)";
    for (let i = 0; i < 26; i++) {
      const x = ((i + currentTime * 12) % 26) * (width / 26);
      const y = height * (0.18 + Math.sin(currentTime * 1.3 + i) * 0.08);
      const size = 2 + Math.sin(currentTime * 2 + i) * 1.5;
      context.beginPath();
      context.ellipse(x, y, size * 1.4, size * 0.9, 0, 0, Math.PI * 2);
      context.fill();
    }
    context.globalCompositeOperation = "source-over";
  } else if (visualizerType === "solstice-waves") {
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(dataArray);

    context.fillStyle = "#08090f";
    context.fillRect(0, 0, width, height);

    const horizon = height * 0.62;
    const sunRadius = height * 0.16;
    const glow = Math.sin(currentTime * 1.4) * 0.5 + 0.5;

    context.beginPath();
    context.arc(width / 2, horizon, sunRadius, 0, Math.PI * 2);
    context.fillStyle = `hsla(${40 + glow * 30}, 95%, ${55 + glow * 15}%, ${
      0.45 + glow * 0.25
    })`;
    context.shadowBlur = 25 + glow * 35;
    context.shadowColor = "rgba(255, 200, 120, 0.65)";
    context.fill();
    context.shadowBlur = 0;

    const layerCount = 5;
    const sliceWidth = width / (bufferLength - 1);
    for (let layer = 0; layer < layerCount; layer++) {
      const depth = layer / layerCount;
      const amplitude = 10 + depth * 24;
      const drift = currentTime * (0.8 + depth * 0.6);
      const hue = 200 + depth * 80;

      context.beginPath();
      context.moveTo(0, horizon + depth * 26);
      for (let i = 0; i < bufferLength; i++) {
        const v = (dataArray[i] ?? 0) / 255;
        const y =
          horizon +
          depth * 26 +
          Math.sin(i * 0.08 + drift) * amplitude -
          v * 28;
        context.lineTo(i * sliceWidth, y);
      }
      context.lineTo(width, height);
      context.lineTo(0, height);
      context.closePath();
      context.fillStyle = `hsla(${hue}, 75%, ${35 + depth * 20}%, ${
        0.12 + depth * 0.18
      })`;
      context.strokeStyle = `hsla(${hue}, 85%, 65%, ${0.25 + depth * 0.2})`;
      context.lineWidth = 1.6;
      context.shadowBlur = 6 + depth * 12;
      context.shadowColor = `hsla(${hue}, 85%, 65%, 0.5)`;
      context.fill();
      context.stroke();
    }

    context.shadowBlur = 0;
    context.fillStyle = "rgba(255, 255, 255, 0.08)";
    context.fillRect(0, horizon, width, height - horizon);
  } else if (visualizerType === "ripple-weave") {
    const bufferLength = analyser.fftSize;
    const timeData = new Uint8Array(bufferLength);
    analyser.getByteTimeDomainData(timeData);

    context.fillStyle = "#060a11";
    context.fillRect(0, 0, width, height);

    const ribbonCount = 3;
    const sliceWidth = width / bufferLength;
    for (let ribbon = 0; ribbon < ribbonCount; ribbon++) {
      const offsetY = height * (0.25 + ribbon * 0.25);
      const phase = ribbon * 0.8 + currentTime * (0.8 + ribbon * 0.3);
      context.beginPath();
      for (let i = 0; i < bufferLength; i++) {
        const v = (timeData[i] ?? 128) / 128 - 1;
        const ripple = Math.sin(i * 0.04 + phase) * 18;
        const y = offsetY + ripple + v * (height * 0.2 - ribbon * 8);
        const x = i * sliceWidth;
        if (i === 0) {
          context.moveTo(x, y);
        } else {
          context.lineTo(x, y);
        }
      }
      const hue = 180 + ribbon * 60;
      context.strokeStyle = `hsla(${hue}, 85%, 65%, 0.8)`;
      context.lineWidth = 2.2 - ribbon * 0.4;
      context.shadowBlur = 8 + ribbon * 6;
      context.shadowColor = `hsla(${hue}, 85%, 65%, 0.6)`;
      context.stroke();

      context.shadowBlur = 0;
      context.fillStyle = `hsla(${hue}, 85%, 60%, 0.08)`;
      context.fill();
    }

    context.shadowBlur = 0;
    context.fillStyle = "rgba(255, 255, 255, 0.06)";
    for (let i = 0; i < 24; i++) {
      const x = (i / 24) * width;
      const y = height * 0.12 + Math.sin(currentTime * 1.2 + i * 0.4) * 6;
      context.fillRect(x, y, 2, height * 0.76);
    }
  } else if (visualizerType === "echo-lantern") {
    const frequencyBins = analyser.frequencyBinCount;
    const frequencyData = new Uint8Array(frequencyBins);
    analyser.getByteFrequencyData(frequencyData);

    const timeBufferLength = analyser.fftSize;
    const timeDomainData = new Uint8Array(timeBufferLength);
    analyser.getByteTimeDomainData(timeDomainData);

    context.fillStyle = "#03060e";
    context.fillRect(0, 0, width, height);

    const centerX = width / 2;
    const centerY = height / 2;
    const maxRadius = Math.min(centerX, centerY) - 12;

    context.save();
    context.translate(centerX, centerY);

    const beaconPulse = (Math.sin(currentTime * 1.4) + 1) / 2;
    const lanternRadius = 10 + beaconPulse * 8;
    context.beginPath();
    context.arc(0, 0, lanternRadius, 0, Math.PI * 2);
    context.fillStyle = `hsla(${40 + beaconPulse * 20}, 95%, 65%, 0.4)`;
    context.shadowBlur = 18 + beaconPulse * 30;
    context.shadowColor = "rgba(255, 200, 120, 0.85)";
    context.fill();

    context.shadowBlur = 0;
    const rings = 7;
    for (let ring = 0; ring < rings; ring++) {
      const progress = ring / rings;
      const radius = 16 + progress * maxRadius;
      const binIndex = Math.floor(progress * (frequencyBins - 1));
      const intensity = (frequencyData[binIndex] ?? 0) / 255;
      const flicker = Math.sin(currentTime * 3 + ring) * 0.08;

      context.beginPath();
      context.arc(0, 0, radius, 0, Math.PI * 2);
      context.strokeStyle = `hsla(${180 + intensity * 120}, 80%, ${
        50 + intensity * 30
      }%, ${0.18 + intensity * 0.4 + flicker})`;
      context.lineWidth = 1.3 + intensity * 3.5;
      context.shadowBlur = 8 + intensity * 18;
      context.shadowColor = `hsla(${180 + intensity * 120}, 90%, 70%, 0.75)`;
      context.stroke();
    }

    context.shadowBlur = 0;
    context.beginPath();
    const sliceWidth = (Math.PI * 2) / timeBufferLength;
    const orbitRadius = maxRadius * 0.55;
    for (let i = 0; i < timeBufferLength; i++) {
      const v = (timeDomainData[i] ?? 128) / 128 - 1;
      const angle = i * sliceWidth + currentTime * 0.5;
      const radialDrift = orbitRadius + v * maxRadius * 0.25;
      const x = Math.cos(angle) * radialDrift;
      const y = Math.sin(angle) * radialDrift;
      if (i === 0) {
        context.moveTo(x, y);
      } else {
        context.lineTo(x, y);
      }
    }
    context.closePath();
    context.fillStyle = "rgba(255, 255, 255, 0.07)";
    context.strokeStyle = "rgba(255, 255, 255, 0.35)";
    context.lineWidth = 1.8;
    context.fill();
    context.stroke();

    const orbiters = 5;
    for (let orb = 0; orb < orbiters; orb++) {
      const angle =
        currentTime * (0.8 + orb * 0.2) + orb * ((Math.PI * 2) / orbiters);
      const bandIndex = Math.floor((orb / orbiters) * (frequencyBins - 1));
      const intensity = (frequencyData[bandIndex] ?? 0) / 255;
      const radius = orbitRadius + Math.sin(currentTime * 1.2 + orb) * 10;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;

      context.beginPath();
      context.arc(x, y, 4 + intensity * 6, 0, Math.PI * 2);
      context.fillStyle = `hsla(${40 + intensity * 60}, 95%, 70%, ${
        0.5 + intensity * 0.4
      })`;
      context.shadowBlur = 12 + intensity * 20;
      context.shadowColor = `hsla(${40 + intensity * 60}, 95%, 70%, 0.8)`;
      context.fill();
    }

    context.restore();
  } else if (visualizerType === "ectoplasm") {
    const freqLength = analyser.frequencyBinCount;
    const frequencyData = new Uint8Array(freqLength);
    analyser.getByteFrequencyData(frequencyData);

    const timeLength = analyser.fftSize;
    const timeData = new Uint8Array(timeLength);
    analyser.getByteTimeDomainData(timeData);

    const detailScale = performanceMode ? 0.6 : 1;
    const centerX = width / 2;
    const centerY = height / 2;
    const maxRadius =
      Math.hypot(width, height) * (performanceMode ? 0.6 : 0.75);

    const bassEnergy =
      freqLength > 0
        ? frequencyData
            .slice(0, Math.max(1, Math.floor(freqLength / 8)))
            .reduce((sum, value) => sum + value, 0) /
          (Math.max(1, Math.floor(freqLength / 8)) * 255)
        : 0;
    const totalEnergy =
      freqLength > 0
        ? frequencyData.reduce((sum, value) => sum + value, 0) /
          (freqLength * 255)
        : 0;

    const bg = context.createRadialGradient(
      centerX,
      centerY,
      0,
      centerX,
      centerY,
      maxRadius
    );
    bg.addColorStop(0, "rgba(4, 12, 20, 0.9)");
    bg.addColorStop(0.4, "rgba(10, 12, 28, 0.82)");
    bg.addColorStop(1, "rgba(2, 4, 10, 1)");
    context.fillStyle = bg;
    context.fillRect(0, 0, width, height);

    context.save();
    context.translate(centerX, centerY);
    context.rotate(Math.sin(currentTime * 0.25) * 0.12);

    const arms = performanceMode ? 3 : 4;
    const loops = performanceMode ? 3 : 5;
    const segments = Math.max(140, Math.floor(220 * detailScale));
    const spiralStrength = 0.7 + totalEnergy * 0.8;
    const musicSpin = 0.35 + totalEnergy * 1.2 + bassEnergy * 0.8;
    const spinNoise = (seed: number) => {
      const x = Math.sin(seed * 12.9898 + currentTime * 0.9) * 43758.5453;
      return (x - Math.floor(x)) * Math.PI * 2;
    };

    for (let arm = 0; arm < arms; arm++) {
      const path = new Path2D();
      let started = false;
      for (let s = 0; s <= segments; s++) {
        const t = s / segments;
        const index = Math.floor(t * (timeLength - 1));
        const osc = ((timeData[index] ?? 128) - 128) / 128;
        const spiralRadius =
          Math.pow(t, 0.75) * maxRadius * (0.9 + Math.abs(osc) * 0.25);
        const wobble = Math.sin(currentTime * 1.3 + s * 0.06 + arm) * 0.35;
        const spin =
          t * loops * Math.PI * 2 +
          arm * ((Math.PI * 2) / arms) +
          wobble +
          currentTime * musicSpin;
        const flare = 1 + bassEnergy * 0.6 + totalEnergy * 0.6;
        const x = Math.cos(spin) * spiralRadius * spiralStrength * flare;
        const y = Math.sin(spin) * spiralRadius * spiralStrength * flare;
        if (!started) {
          path.moveTo(x, y);
          started = true;
        } else {
          path.lineTo(x, y);
        }
      }

      const hue = (120 + arm * 40 + totalEnergy * 200) % 360;
      const glow = 12 + totalEnergy * 28 + bassEnergy * 20;
      context.strokeStyle = `hsla(${hue}, 95%, ${58 + bassEnergy * 20}%, ${
        0.24 + totalEnergy * 0.35
      })`;
      context.lineWidth = 2 + bassEnergy * 1.2;
      context.shadowBlur = glow;
      context.shadowColor = `hsla(${hue}, 95%, 70%, 0.8)`;
      context.stroke(path);

      context.save();
      context.globalCompositeOperation = "screen";
      const sparks = performanceMode ? 24 : 48;
      for (let i = 0; i < sparks; i++) {
        const t = i / sparks;
        const sparkRadius = (0.1 + t * 1.1) * maxRadius;
        const theta = spinNoise(t * loops + arm * 1.2 + currentTime * 0.6);
        const sparkX = Math.cos(theta) * sparkRadius;
        const sparkY = Math.sin(theta) * sparkRadius;
        const pulse = 0.3 + Math.sin(currentTime * 2.8 + i) * 0.5;
        context.beginPath();
        context.arc(sparkX, sparkY, 1.4 + pulse * 2.8, 0, Math.PI * 2);
        context.fillStyle = `hsla(${hue + t * 30}, 95%, 68%, ${
          0.18 + pulse * 0.25
        })`;
        context.fill();
      }
      context.restore();
    }

    context.globalCompositeOperation = "screen";
    const core = context.createRadialGradient(0, 0, 0, 0, 0, maxRadius * 0.42);
    core.addColorStop(
      0,
      `hsla(${140 + bassEnergy * 90}, 96%, 74%, ${0.35 + totalEnergy * 0.4})`
    );
    core.addColorStop(1, "rgba(0,0,0,0)");
    context.fillStyle = core;
    context.beginPath();
    context.arc(0, 0, maxRadius * (0.38 + totalEnergy * 0.2), 0, Math.PI * 2);
    context.fill();
    context.globalCompositeOperation = "source-over";

    context.restore();
  } else if (visualizerType === "super-time-ribbon") {
    const totalWindowSeconds = PAST_WINDOW_SECONDS + FUTURE_WINDOW_SECONDS;
    const baseY = height - 24;
    const ribbonHeight = height - 40;

    if (!amplitudeEnvelope || !amplitudeEnvelope.length) {
      context.fillStyle = "#ccc";
      context.font = "12px sans-serif";
      context.fillText(
        "Analyzing track envelope for ribbon view...",
        10,
        baseY
      );
      return;
    }

    const amplitudeAtTime = (time: number) => {
      const index = time / AMPLITUDE_WINDOW_SECONDS;
      const baseIndex = Math.floor(index);
      const nextIndex = Math.min(baseIndex + 1, amplitudeEnvelope.length - 1);
      const fraction = index - baseIndex;
      const first =
        amplitudeEnvelope[
          Math.max(0, Math.min(baseIndex, amplitudeEnvelope.length - 1))
        ] ?? 0;
      const second = amplitudeEnvelope[nextIndex] ?? first;
      return first + (second - first) * fraction;
    };

    const centerX = (PAST_WINDOW_SECONDS / totalWindowSeconds) * width;
    const frequencyBins = analyser.frequencyBinCount;
    const frequencyData = new Uint8Array(frequencyBins);
    const timeDomain = new Uint8Array(analyser.fftSize);

    analyser.getByteFrequencyData(frequencyData);
    analyser.getByteTimeDomainData(timeDomain);

    let peakIndex = 0;
    let peakValue = 0;

    for (let i = 0; i < frequencyBins; i++) {
      const binValue = frequencyData[i] ?? 0;

      if (binValue > peakValue) {
        peakValue = binValue;
        peakIndex = i;
      }
    }

    let rms = 0;
    for (let i = 0; i < timeDomain.length; i++) {
      const sample = ((timeDomain[i] ?? 128) - 128) / 128;
      rms += sample * sample;
    }
    rms = Math.sqrt(rms / timeDomain.length);

    const nyquist = sampleRate / 2;
    const dominantFrequency =
      frequencyBins > 0 ? (peakIndex / frequencyBins) * nyquist : 0;
    const hue = Math.max(0, Math.min(280, (dominantFrequency / 2000) * 280));
    const ribbonColor = `hsl(${hue}, 80%, 60%)`;
    const ribbonFillColor = `hsla(${hue}, 80%, 60%, 0.12)`;
    const shakeX = Math.sin(currentTime * 7.5) * rms * 18;
    const shakeY = Math.cos(currentTime * 6.3) * rms * 18;

    context.save();
    context.translate(shakeX, shakeY);
    context.fillStyle = "#070b14";
    context.fillRect(
      -Math.abs(shakeX),
      -Math.abs(shakeY),
      width + Math.abs(shakeX) * 2,
      height + Math.abs(shakeY) * 2
    );

    context.strokeStyle = "rgba(255, 255, 255, 0.08)";
    context.lineWidth = 1;
    const subtleGap = 48;
    for (let x = 0; x < width; x += subtleGap) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, height);
      context.stroke();
    }

    context.beginPath();

    for (let x = 0; x <= width; x += 2) {
      const timeOffset = (x / width) * totalWindowSeconds - PAST_WINDOW_SECONDS;
      const sampleTime = currentTime + timeOffset;
      const amplitude =
        sampleTime >= 0 ? amplitudeAtTime(sampleTime) : amplitudeAtTime(0);
      const normalized = Math.min(1, amplitude / amplitudeMaximum);
      const y = baseY - normalized * ribbonHeight;

      if (x === 0) {
        context.moveTo(x, y);
      } else {
        context.lineTo(x, y);
      }
    }

    context.strokeStyle = ribbonColor;
    context.lineWidth = 3;
    context.stroke();

    context.lineTo(width, baseY);
    context.lineTo(0, baseY);
    context.closePath();
    context.fillStyle = ribbonFillColor;
    context.fill();

    context.strokeStyle = "rgba(255, 255, 255, 0.65)";
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(centerX, 0);
    context.lineTo(centerX, height);
    context.stroke();
    context.restore();
  } else if (visualizerType === "prismatic-turbine") {
    const bufferLength = analyser.frequencyBinCount;
    const frequencyData = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(frequencyData);

    const energy =
      bufferLength > 0
        ? frequencyData.reduce((sum, value) => sum + value, 0) /
          (bufferLength * 255)
        : 0;

    const centerX = width / 2;
    const centerY = height / 2;
    const detailScale = performanceMode ? 0.65 : 1;
    const slices = Math.max(8, Math.floor(14 * detailScale));
    const sweep = (Math.PI * 2) / slices;
    const maxRadius = Math.sqrt(width * width + height * height) / 2;
    const pulse =
      1 +
      Math.sin(currentTime * 2.2) * 0.08 +
      energy * (performanceMode ? 0.28 : 0.4);

    const bg = context.createRadialGradient(
      centerX,
      centerY,
      0,
      centerX,
      centerY,
      maxRadius
    );
    bg.addColorStop(0, "#090916");
    bg.addColorStop(1, "#04050a");
    context.fillStyle = bg;
    context.fillRect(0, 0, width, height);

    context.save();
    context.translate(centerX, centerY);
    context.rotate(Math.sin(currentTime * 0.4) * 0.2);
    for (let sliceIndex = 0; sliceIndex < slices; sliceIndex++) {
      context.save();
      context.rotate(sliceIndex * sweep + currentTime * 0.25 + energy * 0.4);
      context.beginPath();
      context.moveTo(0, 0);
      for (let i = 0; i < bufferLength; i += performanceMode ? 4 : 2) {
        const magnitude = (frequencyData[i] ?? 0) / 255;
        const radialPulse =
          (performanceMode ? 0.7 : 0.8) +
          Math.sin(currentTime * 1.6 + i * 0.02) * 0.15 +
          energy * (performanceMode ? 0.35 : 0.5);
        const radius = magnitude * maxRadius * pulse * radialPulse;
        const angle = (i / bufferLength) * sweep * 1.6;
        const xPos = Math.cos(angle) * radius;
        const yPos = Math.sin(angle) * radius;
        context.lineTo(xPos, yPos);
      }
      context.closePath();
      const hue = (sliceIndex * 36 + currentTime * 120 + energy * 200) % 360;
      context.fillStyle = `hsla(${hue}, 85%, 62%, 0.14)`;
      context.strokeStyle = `hsla(${hue}, 95%, 70%, ${0.45 + energy * 0.35})`;
      context.lineWidth = 1.9;
      context.globalCompositeOperation = "lighter";
      context.fill();
      context.stroke();

      context.scale(-1, 1);
      context.rotate(Math.sin(currentTime * 0.8 + energy) * 0.5);
      context.fill();
      context.stroke();
      context.globalCompositeOperation = "source-over";
      context.restore();
    }

    context.globalCompositeOperation = "screen";
    const tileSize = Math.max(width, height) / (performanceMode ? 4.5 : 6);
    for (let yTile = -1; yTile < height / tileSize + 1; yTile++) {
      for (let xTile = -1; xTile < width / tileSize + 1; xTile++) {
        const offset = Math.sin(currentTime + xTile + yTile) * tileSize * 0.2;
        context.save();
        context.translate(xTile * tileSize + offset, yTile * tileSize - offset);
        context.rotate(((xTile + yTile) % 2 === 0 ? 1 : -1) * (Math.PI / 4));
        const tileHue =
          (energy * 220 + (xTile + yTile) * 14 + currentTime * 60) % 360;
        context.strokeStyle = `hsla(${tileHue}, 90%, 70%, 0.18)`;
        context.lineWidth = performanceMode ? 1.5 : 2;
        context.beginPath();
        context.moveTo(-tileSize, 0);
        context.lineTo(0, tileSize);
        context.lineTo(tileSize, 0);
        context.lineTo(0, -tileSize);
        context.closePath();
        context.stroke();
        context.restore();
      }
    }
    context.globalCompositeOperation = "source-over";
    context.restore();
  } else if (visualizerType === "kaleidoscope") {
    let cached = kaleidoscopeStateMap.get(canvas);

    if (!cached || cached.width !== width || cached.height !== height) {
      if (cached?.onMouseMove) {
        window.removeEventListener("mousemove", cached.onMouseMove, false);
      }
      const radius = 1100;
      const slices = 24;
      const zoom = 1.5;
      const randomOffsetX = (Math.random() * 2 - 1) * radius * 0.6;
      const randomOffsetY = (Math.random() * 2 - 1) * radius * 0.6;

      const image = new Image();
      image.crossOrigin = "Anonymous";
      image.src =
        "https://images.unsplash.com/photo-1473951574080-01fe45ec8643?q=80&w=2104&auto=format&fit=crop&ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D";

      const state: KaleidoscopeState = {
        width,
        height,
        radius,
        slices,
        zoom,
        offsetRotation: 0,
        offsetScale: 0.8,
        offsetX: randomOffsetX,
        offsetY: randomOffsetY,
        targetX: randomOffsetX,
        targetY: randomOffsetY,
        rotationTarget: 0,
        rotationSpeed: 0.002,
        lastTime: currentTime,
        image,
        pattern: null,
      };

      const handleMouseMove = (event: MouseEvent) => {
        const dx = event.pageX / Math.max(1, width);
        const dy = event.pageY / Math.max(1, height);
        const hx = dx - 0.1;
        const hy = dy - 0.1;
        state.targetX = hx * state.radius * -0.8;
        state.targetY = hy * state.radius * 0.8;
      };

      state.onMouseMove = handleMouseMove;
      window.addEventListener("mousemove", handleMouseMove, false);

      image.onload = () => {
        state.pattern = context.createPattern(image, "repeat");
      };

      kaleidoscopeStateMap.set(canvas, state);
      cached = state;
    }

    if (cached) {
      if (
        !cached.pattern ||
        cached.image.width === 0 ||
        cached.image.height === 0
      ) {
        context.fillStyle = "#000";
        context.fillRect(0, 0, width, height);
        return;
      }

      let energy = 0;

      if (amplitudeEnvelope && amplitudeEnvelope.length) {
        const halfWindow = KALEIDOSCOPE_ENERGY_WINDOW_SECONDS / 2;
        const startIndex = Math.max(
          0,
          Math.floor((currentTime - halfWindow) / AMPLITUDE_WINDOW_SECONDS)
        );
        const endIndex = Math.min(
          amplitudeEnvelope.length - 1,
          Math.ceil((currentTime + halfWindow) / AMPLITUDE_WINDOW_SECONDS)
        );
        let sum = 0;
        let count = 0;
        for (let i = startIndex; i <= endIndex; i++) {
          sum += amplitudeEnvelope[i] ?? 0;
          count += 1;
        }
        const amplitude = count > 0 ? sum / count : 0;
        energy = amplitudeMaximum > 0 ? amplitude / amplitudeMaximum : 0;
      } else {
        const bufferLength = analyser.frequencyBinCount;
        const frequencyData = new Uint8Array(bufferLength);
        analyser.getByteFrequencyData(frequencyData);

        if (bufferLength > 0) {
          let sum = 0;
          for (let i = 0; i < bufferLength; i++) {
            sum += frequencyData[i] ?? 0;
          }
          energy = sum / (bufferLength * 255);
        }
      }

      const deltaTime = Math.max(0, currentTime - cached.lastTime);
      cached.lastTime = currentTime;
      const clampedVolume = Math.max(0, Math.min(1, effectiveVolume));
      energy *= clampedVolume;
      if (
        !isPlaying ||
        deltaTime === 0 ||
        !Number.isFinite(energy) ||
        clampedVolume === 0
      ) {
        energy = 0;
      }
      const clampedEnergy = Math.max(
        0,
        Math.min(KALEIDOSCOPE_ENERGY_CAP, energy / 25)
      );
      const weightedDeltaTime = Math.min(1, deltaTime * clampedEnergy);
      cached.rotationTarget -= cached.rotationSpeed * weightedDeltaTime * 60;

      const ease = clampedEnergy * KALEIDOSCOPE_EASE;

      cached.offsetX += (cached.targetX - cached.offsetX) * ease;
      cached.offsetY += (cached.targetY - cached.offsetY) * ease;
      cached.offsetRotation +=
        (cached.rotationTarget - cached.offsetRotation) * ease;

      const cx = cached.image.width / 2;
      const scale =
        cached.zoom *
        (cached.radius / Math.min(cached.image.width, cached.image.height));
      const step = TWO_PI / cached.slices;

      context.save();
      context.clearRect(0, 0, width, height);
      context.fillStyle = cached.pattern ?? "#000";

      for (let i = 0; i <= cached.slices; i++) {
        context.save();
        context.translate(width / 2, height / 2);
        context.rotate(i * step);
        context.beginPath();
        context.moveTo(-0.5, -0.5);
        context.arc(0, 0, cached.radius, step * -0.51, step * 0.51);
        context.rotate(HALF_PI);
        context.scale(scale, scale);
        context.scale(i % 2 === 0 ? 1 : -1, 1);
        context.translate(cached.offsetX - cx, cached.offsetY);
        context.rotate(cached.offsetRotation);
        context.scale(cached.offsetScale, cached.offsetScale);
        context.fill();
        context.restore();
      }
      context.restore();
    }
  } else if (visualizerType === "highway") {
    const highwayState =
      highwayStateMap.get(canvas) ??
      (() => {
        const initialState = {
          lastTime: 0,
          speed: 1,
          seedOffset: Math.floor(Math.random() * 100000),
          stripeOffset: 0,
          cacti: new Map<
            number,
            { progress: number; side: number; speedBias: number }
          >(),
          spawns: new Map<
            number,
            { nextTime: number; seed: number; rng: number; sideSpeed: number }
          >(),
        };
        highwayStateMap.set(canvas, initialState);
        return initialState;
      })();
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(dataArray);
    const slice = Math.max(1, Math.floor(bufferLength * 0.15));
    const midSlice = Math.max(slice + 1, Math.floor(bufferLength * 0.5));
    const averageRange = (start: number, end: number) => {
      let sum = 0;
      for (let i = start; i < end; i++) {
        sum += dataArray[i] ?? 0;
      }
      return end > start ? sum / (end - start) / 255 : 0;
    };
    const bassEnergy = averageRange(0, slice);
    const midEnergy = averageRange(slice, midSlice);
    const highEnergy = averageRange(midSlice, bufferLength);
    const totalEnergy = (bassEnergy + midEnergy + highEnergy) / 3;
    const deltaTime = Math.max(0, currentTime - highwayState.lastTime);
    if (currentTime < highwayState.lastTime) {
      highwayState.cacti.clear();
      highwayState.spawns.clear();
      highwayState.speed = 1;
      highwayState.stripeOffset = 0;
    }
    highwayState.lastTime = currentTime;
    const evolveProgress = Math.min(1, currentTime / 18);
    const energyBoost = 0.35 + totalEnergy * 0.5;
    const evolution = (0.18 + evolveProgress * 0.82) * energyBoost;

    const hashFloat = (seed: number) => {
      const x = Math.sin(seed * 91.123 + seed * seed * 0.017) * 10000;
      return x - Math.floor(x);
    };
    const lerp = (start: number, end: number, t: number) =>
      start + (end - start) * t;
    const blendHue = (from: number, to: number, t: number) => {
      const delta = ((to - from + 540) % 360) - 180;
      return (from + delta * t + 360) % 360;
    };
    const minShift = 6;
    const maxShift = 9;
    const baseWindow = 8;
    const segmentIndex = Math.floor(currentTime / baseWindow);
    const segmentSeed = segmentIndex + 1;
    const segmentDuration = lerp(
      minShift,
      maxShift,
      hashFloat(segmentSeed * 11.3)
    );
    const segmentProgress = Math.min(
      1,
      (currentTime - segmentIndex * baseWindow) / segmentDuration
    );
    const snapChance = hashFloat(segmentSeed * 9.1);
    const snapMix = snapChance > 0.86;
    const easedProgress = snapMix
      ? segmentProgress > 0.92
        ? 1
        : segmentProgress * 0.85
      : segmentProgress * segmentProgress * (3 - 2 * segmentProgress);
    const pickHue = (seed: number) => {
      const selector = hashFloat(seed * 3.3);
      if (selector < 0.6) {
        const redPick = hashFloat(seed * 5.1);
        return redPick < 0.5
          ? lerp(330, 360, redPick * 2)
          : lerp(0, 30, (redPick - 0.5) * 2);
      }
      return lerp(200, 260, hashFloat(seed * 7.7));
    };
    const baseTargetA = pickHue(segmentSeed * 2.7);
    const baseTargetB = pickHue((segmentSeed + 1) * 2.7);
    const accentTargetA = pickHue(segmentSeed * 5.4);
    const accentTargetB = pickHue((segmentSeed + 1) * 5.4);
    const originalBaseTargetA =
      (190 + hashFloat(segmentSeed * 2.7) * 140) % 360;
    const originalBaseTargetB =
      (190 + hashFloat((segmentSeed + 1) * 2.7) * 140) % 360;
    const originalAccentTargetA =
      (20 + hashFloat(segmentSeed * 5.4) * 120) % 360;
    const originalAccentTargetB =
      (20 + hashFloat((segmentSeed + 1) * 5.4) * 120) % 360;
    const hueWobble = Math.sin(currentTime * 0.25 + segmentSeed) * 6;
    const psychedelicMix = Math.min(1, currentTime / 20);
    const baseHue =
      blendHue(
        blendHue(originalBaseTargetA, originalBaseTargetB, easedProgress),
        blendHue(baseTargetA, baseTargetB, easedProgress),
        psychedelicMix
      ) + hueWobble;
    const accentHue =
      blendHue(
        blendHue(originalAccentTargetA, originalAccentTargetB, easedProgress),
        blendHue(accentTargetA, accentTargetB, easedProgress),
        psychedelicMix
      ) +
      hueWobble * 0.6;
    const saturationLift =
      (10 + hashFloat(segmentSeed * 7.7) * 12) * (1 - psychedelicMix) +
      (18 + hashFloat(segmentSeed * 7.7) * 18) * psychedelicMix;
    const lightnessLift =
      (6 + hashFloat(segmentSeed * 8.8) * 6) * (1 - psychedelicMix) +
      (8 + hashFloat(segmentSeed * 8.8) * 10) * psychedelicMix;
    const speedTarget = 0.85 + totalEnergy * 0.6;
    highwayState.speed = lerp(highwayState.speed, speedTarget, 0.04);
    const stripeSpeed = (1.1 + totalEnergy * 0.6) * highwayState.speed;
    highwayState.stripeOffset =
      (highwayState.stripeOffset + deltaTime * stripeSpeed) % 1;

    const hexToRgb = (hex: string) => {
      const value = hex.replace("#", "");
      const r = Number.parseInt(value.slice(0, 2), 16);
      const g = Number.parseInt(value.slice(2, 4), 16);
      const b = Number.parseInt(value.slice(4, 6), 16);
      return { r, g, b };
    };
    const hslToRgb = (hue: number, saturation: number, lightness: number) => {
      const h = ((hue % 360) + 360) % 360;
      const s = Math.max(0, Math.min(1, saturation / 100));
      const l = Math.max(0, Math.min(1, lightness / 100));
      const c = (1 - Math.abs(2 * l - 1)) * s;
      const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
      const m = l - c / 2;
      let r = 0;
      let g = 0;
      let b = 0;
      if (h < 60) {
        r = c;
        g = x;
      } else if (h < 120) {
        r = x;
        g = c;
      } else if (h < 180) {
        g = c;
        b = x;
      } else if (h < 240) {
        g = x;
        b = c;
      } else if (h < 300) {
        r = x;
        b = c;
      } else {
        r = c;
        b = x;
      }
      return {
        r: Math.round((r + m) * 255),
        g: Math.round((g + m) * 255),
        b: Math.round((b + m) * 255),
      };
    };
    const mixColor = (
      fromHex: string,
      toRgb: { r: number; g: number; b: number },
      t: number
    ) => {
      const from = hexToRgb(fromHex);
      const mix = (a: number, b: number) => Math.round(a + (b - a) * t);
      return `rgb(${mix(from.r, toRgb.r)}, ${mix(from.g, toRgb.g)}, ${mix(
        from.b,
        toRgb.b
      )})`;
    };

    const horizon = height * 0.52;
    const skyGradient = context.createLinearGradient(0, 0, 0, horizon);
    skyGradient.addColorStop(
      0,
      mixColor(
        "#2f7dac",
        hslToRgb(
          baseHue,
          82 + saturationLift,
          46 + lightnessLift + highEnergy * 10
        ),
        evolution * 0.9
      )
    );
    skyGradient.addColorStop(
      1,
      mixColor(
        "#1b5f8b",
        hslToRgb(
          (baseHue + 20) % 360,
          78 + saturationLift,
          34 + lightnessLift + midEnergy * 8
        ),
        evolution * 0.9
      )
    );
    context.fillStyle = skyGradient;
    context.fillRect(0, 0, width, horizon);

    const sunCenterX = width * 0.5;
    const sunCenterY = horizon + height * 0.02;
    const sunRadius = Math.min(width, height) * 0.7;
    const sunBands = [
      mixColor(
        "#f4c255",
        hslToRgb((accentHue + 8) % 360, 92, 66 + bassEnergy * 8),
        evolution * 0.88
      ),
      mixColor(
        "#e79a38",
        hslToRgb((accentHue + 16) % 360, 92, 58 + bassEnergy * 6),
        evolution * 0.88
      ),
      mixColor(
        "#d46d2b",
        hslToRgb((accentHue + 28) % 360, 92, 52 + bassEnergy * 5),
        evolution * 0.88
      ),
      mixColor(
        "#c95a24",
        hslToRgb((accentHue + 40) % 360, 92, 46 + bassEnergy * 4),
        evolution * 0.88
      ),
    ];
    context.fillStyle = mixColor(
      "#f4c255",
      hslToRgb(accentHue, 94, 64 + bassEnergy * 10),
      evolution
    );
    context.beginPath();
    context.arc(
      sunCenterX,
      sunCenterY,
      sunRadius * 0.64,
      Math.PI * 1.08,
      Math.PI * 1.92
    );
    context.lineTo(sunCenterX + sunRadius * 0.64, sunCenterY);
    context.closePath();
    context.fill();
    sunBands.forEach((color, index) => {
      const radius = sunRadius - index * sunRadius * 0.15;
      context.beginPath();
      context.strokeStyle = color;
      context.lineWidth = Math.max(28, sunRadius * 0.11);
      context.lineCap = "round";
      context.arc(
        sunCenterX,
        sunCenterY,
        radius,
        Math.PI * 1.06,
        Math.PI * 1.94
      );
      context.stroke();
    });

    const drawCloud = (x: number, y: number, scale: number, tint: string) => {
      context.fillStyle = tint;
      context.beginPath();
      context.ellipse(x, y, 70 * scale, 40 * scale, 0, 0, Math.PI * 2);
      context.ellipse(
        x - 55 * scale,
        y + 6 * scale,
        45 * scale,
        28 * scale,
        0,
        0,
        Math.PI * 2
      );
      context.ellipse(
        x + 55 * scale,
        y + 4 * scale,
        50 * scale,
        32 * scale,
        0,
        0,
        Math.PI * 2
      );
      context.ellipse(
        x - 8 * scale,
        y - 28 * scale,
        60 * scale,
        38 * scale,
        0,
        0,
        Math.PI * 2
      );
      context.fill();
      context.strokeStyle = "rgba(20, 20, 20, 0.16)";
      context.lineWidth = 2;
      context.stroke();
    };
    drawCloud(
      width * 0.18,
      height * 0.24,
      0.4,
      mixColor(
        "#f7f3ea",
        hslToRgb((baseHue + 12) % 360, 34, 90),
        evolution * 0.6
      )
    );
    drawCloud(
      width * 0.28,
      height * 0.34,
      0.32,
      mixColor(
        "#f2eee5",
        hslToRgb((baseHue + 20) % 360, 34, 86),
        evolution * 0.6
      )
    );
    drawCloud(
      width * 0.82,
      height * 0.26,
      0.46,
      mixColor(
        "#f7f1e7",
        hslToRgb((baseHue + 10) % 360, 36, 88),
        evolution * 0.6
      )
    );

    const horizonBandHeight = height * 0.04;
    context.fillStyle = mixColor(
      "#e1b93f",
      hslToRgb((accentHue + 220) % 360, 80, 52 + midEnergy * 10),
      evolution * 0.9 * psychedelicMix
    );
    context.fillRect(0, horizon - horizonBandHeight, width, horizonBandHeight);

    const fieldBands = [
      mixColor(
        "#e8c56f",
        hslToRgb((baseHue + 6) % 360, 78, 32 + bassEnergy * 10),
        evolution * psychedelicMix
      ),
      mixColor(
        "#e0bc64",
        hslToRgb((baseHue + 12) % 360, 76, 30 + midEnergy * 10),
        evolution * psychedelicMix
      ),
      mixColor(
        "#3b8b3d",
        hslToRgb((baseHue + 18) % 360, 80, 34 + highEnergy * 10),
        evolution * 0.95 * psychedelicMix
      ),
      mixColor(
        "#e2c06a",
        hslToRgb((baseHue + 24) % 360, 74, 28 + midEnergy * 10),
        evolution * psychedelicMix
      ),
      mixColor(
        "#d8b75f",
        hslToRgb((baseHue + 30) % 360, 82, 32 + bassEnergy * 10),
        evolution * psychedelicMix
      ),
      mixColor(
        "#e8c56f",
        hslToRgb((baseHue + 36) % 360, 78, 36 + totalEnergy * 10),
        evolution * psychedelicMix
      ),
    ];
    const fieldTop = horizon;
    const fieldHeight = height - fieldTop;
    const bandHeight = fieldHeight / fieldBands.length;
    fieldBands.forEach((color, index) => {
      context.fillStyle = color;
      context.fillRect(0, fieldTop + index * bandHeight, width, bandHeight);
    });

    const roadBottom = width * 0.64;
    const roadTop = width * 0.12;
    context.fillStyle = mixColor(
      "#1b1b1c",
      hslToRgb((baseHue + 200) % 360, 20, 18 + highEnergy * 10),
      evolution * 0.75
    );
    context.beginPath();
    context.moveTo(width / 2 - roadBottom, height);
    context.lineTo(width / 2 + roadBottom, height);
    context.lineTo(width / 2 + roadTop, horizon - horizonBandHeight * 0.2);
    context.lineTo(width / 2 - roadTop, horizon - horizonBandHeight * 0.2);
    context.closePath();
    context.fill();

    context.strokeStyle = "#f4f4f4";
    context.lineWidth = 6;
    context.beginPath();
    context.moveTo(width / 2 - roadTop, horizon - horizonBandHeight * 0.2);
    context.lineTo(width / 2 - roadBottom, height);
    context.stroke();
    context.beginPath();
    context.moveTo(width / 2 + roadTop, horizon - horizonBandHeight * 0.2);
    context.lineTo(width / 2 + roadBottom, height);
    context.stroke();

    const dashCount = 2;
    const dashLength = 0.25;
    const drawCenterDash = (tStart: number, tEnd: number) => {
      const dashYStart = horizon + tStart * fieldHeight;
      const dashYEnd = horizon + tEnd * fieldHeight;
      const dashWidthStart = 4 + tStart * 10;
      const dashWidthEnd = 4 + tEnd * 10;
      context.fillStyle = "#f4f4f4";
      context.beginPath();
      context.moveTo(width / 2 - dashWidthStart / 2, dashYStart);
      context.lineTo(width / 2 + dashWidthStart / 2, dashYStart);
      context.lineTo(width / 2 + dashWidthEnd / 2, dashYEnd);
      context.lineTo(width / 2 - dashWidthEnd / 2, dashYEnd);
      context.closePath();
      context.fill();
    };
    for (let i = 0; i < dashCount; i++) {
      const tStart = (i / dashCount + highwayState.stripeOffset) % 1;
      const tEnd = tStart + dashLength;
      if (tEnd <= 1) {
        drawCenterDash(tStart, tEnd);
      } else {
        drawCenterDash(tStart, 1);
        drawCenterDash(0, tEnd - 1);
      }
    }

    const stripeColors = [
      mixColor(
        "#e6c46b",
        hslToRgb((accentHue + 10) % 360, 84, 62 + bassEnergy * 12),
        evolution * psychedelicMix
      ),
      mixColor(
        "#d9b75f",
        hslToRgb((accentHue + 20) % 360, 82, 58 + midEnergy * 12),
        evolution * psychedelicMix
      ),
      mixColor(
        "#cfae56",
        hslToRgb((accentHue + 30) % 360, 86, 54 + highEnergy * 12),
        evolution * psychedelicMix
      ),
      mixColor(
        "#b3a056",
        hslToRgb((accentHue + 40) % 360, 88, 60 + totalEnergy * 12),
        evolution * psychedelicMix
      ),
    ];
    const stripeCount = 3;
    const stripeLength = 0.14;
    const drawStripeSegment = (
      tStart: number,
      tEnd: number,
      colorIndex: number
    ) => {
      const stripeYStart = horizon + tStart * fieldHeight;
      const stripeYEnd = horizon + tEnd * fieldHeight;
      const stripeWidthStart = roadTop + (roadBottom - roadTop) * tStart;
      const stripeWidthEnd = roadTop + (roadBottom - roadTop) * tEnd;
      const stripePaddingStart = 16 + tStart * 28;
      const stripePaddingEnd = 16 + tEnd * 28;
      const stripeAlpha = 0.2 + tStart * 0.7;
      context.strokeStyle =
        stripeColors[colorIndex % stripeColors.length] ?? "#e88f3b";
      context.lineWidth = 4 + tStart * 3;
      context.globalAlpha = stripeAlpha;
      context.beginPath();
      context.moveTo(
        width / 2 - stripeWidthStart - stripePaddingStart,
        stripeYStart
      );
      context.lineTo(width / 2 - stripeWidthEnd - stripePaddingEnd, stripeYEnd);
      context.stroke();
      context.beginPath();
      context.moveTo(
        width / 2 + stripeWidthStart + stripePaddingStart,
        stripeYStart
      );
      context.lineTo(width / 2 + stripeWidthEnd + stripePaddingEnd, stripeYEnd);
      context.stroke();
    };
    for (let i = 0; i < stripeCount; i++) {
      const tStart = i / (stripeCount - 1);
      const tEnd = tStart + stripeLength;
      if (tEnd <= 1) {
        drawStripeSegment(tStart, tEnd, i);
      } else {
        drawStripeSegment(tStart, 1, i);
        drawStripeSegment(0, tEnd - 1, i);
      }
    }
    context.globalAlpha = 1;

    const drawCactus = (t: number, side: number, seed: number) => {
      const roadWidth = roadTop + (roadBottom - roadTop) * t;
      const baseY = horizon + t * fieldHeight + 4;
      const margin = 26 + t * 44;
      const sway = Math.sin(currentTime * 1.6 + seed * 2.1) * (1 + t * 1.2);
      const x = width / 2 + side * (roadWidth + margin) + sway;
      const scale = 0.2 + t * 1.15;
      const bodyHeight = 90 * scale;
      const bodyWidth = 22 * scale;
      const armHeight = 40 * scale;
      const armWidth = 10 * scale;
      const armOffset = 24 * scale;
      context.save();
      context.globalAlpha = 1;
      context.fillStyle = "#1fa84e";
      context.strokeStyle = "rgba(8, 60, 24, 0.75)";
      context.lineWidth = Math.max(2, 3 * scale);
      context.fillRect(
        x - bodyWidth / 2,
        baseY - bodyHeight,
        bodyWidth,
        bodyHeight
      );
      context.fillRect(
        x - bodyWidth / 2 - armOffset,
        baseY - bodyHeight * 0.7,
        armWidth,
        armHeight
      );
      context.fillRect(
        x + bodyWidth / 2 + armOffset - armWidth,
        baseY - bodyHeight * 0.62,
        armWidth,
        armHeight
      );
      context.beginPath();
      context.moveTo(x - bodyWidth / 2, baseY - bodyHeight);
      context.lineTo(x - bodyWidth / 2, baseY);
      context.lineTo(x + bodyWidth / 2, baseY);
      context.lineTo(x + bodyWidth / 2, baseY - bodyHeight);
      context.stroke();
      context.restore();
    };

    const cactusInterval = 7.2;
    highwayState.cacti.forEach((cactus) => {
      const perspectiveSpeed = (1 + cactus.progress) ** 3;
      cactus.progress +=
        (deltaTime * highwayState.speed * cactus.speedBias * perspectiveSpeed) /
        cactusInterval;
    });
    highwayState.cacti.forEach((cactus, seed) => {
      if (cactus.progress > 1.1) {
        highwayState.cacti.delete(seed);
      }
    });
    const nextRandom = (state: { rng: number }) => {
      state.rng = (state.rng * 1664525 + 1013904223) % 4294967296;
      return state.rng / 4294967296;
    };
    const spawnCactiForSide = (side: number) => {
      const spawnState = highwayState.spawns.get(side);
      if (!spawnState) {
        const baseSeed =
          Math.floor(
            hashFloat(
              (currentTime + 11.3 + highwayState.seedOffset) * 1.7 + side * 91.7
            ) * 100000
          ) + 1;
        const seed = baseSeed * 10 + (side > 0 ? 1 : 2);
        const rngSeed = Math.floor(
          hashFloat(seed * 13.1 + side * 77.3) * 4294967296
        );
        const sideSpeed = lerp(0.92, 1.08, hashFloat(seed * 3.7 + side * 19.1));
        const initialState = { rng: rngSeed };
        const gap = lerp(3.6, 9.8, nextRandom(initialState));
        highwayState.spawns.set(side, {
          nextTime: currentTime + gap,
          seed,
          rng: initialState.rng,
          sideSpeed,
        });
        return;
      }
      let loops = 0;
      while (currentTime >= spawnState.nextTime && loops < 3) {
        const seed = spawnState.seed;
        if (!highwayState.cacti.has(seed)) {
          const perCactusBias = lerp(
            0.94,
            1.06,
            hashFloat(seed * 2.3 + side * 7.1)
          );
          const speedBias = spawnState.sideSpeed * perCactusBias;
          highwayState.cacti.set(seed, { progress: 0, side, speedBias });
        }
        spawnState.seed += 1;
        const gap = lerp(3.6, 9.8, nextRandom(spawnState));
        spawnState.nextTime += gap;
        loops += 1;
      }
    };
    spawnCactiForSide(-1);
    spawnCactiForSide(1);
    highwayState.cacti.forEach((cactus, seed) => {
      drawCactus(cactus.progress, cactus.side, seed);
    });
  } else if (visualizerType === "delay-pedal") {
    const bufferLength = analyser.fftSize;
    const timeData = new Uint8Array(bufferLength);
    analyser.getByteTimeDomainData(timeData);

    context.fillStyle = "#06060c";
    context.fillRect(0, 0, width, height);

    const rows = 16;
    const cols = 24;
    const cellWidth = width / cols;
    const cellHeight = height / rows;

    const trail = (index: number) => {
      const value = ((timeData[index] ?? 128) - 128) / 128;
      const glow = Math.abs(value);
      return {
        value,
        glow,
      };
    };

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const t = (row * cols + col) / (rows * cols);
        const dataIndex = Math.floor(t * (bufferLength - 1));
        const { value, glow } = trail(dataIndex);
        const x = col * cellWidth;
        const y = row * cellHeight;
        const hue = 250 + value * 80 + Math.sin(currentTime + t * 6) * 20;
        const alpha = 0.15 + glow * 0.5;
        context.fillStyle = `hsla(${hue}, 90%, ${40 + glow * 30}%, ${alpha})`;
        context.fillRect(x, y, cellWidth + 1, cellHeight + 1);
      }
    }

    // sweeping echo lines
    const sweepCount = 3;
    for (let s = 0; s < sweepCount; s++) {
      const offset = ((currentTime * 0.6 + s * 0.2) % 1) * width;
      context.beginPath();
      for (let i = 0; i < bufferLength; i += 8) {
        const v = ((timeData[i] ?? 128) - 128) / 128;
        const y = (i / bufferLength) * height;
        const x = (offset + v * 80) % width;
        if (i === 0) {
          context.moveTo(x, y);
        } else {
          context.lineTo(x, y);
        }
      }
      context.strokeStyle = `rgba(255, 255, 255, ${0.2 + s * 0.1})`;
      context.lineWidth = 1.6;
      context.shadowBlur = 14;
      context.shadowColor = "rgba(180, 200, 255, 0.6)";
      context.stroke();
    }

    context.shadowBlur = 0;
    const echoRings = 5;
    const centerX = width / 2;
    const centerY = height / 2;
    const maxRadius = Math.min(centerX, centerY);
    for (let ring = 0; ring < echoRings; ring++) {
      const t = ring / echoRings;
      const dataIndex = Math.floor(t * (bufferLength - 1));
      const level = ((timeData[dataIndex] ?? 128) - 128) / 128;
      const radius =
        maxRadius * (0.2 + t * 0.8) + Math.sin(currentTime * 1.8 - t * 2) * 8;
      const echo = 1 + Math.abs(level) * 0.8;
      context.beginPath();
      context.arc(centerX, centerY, radius * echo, 0, Math.PI * 2);
      context.strokeStyle = `hsla(${260 + t * 80}, 90%, ${60 + level * 10}%, ${
        0.25 + Math.abs(level) * 0.4
      })`;
      context.lineWidth = 2 + Math.abs(level) * 4;
      context.shadowBlur = 12 + Math.abs(level) * 14;
      context.shadowColor = `hsla(${260 + t * 80}, 90%, 70%, 0.6)`;
      context.stroke();
    }
  } else {
    const totalWindowSeconds = PAST_WINDOW_SECONDS + FUTURE_WINDOW_SECONDS;
    const baseY = height - 24;
    const ribbonHeight = height - 40;

    context.fillStyle = "#070b14";
    context.fillRect(0, 0, width, height);

    context.strokeStyle = "rgba(255, 255, 255, 0.08)";
    context.lineWidth = 1;
    const subtleGap = 48;
    for (let x = 0; x < width; x += subtleGap) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, height);
      context.stroke();
    }

    if (!amplitudeEnvelope || !amplitudeEnvelope.length) {
      context.fillStyle = "#ccc";
      context.font = "12px sans-serif";
      context.fillText(
        "Analyzing track envelope for ribbon view...",
        10,
        baseY
      );
      return;
    }

    const amplitudeAtTime = (time: number) => {
      const index = time / AMPLITUDE_WINDOW_SECONDS;
      const baseIndex = Math.floor(index);
      const nextIndex = Math.min(baseIndex + 1, amplitudeEnvelope.length - 1);
      const fraction = index - baseIndex;
      const first =
        amplitudeEnvelope[
          Math.max(0, Math.min(baseIndex, amplitudeEnvelope.length - 1))
        ] ?? 0;
      const second = amplitudeEnvelope[nextIndex] ?? first;
      return first + (second - first) * fraction;
    };

    const centerX = (PAST_WINDOW_SECONDS / totalWindowSeconds) * width;
    const frequencyBins = analyser.frequencyBinCount;
    const frequencyData = new Uint8Array(frequencyBins);

    analyser.getByteFrequencyData(frequencyData);

    let peakIndex = 0;
    let peakValue = 0;

    for (let i = 0; i < frequencyBins; i++) {
      const binValue = frequencyData[i] ?? 0;

      if (binValue > peakValue) {
        peakValue = binValue;
        peakIndex = i;
      }
    }

    const nyquist = sampleRate / 2;
    const dominantFrequency =
      frequencyBins > 0 ? (peakIndex / frequencyBins) * nyquist : 0;
    const hue = Math.max(0, Math.min(280, (dominantFrequency / 2000) * 280));
    const ribbonColor = `hsl(${hue}, 80%, 60%)`;
    const ribbonFillColor = `hsla(${hue}, 80%, 60%, 0.12)`;

    context.beginPath();

    for (let x = 0; x <= width; x += 2) {
      const timeOffset = (x / width) * totalWindowSeconds - PAST_WINDOW_SECONDS;
      const sampleTime = currentTime + timeOffset;
      const amplitude =
        sampleTime >= 0 ? amplitudeAtTime(sampleTime) : amplitudeAtTime(0);
      const normalized = Math.min(1, amplitude / amplitudeMaximum);
      const y = baseY - normalized * ribbonHeight;

      if (x === 0) {
        context.moveTo(x, y);
      } else {
        context.lineTo(x, y);
      }
    }

    context.strokeStyle = ribbonColor;
    context.lineWidth = 3;
    context.stroke();

    context.lineTo(width, baseY);
    context.lineTo(0, baseY);
    context.closePath();
    context.fillStyle = ribbonFillColor;
    context.fill();

    context.strokeStyle = "rgba(255, 255, 255, 0.65)";
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(centerX, 0);
    context.lineTo(centerX, height);
    context.stroke();
  }
}
