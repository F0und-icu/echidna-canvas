export class JsonlDecoder {
  private decoder = new TextDecoder('utf-8', { fatal: true });
  private pending = '';
  push(bytes: Uint8Array): unknown[] {
    this.pending += this.decoder.decode(bytes, { stream: true });
    const lines = this.pending.split('\n');
    this.pending = lines.pop()!;
    // A 20 MiB raster uses about 27 MiB when returned as base64 by Codex/MCP.
    const limit = 32 * 1024 * 1024;
    if (this.pending.length > limit || lines.some((line) => line.length > limit))
      throw new Error('JSONL frame exceeds 32 MiB');
    return lines.map((line) => JSON.parse(line) as unknown);
  }
  finish() {
    this.pending += this.decoder.decode();
    if (this.pending.length) throw new Error('Truncated JSONL frame');
  }
}
