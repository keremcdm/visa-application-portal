/**
 * Streams a ZIP prepared in memory in chunks. On Vercel a response sent in a single
 * part can be at most 4.5 MB; a streamed response is not subject to this limit.
 * The browser compares the size of the received file with the size the server announced;
 * if the connection drops halfway, the incomplete file is not saved.
 */

export const STREAM_CHUNK_BYTES = 1024 * 1024;

/** Stream yielding the bytes in chunks of at most `chunkBytes`; chunks are produced on demand. */
export function bytesToStream(bytes: Uint8Array, chunkBytes = STREAM_CHUNK_BYTES): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.byteLength) {
        controller.close();
        return;
      }
      const end = Math.min(offset + chunkBytes, bytes.byteLength);
      controller.enqueue(bytes.subarray(offset, end));
      offset = end;
    },
  });
}

/** Is the downloaded file complete? If the server did not announce a size, it only has to be non-empty. */
export function isCompleteDownload(expectedSizeHeader: string | null, receivedBytes: number): boolean {
  if (receivedBytes <= 0) return false;
  if (expectedSizeHeader === null) return true;
  const expected = Number(expectedSizeHeader);
  return Number.isInteger(expected) && expected === receivedBytes;
}
