class ktv420PcmCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0 || !input[0]) {
      return true;
    }

    const channelCount = Math.min(2, input.length);
    const frameCount = input[0].length;
    const bytes = new Uint8Array(frameCount * channelCount * 2);
    const view = new DataView(bytes.buffer);
    let byteOffset = 0;

    for (let frame = 0; frame < frameCount; frame += 1) {
      for (let channel = 0; channel < channelCount; channel += 1) {
        const channelData = input[channel] || input[0];
        const sample = Math.max(-1, Math.min(1, channelData[frame] || 0));
        const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
        view.setInt16(byteOffset, int16, true);
        byteOffset += 2;
      }
    }

    this.port.postMessage(
      {
        bytesBuffer: bytes.buffer,
        channelCount
      },
      [bytes.buffer]
    );
    return true;
  }
}

registerProcessor("ktv420-pcm-capture", ktv420PcmCaptureProcessor);
