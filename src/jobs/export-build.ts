/**
 * Queued static zip export build.
 * Implemented in build-order phase 8 (export).
 */

export interface ExportBuildJobData {
  galleryId: string;
  requestedByEmail: string;
}

export async function runExportBuildJob(_data: ExportBuildJobData): Promise<void> {
  throw new Error("static export arrives in build phase 8");
}
