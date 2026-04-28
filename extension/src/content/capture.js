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
