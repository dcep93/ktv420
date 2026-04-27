import { md5Hex } from "./md5.js";

const graphsByElement = new WeakMap();

export class PcmCaptureTap {
  constructor(element) {
    const graph = getOrCreateGraph(element);
    this.element = element;
    this.graph = graph;
    this.context = graph.context;
    this.chunks = [];
    this.byteLength = 0;
    this.capturing = false;
    this.sampleRate = this.context.sampleRate;
    this.channelCount = 2;
    this.startMediaTime = 0;
    graph.consumers.add(this);
  }

  async begin() {
    if (this.context.state === "suspended") {
      await this.context.resume();
    }

    this.chunks = [];
    this.byteLength = 0;
    this.channelCount = 2;
    this.startMediaTime = safeMediaTime(this.element);
    this.capturing = true;
  }

  markAcceptedStart() {
    this.chunks = [];
    this.byteLength = 0;
    this.startMediaTime = safeMediaTime(this.element);
  }

  abort() {
    this.capturing = false;
    this.chunks = [];
    this.byteLength = 0;
  }

  finish() {
    this.capturing = false;
    const bytes = new Uint8Array(this.byteLength);
    let offset = 0;

    for (const chunk of this.chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return {
      bytes,
      byteLength: bytes.byteLength,
      md5: md5Hex(bytes),
      sampleRate: this.sampleRate,
      channelCount: this.channelCount,
      startMediaTime: this.startMediaTime
    };
  }

  close() {
    this.capturing = false;
    this.graph.consumers.delete(this);
  }

  handleAudioProcess(event) {
    if (!this.capturing) {
      return;
    }

    const input = event.inputBuffer;
    const channels = Math.min(2, input.numberOfChannels || 1);
    this.channelCount = channels;
    const frameCount = input.length;
    const bytes = new Uint8Array(frameCount * channels * 2);
    const view = new DataView(bytes.buffer);
    const channelData = [];

    for (let channel = 0; channel < channels; channel += 1) {
      channelData.push(input.getChannelData(channel));
    }

    let byteOffset = 0;
    for (let frame = 0; frame < frameCount; frame += 1) {
      for (let channel = 0; channel < channels; channel += 1) {
        const sample = Math.max(-1, Math.min(1, channelData[channel][frame] || 0));
        const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
        view.setInt16(byteOffset, int16, true);
        byteOffset += 2;
      }
    }

    this.chunks.push(bytes);
    this.byteLength += bytes.byteLength;
  }
}

export function bytesToBase64(bytes) {
  let output = "";
  const chunkSize = 0x7ffe;

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    let binary = "";
    for (let i = 0; i < chunk.length; i += 1) {
      binary += String.fromCharCode(chunk[i]);
    }
    output += btoa(binary);
  }

  return output;
}

function getOrCreateGraph(element) {
  const existing = graphsByElement.get(element);
  if (existing && existing.context.state !== "closed") {
    return existing;
  }

  const context = createAudioContextForElement(element);
  const source = context.createMediaElementSource(element);
  const processor = context.createScriptProcessor(4096, 2, 2);
  const graph = {
    context,
    source,
    processor,
    consumers: new Set()
  };

  processor.onaudioprocess = (event) => {
    for (const consumer of graph.consumers) {
      consumer.handleAudioProcess(event);
    }
  };

  source.connect(processor);
  source.connect(context.destination);
  processor.connect(context.destination);
  graphsByElement.set(element, graph);
  return graph;
}

function createAudioContextForElement(element) {
  const mediaWindow = element.ownerDocument?.defaultView || window;
  const AudioContextCtor = mediaWindow.AudioContext || mediaWindow.webkitAudioContext || window.AudioContext;
  return new AudioContextCtor();
}

function safeMediaTime(element) {
  return Number.isFinite(element?.currentTime) ? Math.max(0, element.currentTime) : 0;
}
