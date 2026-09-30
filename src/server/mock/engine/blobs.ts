import "server-only";
/**
 * Content-addressed text store, like weft's .weft/blobs: the ref is the sha256 hex of the
 * UTF-8 bytes, so a file subject's ref.$blob equals its sha256 and identical texts share a ref.
 */
import { createHash } from "node:crypto";
import type { BlobRef } from "@/lib/weft/types";

export const PREVIEW_CHARS = 200;

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export class BlobStore {
  private readonly texts = new Map<string, string>();

  put(text: string): BlobRef {
    const sha = sha256Hex(text);
    this.texts.set(sha, text);
    return { $blob: sha, size: Buffer.byteLength(text, "utf8"), preview: text.slice(0, PREVIEW_CHARS) };
  }

  get(sha: string): string | undefined {
    return this.texts.get(sha);
  }

  has(sha: string): boolean {
    return this.texts.has(sha);
  }

  clear(): void {
    this.texts.clear();
  }
}
