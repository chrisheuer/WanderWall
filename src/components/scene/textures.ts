"use client";

import { useEffect, useState } from "react";
import * as THREE from "three";

/**
 * Texture residency with an LRU byte budget.
 *
 * Residency policy (the performance contract):
 *   - focused artwork → zoom (2048)
 *   - active room     → wall (1024)
 *   - adjacent rooms  → thumb (256) pre-warm
 *   - elsewhere       → not mounted at all (see GalleryViewer)
 *
 * Entries are reference-counted: a texture belonging to a currently
 * mounted artwork is pinned and can never be evicted, so eviction cannot
 * pull the picture you are standing in front of. Everything unpinned is
 * evictable oldest-first once the budget is exceeded.
 */

interface CacheEntry {
  texture: THREE.Texture;
  bytes: number;
  lastUsed: number;
  refs: number;
}

const isMobile =
  typeof navigator !== "undefined" && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

const BUDGET_BYTES = (isMobile ? 256 : 768) * 1024 * 1024;

class TextureCache {
  private entries = new Map<string, CacheEntry>();
  private loading = new Map<string, Promise<THREE.Texture>>();
  private loader = new THREE.TextureLoader();
  private totalBytes = 0;

  /** Load and pin. Every acquire must be paired with a release. */
  async acquire(url: string): Promise<THREE.Texture> {
    const hit = this.entries.get(url);
    if (hit) {
      hit.refs += 1;
      hit.lastUsed = performance.now();
      return hit.texture;
    }

    const inflight = this.loading.get(url);
    if (inflight) {
      const texture = await inflight;
      const entry = this.entries.get(url);
      if (entry) {
        entry.refs += 1;
        entry.lastUsed = performance.now();
      }
      return texture;
    }

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
          this.entries.set(url, { texture, bytes, lastUsed: performance.now(), refs: 1 });
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

  release(url: string): void {
    const entry = this.entries.get(url);
    if (!entry) return;
    entry.refs = Math.max(0, entry.refs - 1);
    entry.lastUsed = performance.now();
    // Unpinned entries stay cached until the budget forces them out, so
    // stepping back into a room you just left is instant.
    this.evictIfNeeded();
  }

  private evictIfNeeded(): void {
    if (this.totalBytes <= BUDGET_BYTES) return;
    const evictable = [...this.entries.entries()]
      .filter(([, e]) => e.refs === 0)
      .sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    for (const [url, entry] of evictable) {
      if (this.totalBytes <= BUDGET_BYTES * 0.85) break;
      entry.texture.dispose();
      this.entries.delete(url);
      this.totalBytes -= entry.bytes;
    }
  }

  /** Test/diagnostic hook. */
  stats(): { bytes: number; count: number; pinned: number } {
    let pinned = 0;
    for (const entry of this.entries.values()) if (entry.refs > 0) pinned += 1;
    return { bytes: this.totalBytes, count: this.entries.size, pinned };
  }
}

export const textureCache = new TextureCache();

export type Residency = "focused" | "active" | "adjacent";

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
 * Returns the best already-loaded texture and upgrades when the target
 * resolution arrives. Holds a pin for as long as the component is mounted
 * at that resolution.
 */
export function useArtworkTexture(
  urls: { thumb: string | null; wall: string | null; zoom: string | null },
  residency: Residency,
): THREE.Texture | null {
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  const target = urlForResidency(urls, residency);

  useEffect(() => {
    if (!target) return;
    let alive = true;
    let acquired: string | null = null;

    textureCache
      .acquire(target)
      .then((t) => {
        if (!alive) {
          textureCache.release(target);
          return;
        }
        acquired = target;
        setTexture(t);
      })
      .catch(() => {
        // Broken derivative: keep whatever was already shown.
      });

    return () => {
      alive = false;
      if (acquired) textureCache.release(acquired);
    };
  }, [target]);

  return texture;
}
