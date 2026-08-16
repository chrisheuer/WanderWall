"use client";

import { useEffect, useState } from "react";
import * as THREE from "three";

/**
 * Proximity texture streaming with an LRU cache and a byte budget.
 * Residency policy (the performance contract):
 *   - focused artwork → zoom (2048)
 *   - active room     → wall (1024)
 *   - adjacent rooms  → thumb (256) pre-warm
 *   - elsewhere       → thumb, evictable
 * ~256MB budget on mobile, more on desktop.
 */

interface CacheEntry {
  texture: THREE.Texture;
  bytes: number;
  lastUsed: number;
}

const isMobile =
  typeof navigator !== "undefined" && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

const BUDGET_BYTES = (isMobile ? 256 : 768) * 1024 * 1024;

class TextureCache {
  private entries = new Map<string, CacheEntry>();
  private loading = new Map<string, Promise<THREE.Texture>>();
  private loader = new THREE.TextureLoader();
  private totalBytes = 0;

  async load(url: string): Promise<THREE.Texture> {
    const hit = this.entries.get(url);
    if (hit) {
      hit.lastUsed = performance.now();
      return hit.texture;
    }
    const inflight = this.loading.get(url);
    if (inflight) return inflight;

    const promise = new Promise<THREE.Texture>((resolve, reject) => {
      this.loader.load(
        url,
        (texture) => {
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.anisotropy = 4;
          texture.generateMipmaps = true;
          const img = texture.image as { width?: number; height?: number } | undefined;
          // RGBA + ~1/3 mipmap overhead.
          const bytes = Math.round((img?.width ?? 1024) * (img?.height ?? 1024) * 4 * 1.34);
          this.entries.set(url, { texture, bytes, lastUsed: performance.now() });
          this.totalBytes += bytes;
          this.loading.delete(url);
          this.evictIfNeeded();
          resolve(texture);
        },
        undefined,
        (err) => {
          this.loading.delete(url);
          reject(err);
        },
      );
    });
    this.loading.set(url, promise);
    return promise;
  }

  touch(url: string): void {
    const entry = this.entries.get(url);
    if (entry) entry.lastUsed = performance.now();
  }

  private evictIfNeeded(): void {
    if (this.totalBytes <= BUDGET_BYTES) return;
    const byAge = [...this.entries.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    for (const [url, entry] of byAge) {
      if (this.totalBytes <= BUDGET_BYTES * 0.85) break;
      // Never evict something touched this frame.
      if (performance.now() - entry.lastUsed < 100) continue;
      entry.texture.dispose();
      this.entries.delete(url);
      this.totalBytes -= entry.bytes;
    }
  }
}

export const textureCache = new TextureCache();

export type Residency = "focused" | "active" | "adjacent" | "far";

export function urlForResidency(
  urls: { thumb: string | null; wall: string | null; zoom: string | null },
  residency: Residency,
): string | null {
  switch (residency) {
    case "focused":
      return urls.zoom ?? urls.wall ?? urls.thumb;
    case "active":
      return urls.wall ?? urls.thumb;
    default:
      return urls.thumb ?? urls.wall;
  }
}

/**
 * Progressive hook: returns the best already-loaded texture immediately and
 * upgrades when the target resolution arrives.
 */
export function useArtworkTexture(
  urls: { thumb: string | null; wall: string | null; zoom: string | null },
  residency: Residency,
): THREE.Texture | null {
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  const target = urlForResidency(urls, residency);

  useEffect(() => {
    let alive = true;
    if (!target) return;
    // Kick a fast thumb first if we have nothing shown yet.
    if (!texture && urls.thumb && target !== urls.thumb) {
      void textureCache.load(urls.thumb).then((t) => {
        if (alive) setTexture((prev) => prev ?? t);
      });
    }
    void textureCache
      .load(target)
      .then((t) => {
        if (alive) setTexture(t);
      })
      .catch(() => {
        // Broken derivative: leave whatever we had.
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  if (texture) textureCache.touch((texture as THREE.Texture & { source?: { data?: { src?: string } } }).source?.data?.src ?? "");
  return texture;
}
