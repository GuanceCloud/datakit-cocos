import type { FTCanvasCapture } from '../core/replay.js';
import { frameFingerprint } from '../core/replay.js';
import { flipRgbaRows } from '../core/replay-pixels.js';
import type { FTCapturedFrame, FTPrivacyRegion, FTReplayPrivacyMode, FTStoredFrame } from '../core/types.js';

export class FTCreator2CanvasCapture implements FTCanvasCapture {
  private camera: any;
  private privacy = new Map<unknown, FTReplayPrivacyMode>();

  setCamera(camera: unknown): void {
    this.camera = camera;
  }

  setPrivacy(node: unknown, mode: FTReplayPrivacyMode): void {
    if (mode === 'unmask') this.privacy.delete(node);
    else this.privacy.set(node, mode);
  }

  async capture(maxImageDimension: number): Promise<FTCapturedFrame | undefined> {
    const scene = cc.director.getScene();
    const camera = this.camera || scene?.getComponentInChildren?.(cc.Camera);
    if (!camera) return undefined;
    const visible = cc.view.getVisibleSizeInPixel?.() || cc.view.getVisibleSize();
    const scale = Math.min(1, maxImageDimension / Math.max(visible.width, visible.height));
    const width = Math.max(1, Math.round(visible.width * scale));
    const height = Math.max(1, Math.round(visible.height * scale));
    const texture = new cc.RenderTexture();
    texture.initWithSize(width, height, cc.gfx?.RB_FMT_D24S8);
    const previous = camera.targetTexture;
    const previousClearFlags = camera.clearFlags;
    let pixels: Uint8Array | undefined;
    try {
      // Creator 2 cameras clear only depth and stencil by default. A fresh
      // RenderTexture can therefore expose stale GPU color data anywhere the
      // scene does not draw, which appears as overlapping strips in replay.
      camera.clearFlags = previousClearFlags | cc.Camera.ClearFlags.COLOR;
      camera.targetTexture = texture;
      await new Promise<void>((resolve) => cc.director.once(cc.Director.EVENT_AFTER_DRAW, resolve));
      pixels = texture.readPixels();
    } finally {
      camera.targetTexture = previous;
      camera.clearFlags = previousClearFlags;
      texture.destroy();
    }
    if (!pixels) return undefined;
    // Creator 2 native rendering uses OpenGL, including on iOS. RenderTexture
    // pixels therefore use a bottom-left origin and must be normalized before
    // PNG encoding and top-left-based privacy-region masking.
    flipRgbaRows(pixels, width, height);
    return {
      rgba: pixels,
      width,
      height,
      timestamp: Date.now(),
      privacyRegions: this.collectPrivacyRegions(width, height, visible.width, visible.height),
    };
  }

  async persist(frame: FTCapturedFrame, fingerprint = frameFingerprint(frame.rgba)): Promise<FTStoredFrame> {
    const path = `${jsb.fileUtils.getWritablePath()}cocos-sdk-replay-${fingerprint}.rgba`;
    if (!jsb.fileUtils.writeDataToFile(frame.rgba, path)) {
      throw new Error(`Unable to persist replay frame: ${path}`);
    }
    return { path, width: frame.width, height: frame.height, timestamp: frame.timestamp, fingerprint };
  }

  disposeStoredFrame(frame: FTStoredFrame): void {
    if (jsb.fileUtils.isFileExist(frame.path)) jsb.fileUtils.removeFile(frame.path);
  }

  private collectPrivacyRegions(
    width: number,
    height: number,
    sourceWidth: number,
    sourceHeight: number,
  ): FTPrivacyRegion[] {
    const nodes = new Map(this.privacy);
    cc.director.getScene()?.getComponentsInChildren?.(cc.EditBox)?.forEach((editBox: any) => {
      if (!nodes.has(editBox.node)) nodes.set(editBox.node, 'mask');
    });
    const scaleX = width / sourceWidth;
    const scaleY = height / sourceHeight;
    const regions: FTPrivacyRegion[] = [];
    nodes.forEach((mode, node: any) => {
      const bounds = node?.getBoundingBoxToWorld?.();
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
