export const errorMessage = (e: unknown) => e instanceof Error ? e.message : String(e);
