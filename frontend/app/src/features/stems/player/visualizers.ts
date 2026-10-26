import type { PitchTimeline } from './visuals/pitchTimeline';
import { drawPitchRibbon } from './visuals/pitchRibbon';
import { drawKaleidoscope, resetKaleidoscope } from './visuals/kaleidoscope';
import { seed } from './visuals/stemScene';
import { drawTimeRibbon, resetTimeRibbon, smoothRibbonColor } from './visuals/timeRibbon';
import { analysisBytes } from './visuals/analysis';
import { beginVisualizer, surfaceFor } from './visuals/canvas';
import {
  type VisualizerType,
} from "./types";

const cachedPerformanceMode = true;
function isLowPowerMode(): boolean {
  return cachedPerformanceMode;
}

export function resetVisualizerState(canvas: HTMLCanvasElement) {
  resetKaleidoscope(canvas);
  resetTimeRibbon(canvas);
}

export type VisualizerInputs = {
  analyser: AnalyserNode;
  canvas: HTMLCanvasElement;
  currentTime: number;
  duration: number;
  visualizerType: VisualizerType;
  isPlaying: boolean;
  amplitudeEnvelope?: number[];
  pitchTimeline?: PitchTimeline;
  pitchSemitones?: number;
  amplitudeMaximum?: number;
  effectiveVolume?: number;
  sampleRate: number;
};

function drawLegacyVisualizer({
  analyser,
  canvas,
  currentTime,
  visualizerType,
  isPlaying,
  sampleRate,
}: VisualizerInputs) {
  const context = canvas.getContext("2d");

  if (!context) {
    return;
  }

  const { width, height, background, font } = surfaceFor(canvas);
  const performanceMode = isLowPowerMode();
  context.clearRect(0, 0, width, height);

  context.fillStyle = background;
  context.fillRect(0, 0, width, height);

  if (visualizerType === "laser-ladders") {
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = analysisBytes(analyser, bufferLength);
    analyser.getByteFrequencyData(dataArray);
    const bars = Math.max(8, Math.min(64, Math.floor(width / 10)));
    const barWidth = width / bars;
    const gradient = context.createLinearGradient(0, height, 0, 0);
    gradient.addColorStop(0, '#1dd3b0'); gradient.addColorStop(1, '#6c43f3');
    context.fillStyle = gradient;
    for (let i = 0; i < bars; i++) {
      const from = Math.floor((Math.exp(i / bars * Math.log(bufferLength + 1)) - 1));
      const to = Math.min(bufferLength, Math.max(from + 1, Math.ceil(Math.exp((i + 1) / bars * Math.log(bufferLength + 1)) - 1)));
      let peak = 0;
      for (let bin = from; bin < to; bin++) peak = Math.max(peak, dataArray[bin]);
      const barHeight = peak / 255 * height * .95;
      context.fillRect(i * barWidth, height - barHeight, Math.max(1, barWidth - 2), barHeight);
    }
  } else if (visualizerType === "spectrum-safari") {
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = analysisBytes(analyser, bufferLength);
    analyser.getByteFrequencyData(dataArray);
    const sliceWidth = width / bufferLength;
    const hue = smoothRibbonColor(canvas, dataArray, sampleRate, currentTime, isPlaying);
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
    context.lineTo(width, height); context.lineTo(0, height); context.closePath();
    context.fillStyle = fillColor;
    context.fill();
  } else if (visualizerType === "waveform-waterline") {
    const bufferLength = analyser.fftSize;
    const dataArray = analysisBytes(analyser, bufferLength);
    analyser.getByteTimeDomainData(dataArray);

    context.fillStyle = background;
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
    const dataArray = analysisBytes(analyser, bufferLength);
    analyser.getByteFrequencyData(dataArray);

    context.fillStyle = background;
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
    const dataArray = analysisBytes(analyser, bufferLength);
    analyser.getByteFrequencyData(dataArray);

    context.fillStyle = background;
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
    const dataArray = analysisBytes(analyser, bufferLength);
    analyser.getByteFrequencyData(dataArray);

    context.fillStyle = background;
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
    const dataArray = analysisBytes(analyser, bufferLength);
    analyser.getByteFrequencyData(dataArray);

    const centerX = width / 2;
    const centerY = height / 2;
    const maxRadius = Math.min(width, height) / 2 - 12;

    context.fillStyle = background;
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
    const dataArray = analysisBytes(analyser, bufferLength);
    analyser.getByteFrequencyData(dataArray);

    context.fillStyle = background;
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
    const dataArray = analysisBytes(analyser, bufferLength);
    analyser.getByteFrequencyData(dataArray);

    context.fillStyle = background;
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
      const x = seed(i + 100) * width;
      const y = seed(i + 200) * height * 0.6;
      const size = seed(i + 300) * 2 + 0.5;
      context.beginPath();
      context.arc(x, y, size, 0, Math.PI * 2);
      context.fill();
    }
  } else if (visualizerType === "nebula-trails") {
    const bufferLength = analyser.fftSize;
    const dataArray = analysisBytes(analyser, bufferLength);
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
    const dataArray = analysisBytes(analyser, bufferLength);
    analyser.getByteFrequencyData(dataArray);

    context.fillStyle = background;
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
    const dataArray = analysisBytes(analyser, bufferLength);
    const waveformArray = analysisBytes(analyser, analyser.fftSize);
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
    const dataArray = analysisBytes(analyser, bufferLength);
    analyser.getByteFrequencyData(dataArray);

    context.fillStyle = background;
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
    context.font = font;
    context.fillText("Harmonic cavities", 10, 18);
  } else if (visualizerType === "opal-current") {
    const bufferLength = analyser.fftSize;
    const timeData = analysisBytes(analyser, bufferLength);
    analyser.getByteTimeDomainData(timeData);

    context.fillStyle = background;
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
    const dataArray = analysisBytes(analyser, bufferLength);
    analyser.getByteFrequencyData(dataArray);

    context.fillStyle = background;
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
    const timeData = analysisBytes(analyser, bufferLength);
    analyser.getByteTimeDomainData(timeData);

    context.fillStyle = background;
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
    const frequencyData = analysisBytes(analyser, frequencyBins);
    analyser.getByteFrequencyData(frequencyData);

    const timeBufferLength = analyser.fftSize;
    const timeDomainData = analysisBytes(analyser, timeBufferLength);
    analyser.getByteTimeDomainData(timeDomainData);

    context.fillStyle = background;
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
    const frequencyData = analysisBytes(analyser, freqLength);
    analyser.getByteFrequencyData(frequencyData);

    const timeLength = analyser.fftSize;
    const timeData = analysisBytes(analyser, timeLength);
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
      return seed * 2.399963 + currentTime * .18 + Math.sin(seed * 1.7 + currentTime * .35) * .45;
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
  } else if (visualizerType === "prismatic-turbine") {
    const bufferLength = analyser.frequencyBinCount;
    const frequencyData = analysisBytes(analyser, bufferLength);
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
  } else if (visualizerType === "delay-pedal") {
    const bufferLength = analyser.fftSize;
    const timeData = analysisBytes(analyser, bufferLength);
    analyser.getByteTimeDomainData(timeData);

    context.fillStyle = background;
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
  }
}

/** Isolate canvas state and draw existing artwork in logical CSS pixels on Retina. */
export function drawVisualizer(inputs: VisualizerInputs) {
  if (inputs.visualizerType === 'pitch-ribbon') { drawPitchRibbon(inputs); return; }
  if (inputs.visualizerType === 'kaleidoscope') { drawKaleidoscope(inputs); return; }
  if (inputs.visualizerType === 'time-ribbon' || inputs.visualizerType === 'super-time-ribbon') { drawTimeRibbon(inputs); return; }
  const view = beginVisualizer(inputs.canvas);
  if (!view) return;
  try { drawLegacyVisualizer(inputs); } finally { view.context.restore(); }
}
