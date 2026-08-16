/**
 * One resumable page of a Google Drive / Dropbox folder import.
 * Implemented in build-order phase 7 (cloud imports).
 */

export interface ImportChunkJobData {
  importRunId: string;
}

export async function runImportChunkJob(_data: ImportChunkJobData): Promise<void> {
  throw new Error("cloud imports arrive in build phase 7");
}
