export function formatErrorMessage(functionName: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return `[${functionName}] ${message}`;
}
