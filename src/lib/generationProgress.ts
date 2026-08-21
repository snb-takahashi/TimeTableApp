// In-memory progress tracker for the auto-generate action, keyed by
// organization. Attached to globalThis (same pattern as the Prisma client
// singleton in db.ts) rather than a plain module-level variable: Next.js
// can give Server Actions and Route Handlers separate module instances
// even within one Node process, so a plain `const store = new Map()` here
// would not actually be shared between runAutoGenerate and the progress
// poll endpoint.
export type GenerationState =
  | { status: "idle" }
  | { status: "running"; percent: number; attempt: number }
  | { status: "done" }
  | { status: "cancelled" }
  | { status: "error"; message: string };

const globalForProgress = globalThis as unknown as {
  generationProgressStore: Map<string, GenerationState> | undefined;
  generationCancelStore: Set<string> | undefined;
};

const store = globalForProgress.generationProgressStore ?? new Map<string, GenerationState>();
globalForProgress.generationProgressStore = store;

const cancelStore = globalForProgress.generationCancelStore ?? new Set<string>();
globalForProgress.generationCancelStore = cancelStore;

export function setGenerationState(organizationId: string, state: GenerationState) {
  store.set(organizationId, state);
}

export function getGenerationState(organizationId: string): GenerationState {
  return store.get(organizationId) ?? { status: "idle" };
}

export function requestCancellation(organizationId: string) {
  cancelStore.add(organizationId);
}

export function clearCancellation(organizationId: string) {
  cancelStore.delete(organizationId);
}

export function isCancellationRequested(organizationId: string): boolean {
  return cancelStore.has(organizationId);
}
