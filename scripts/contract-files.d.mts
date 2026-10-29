export function readSnapshot(directory: string, name: string): Buffer;
export function writeSnapshot(directory: string, name: string, snapshot: unknown): void;
export function snapshotDigest(bytes: Uint8Array): { bytes: number; sha256: string };
