import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import type { StorageAdapter } from "./adapter";

/** Derivatives are immutable (content-addressed keys), so cache hard. */
export const DERIVATIVE_CACHE_CONTROL = "public, max-age=31536000, immutable";

class SupabaseStorageAdapter implements StorageAdapter {
  private client: SupabaseClient;

  constructor() {
    this.client = createClient(
      env().NEXT_PUBLIC_SUPABASE_URL,
      env().SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false } },
    );
  }

  async put(
    bucket: string,
    key: string,
    body: Buffer | Uint8Array,
    opts?: { contentType?: string; cacheControl?: string },
  ): Promise<string> {
    const { error } = await this.client.storage.from(bucket).upload(key, body, {
      contentType: opts?.contentType,
      cacheControl: opts?.cacheControl ?? "3600",
      upsert: true,
    });
    if (error) throw new Error(`storage put failed for ${bucket}/${key}: ${error.message}`);
    return key;
  }

  async get(bucket: string, key: string): Promise<Buffer> {
    const { data, error } = await this.client.storage.from(bucket).download(key);
    if (error || !data) {
      throw new Error(`storage get failed for ${bucket}/${key}: ${error?.message}`);
    }
    return Buffer.from(await data.arrayBuffer());
  }

  async signedUrl(bucket: string, key: string, expiresInSeconds = 3600): Promise<string> {
    const { data, error } = await this.client.storage
      .from(bucket)
      .createSignedUrl(key, expiresInSeconds);
    if (error || !data) {
      throw new Error(`signedUrl failed for ${bucket}/${key}: ${error?.message}`);
    }
    return data.signedUrl;
  }

  publicUrl(bucket: string, key: string): string {
    return this.client.storage.from(bucket).getPublicUrl(key).data.publicUrl;
  }

  async delete(bucket: string, keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    const { error } = await this.client.storage.from(bucket).remove(keys);
    if (error) throw new Error(`storage delete failed in ${bucket}: ${error.message}`);
  }
}

let adapter: StorageAdapter | null = null;

/** The only storage entry point feature code may import. */
export function storage(): StorageAdapter {
  if (!adapter) adapter = new SupabaseStorageAdapter();
  return adapter;
}
