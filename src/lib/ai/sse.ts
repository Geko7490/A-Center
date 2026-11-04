import { ProviderError } from "./types";
// Handles split UTF-8 sequences, multi-line data, CRLF and keep-alive comments.
export async function* parseSSE(body: ReadableStream<Uint8Array>, signal: AbortSignal, idleMs = 90000): AsyncGenerator<{ event: string; data: string }> {
  const reader = body.getReader(); const decoder = new TextDecoder();
  let buffer = "", event = "message", data: string[] = [];
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    for (;;) {
      if (signal.aborted) throw new ProviderError("Request cancelled", "cancelled", 499);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const chunk = await Promise.race([reader.read(), new Promise<never>((_, reject) => { timer = setTimeout(() => { reject(new ProviderError("Stream idle timeout", "timeout", 504)); abort(); }, idleMs); })]).finally(() => clearTimeout(timer));
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      if (buffer.length > 4 * 1024 * 1024) throw new ProviderError("Oversized streaming frame", "invalid_stream");
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end).replace(/\r$/, ""); buffer = buffer.slice(end + 1);
        if (!line) { if (data.length) yield { event, data: data.join("\n") }; data = []; event = "message"; }
        else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
        else if (line.startsWith("event:")) event = line.slice(6).trim();
      }
    }
    if (signal.aborted) throw new ProviderError("Request cancelled", "cancelled", 499);
    if (buffer.trim() || data.length) throw new ProviderError("Stream ended inside an event", "stream_interrupted");
  } catch(error) {
    if(signal.aborted)throw new ProviderError(signal.reason?.name==="TimeoutError"?"Request timed out":"Request cancelled",signal.reason?.name==="TimeoutError"?"timeout":"cancelled",signal.reason?.name==="TimeoutError"?504:499);
    if(error instanceof ProviderError)throw error;
    throw new ProviderError("Streaming connection was lost", "stream_interrupted");
  } finally { signal.removeEventListener("abort", abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
