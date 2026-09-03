import { Camera, Director, EditBox, RenderTexture, UITransform, director, native, sys, view } from 'cc';
import type { FTCanvasCapture } from '../core/replay.js';
import type { FTCapturedFrame, FTPrivacyRegion, FTReplayPrivacyMode, FTStoredFrame } from '../core/types.js';
import { frameFingerprint } from '../core/replay.js';
import { waitForRenderTextureReadback } from './replay-render-cycle.js';

export class FTCreator3CanvasCapture implements FTCanvasCapture {
  private camera: any;
  private privacy = new Map<unknown, FTReplayPrivacyMode>();

  setCamera(camera: unknown): void {
    this.camera = camera;
  }

  setPrivacy(node: unknown, mode: FTReplayPrivacyMode): void {
    if (mode === 'unmask') this.privacy.delete(node);
    else this.privacy.set(node, mode);
  }

  getViewportSize(): { width: number; height: number } | undefined {
    const visible = view.getVisibleSizeInPixel?.() || view.getVisibleSize();
    return visible ? { width: visible.width, height: visible.height } : undefined;
  }

  async capture(maxImageDimension: number): Promise<FTCapturedFrame | undefined> {
    const camera = this.camera || director.getScene()?.getComponentInChildren(Camera);
    if (!camera) return undefined;
    const visible = this.getViewportSize();
    if (!visible) return undefined;
    const scale = Math.min(1, maxImageDimension / Math.max(visible.width, visible.height));
    const width = Math.max(1, Math.round(visible.width * scale));
    const height = Math.max(1, Math.round(visible.height * scale));
    const texture = new RenderTexture();
    texture.reset({ width, height });
    const previous = camera.targetTexture;
    let pixels: Uint8Array | undefined;
    try {
      camera.targetTexture = texture;
      await waitForRenderTextureReadback(completeDrawCycle);
      pixels = texture.readPixels(0, 0, width, height);
    } finally {
      camera.targetTexture = previous;
      texture.destroy();
    }
    if (!pixels) return undefined;
    // Metal returns top-down pixels on iOS. OpenGL/Vulkan-backed native
    // targets use a bottom-left origin and need row reversal for PNG output.
    if (sys.os !== sys.OS?.IOS) flipRows(pixels, width, height);
    return {
      rgba: pixels,
      width,
      height,
      timestamp: Date.now(),
      privacyRegions: this.collectPrivacyRegions(width, height, visible.width, visible.height),
    };
  }

  async persist(frame: FTCapturedFrame, fingerprint = frameFingerprint(frame.rgba)): Promise<FTStoredFrame> {
    const path = `${native.fileUtils.getWritablePath()}cocos-sdk-replay-${fingerprint}.rgba`;
    if (!native.fileUtils.writeDataToFile(frame.rgba, path)) {
      throw new Error(`Unable to persist replay frame: ${path}`);
    }
    return { path, width: frame.width, height: frame.height, timestamp: frame.timestamp, fingerprint };
  }

  disposeStoredFrame(frame: FTStoredFrame): void {
    if (native.fileUtils.isFileExist(frame.path)) native.fileUtils.removeFile(frame.path);
  }

  private collectPrivacyRegions(
    width: number,
    height: number,
    sourceWidth: number,
    sourceHeight: number,
  ): FTPrivacyRegion[] {
    const nodes = new Map(this.privacy);
    director.getScene()?.getComponentsInChildren(EditBox)?.forEach((editBox: any) => {
      if (!nodes.has(editBox.node)) nodes.set(editBox.node, 'mask');
    });
    const scaleX = width / sourceWidth;
    const scaleY = height / sourceHeight;
    const regions: FTPrivacyRegion[] = [];
    nodes.forEach((mode, node: any) => {
      const bounds = node?.getComponent?.(UITransform)?.getBoundingBoxToWorld?.();
      if (!bounds) return;
      regions.push({
        x: bounds.x * scaleX,
        y: height - (bounds.y + bounds.height) * scaleY,
        width: bounds.width * scaleX,
        height: bounds.height * scaleY,
        mode: mode === 'hide' ? 'hide' : 'mask',
      });
    });
    return regions;
  }
}

async function completeDrawCycle(): Promise<void> {
  // capture() may run after the current frame's render graph has already been
  // prepared. Waiting only for EVENT_AFTER_DRAW can then read the newly bound
  // RenderTexture before the camera has rendered into it, producing a black
  // FullSnapshot at a Native -> Cocos boundary. Start at the next draw boundary
  // so the target texture is guaranteed to participate in a complete frame.
  await new Promise<void>((resolve) => director.once(Director.EVENT_BEFORE_DRAW, resolve));
  await new Promise<void>((resolve) => director.once(Director.EVENT_AFTER_DRAW, resolve));
}

function flipRows(bytes: Uint8Array, width: number, height: number): void {
  const rowSize = width * 4;
  const swap = new Uint8Array(rowSize);
  for (let top = 0, bottom = height - 1; top < bottom; top += 1, bottom -= 1) {
    const topOffset = top * rowSize;
    const bottomOffset = bottom * rowSize;
    swap.set(bytes.subarray(topOffset, topOffset + rowSize));
    bytes.copyWithin(topOffset, bottomOffset, bottomOffset + rowSize);
    bytes.set(swap, bottomOffset);
  }
}
