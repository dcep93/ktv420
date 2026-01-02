import {
  AMPLITUDE_WINDOW_SECONDS,
  FUTURE_WINDOW_SECONDS,
  PAST_WINDOW_SECONDS,
  type VisualizerType,
} from "./types";

export type VisualizerInputs = {
  analyser: AnalyserNode;
  canvas: HTMLCanvasElement;
  audio: HTMLAudioElement;
  visualizerType: VisualizerType;
  amplitudeEnvelope?: number[];
  amplitudeMaximum?: number;
  sampleRate: number;
};

export function drawVisualizer({
  analyser,
  canvas,
  audio,
  visualizerType,
  amplitudeEnvelope,
  amplitudeMaximum = 1,
  sampleRate,
}: VisualizerInputs) {
  const context = canvas.getContext("2d");

  if (!context) {
    return;
  }

  const { width, height } = canvas;
  context.clearRect(0, 0, width, height);

  const timeDisplay = `${audio.currentTime.toFixed(2)}s / ${Math.max(
    audio.duration,
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
      const gradient = context.createLinearGradient(0, height, 0, height - barHeight);
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

    context.strokeStyle = "#f2b705";
    context.lineWidth = 2;
    context.stroke();
    context.fillStyle = "rgba(242, 183, 5, 0.15)";
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
      const angle = (i / bufferLength) * sweepAngle + audio.currentTime * 0.6;
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
      context.fillRect(leftX - barWidth, height - barHeight, barWidth, barHeight);
      context.fillRect(rightX, height - barHeight, barWidth, barHeight);
    }

    context.fillStyle = "rgba(255, 255, 255, 0.1)";
    context.fillRect(halfWidth - 1, 0, 2, height);
  } else if (visualizerType === "pulse-grid") {
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(dataArray);

    context.fillStyle = "#0a0d16";
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
        const hue = 180 + intensity * 120;
        const alpha = 0.15 + intensity * 0.6;
        context.fillStyle = `hsla(${hue}, 70%, ${50 + intensity * 20}%, ${alpha})`;
        const offsetY = Math.sin(audio.currentTime * 2 + col * 0.3) * 4;
        context.fillRect(
          col * cellWidth + 1,
          row * cellHeight + 1 + offsetY,
          cellWidth - 2,
          cellHeight - 2
        );
      }
    }

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
    context.rotate(audio.currentTime * 0.2);
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
  } else if (visualizerType === "nebula-trails") {
    const bufferLength = analyser.fftSize;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteTimeDomainData(dataArray);

    context.fillStyle = "rgba(6, 10, 20, 0.6)";
    context.fillRect(0, 0, width, height);

    const centerY = height / 2;
    const sliceWidth = width / bufferLength;
    const hueShift = (audio.currentTime * 40) % 360;

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
      context.fillText("Analyzing track envelope for ribbon view...", 10, baseY);
      return;
    }

    const amplitudeAtTime = (time: number) => {
      const index = time / AMPLITUDE_WINDOW_SECONDS;
      const baseIndex = Math.floor(index);
      const nextIndex = Math.min(baseIndex + 1, amplitudeEnvelope.length - 1);
      const fraction = index - baseIndex;
      const first = amplitudeEnvelope[Math.max(0, Math.min(baseIndex, amplitudeEnvelope.length - 1))] ?? 0;
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
    const dominantFrequency = frequencyBins > 0 ? (peakIndex / frequencyBins) * nyquist : 0;
    const hue = Math.max(0, Math.min(280, (dominantFrequency / 2000) * 280));
    const ribbonColor = `hsl(${hue}, 80%, 60%)`;
    const ribbonFillColor = `hsla(${hue}, 80%, 60%, 0.12)`;

    context.beginPath();

    for (let x = 0; x <= width; x += 2) {
      const timeOffset = (x / width) * totalWindowSeconds - PAST_WINDOW_SECONDS;
      const sampleTime = audio.currentTime + timeOffset;
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
