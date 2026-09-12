import { Director, Input, director, input } from 'cc';
import type { FTEngineTrackingHooks } from '../core/auto-tracking.js';
import type { FTAttributes } from '../core/types.js';

export class FTCreator3TrackingHooks implements FTEngineTrackingHooks {
  onSceneChanged(callback: (name: string) => void, includeCurrent = true): () => void {
    const handler = (): void => callback(director.getScene()?.name || 'UnknownScene');
    director.on(Director.EVENT_AFTER_SCENE_LAUNCH, handler);
    if (includeCurrent && director.getScene()) handler();
    return () => director.off(Director.EVENT_AFTER_SCENE_LAUNCH, handler);
  }

  onAction(callback: (name: string, attributes?: FTAttributes) => void): () => void {
    const handler = (event: any): void => {
      const location = event.getUILocation?.() || event.getLocation?.();
      callback(event.target?.name || 'CocosTouch', location ? { x: location.x, y: location.y } : undefined);
    };
    input.on(Input.EventType.TOUCH_END, handler);
    return () => input.off(Input.EventType.TOUCH_END, handler);
  }
}
