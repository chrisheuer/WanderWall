/**
 * Storage adapter seam. Supabase Storage backs v1; Cloudflare R2 can replace
 * it by implementing this interface — feature code never touches a vendor SDK.
 */
export interface StorageAdapter {
  /** Store bytes at key. Returns the key. */
  put(
    bucket: string,
    key: string,
    body: Buffer | Uint8Array,
    opts?: { contentType?: string; cacheControl?: string },
  ): Promise<string>;

  /** Fetch object bytes. */
  get(bucket: string, key: string): Promise<Buffer>;

  /** Time-limited signed URL for private objects. */
  signedUrl(bucket: string, key: string, expiresInSeconds?: number): Promise<string>;

  /** Stable public URL (public buckets only — derivatives). */
  publicUrl(bucket: string, key: string): string;

  delete(bucket: string, keys: string[]): Promise<void>;
}
