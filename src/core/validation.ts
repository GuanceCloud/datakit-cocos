export function samplingRate(value: number | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${name} must be between 0 and 1`);
  }
  return value;
}

export function captureFps(value: number | undefined): number {
  const fps = value === undefined ? 1 : value;
  if (!Number.isInteger(fps) || fps < 1 || fps > 5) {
    throw new RangeError('captureFps must be an integer between 1 and 5');
  }
  return fps;
}

export function requireText(value: string, name: string): string {
  if (!value.trim()) throw new TypeError(`${name} must not be empty`);
  return value;
}

