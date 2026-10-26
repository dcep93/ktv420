class ktv420PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.port.onmessage = event => {
      // Ordered behind previously posted PCM, so the collector can drain its tail.
      if (event.data?.type === 'flush') this.port.postMessage({ type: 'flushed', id: event.data.id });
    };
  }
  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0 || !input[0]) {
      return true;
    }

    const channelCount = Math.min(2, input.length);
    const frameCount = input[0].length;
    const bytes = new Uint8Array(frameCount * channelCount * 4);
    const view = new DataView(bytes.buffer);
    let byteOffset = 0;

    for (let frame = 0; frame < frameCount; frame += 1) {
      for (let channel = 0; channel < channelCount; channel += 1) {
        const channelData = input[channel] || input[0];
        const sample = channelData[frame];
        view.setFloat32(byteOffset, sample, true);
        byteOffset += 4;
      }
    }

    this.port.postMessage(
      {
        bytesBuffer: bytes.buffer,
        channelCount,
        frame: currentFrame
      },
      [bytes.buffer]
    );
    return true;
  }
}

registerProcessor("ktv420-pcm-capture", ktv420PcmCaptureProcessor);
