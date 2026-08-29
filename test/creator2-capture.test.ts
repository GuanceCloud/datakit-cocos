/// <reference path="../src/creator2/shims.d.ts" />

import { afterEach, describe, expect, it } from 'vitest';
import { FTCreator2CanvasCapture } from '../src/creator2/capture';
import { flipRgbaRows } from '../src/core/replay-pixels';

const originalCC = (globalThis as { cc?: unknown }).cc;

afterEach(() => {
  if (originalCC === undefined) delete (globalThis as { cc?: unknown }).cc;
  else (globalThis as { cc?: unknown }).cc = originalCC;
});

describe('Creator 2 replay capture', () => {
  it('normalizes bottom-left RenderTexture pixels to top-left image rows', () => {
    const bottomLeftPixels = new Uint8Array([
      1, 0, 0, 255, 2, 0, 0, 255,
      3, 0, 0, 255, 4, 0, 0, 255,
    ]);

    flipRgbaRows(bottomLeftPixels, 2, 2);

    expect([...bottomLeftPixels]).toEqual([
      3, 0, 0, 255, 4, 0, 0, 255,
      1, 0, 0, 255, 2, 0, 0, 255,
    ]);
  });

  it('clears a fresh RenderTexture color buffer and restores the camera state', async () => {
    let initializedWith: unknown[] | undefined;
    let destroyed = false;
    let targetAtDraw: unknown;
    let clearFlagsAtDraw: number | undefined;

    class RenderTexture {
      initWithSize(...args: unknown[]): void {
        initializedWith = args;
      }

      readPixels(): Uint8Array {
        return new Uint8Array([
          1, 0, 0, 255, 2, 0, 0, 255,
          3, 0, 0, 255, 4, 0, 0, 255,
        ]);
      }

      destroy(): void {
        destroyed = true;
      }
    }

    const previousTarget = { name: 'screen' };
    const camera = { targetTexture: previousTarget, clearFlags: 2 };
    (globalThis as { cc?: unknown }).cc = {
      Camera: { ClearFlags: { COLOR: 1 } },
      Director: { EVENT_AFTER_DRAW: 'after-draw' },
      EditBox: class {},
      RenderTexture,
      director: {
        getScene: () => ({
          getComponentInChildren: () => camera,
          getComponentsInChildren: () => [],
        }),
        once: (_event: string, callback: () => void) => {
          targetAtDraw = camera.targetTexture;
          clearFlagsAtDraw = camera.clearFlags;
          callback();
        },
      },
      gfx: { RB_FMT_D24S8: 7 },
      view: { getVisibleSizeInPixel: () => ({ width: 2, height: 2 }) },
    };

    const frame = await new FTCreator2CanvasCapture().capture(2);

    expect(initializedWith).toEqual([2, 2, 7]);
    expect(targetAtDraw).toBeInstanceOf(RenderTexture);
    expect(clearFlagsAtDraw).toBe(3);
    expect(camera.targetTexture).toBe(previousTarget);
    expect(camera.clearFlags).toBe(2);
    expect(destroyed).toBe(true);
    expect([...frame!.rgba]).toEqual([
      3, 0, 0, 255, 4, 0, 0, 255,
      1, 0, 0, 255, 2, 0, 0, 255,
    ]);
  });
});
