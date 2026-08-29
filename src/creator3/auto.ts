import { Director, Input, director, input, view } from 'cc';
import type { FTEngineTrackingHooks } from '../core/auto-tracking.js';
import type { FTReplayPointerEvent, FTReplayPointerSource } from '../core/replay.js';
import type { FTAttributes } from '../core/types.js';

export class FTCreator3TrackingHooks implements FTEngineTrackingHooks, FTReplayPointerSource {
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

  onReplayPointer(callback: (event: FTReplayPointerEvent) => void): () => void {
    const onStart = (event: any): void => callback(replayPointer(event, 'down'));
    const onEnd = (event: any): void => callback(replayPointer(event, 'up'));
    input.on(Input.EventType.TOUCH_START, onStart);
    input.on(Input.EventType.TOUCH_END, onEnd);
    input.on(Input.EventType.TOUCH_CANCEL, onEnd);
    return () => {
      input.off(Input.EventType.TOUCH_START, onStart);
      input.off(Input.EventType.TOUCH_END, onEnd);
      input.off(Input.EventType.TOUCH_CANCEL, onEnd);
    };
  }
}

function replayPointer(event: any, eventType: 'down' | 'up'): FTReplayPointerEvent {
  const location = event.getUILocation?.() || event.getLocation?.() || { x: 0, y: 0 };
  const size = view.getVisibleSize?.() || { width: 1, height: 1 };
  const origin = view.getVisibleOrigin?.() || { x: 0, y: 0 };
  return {
    eventType,
    pointerId: event.getID?.() ?? event.touch?.getID?.() ?? 0,
    normalizedX: size.width > 0 ? (location.x - origin.x) / size.width : 0,
    normalizedY: size.height > 0 ? 1 - ((location.y - origin.y) / size.height) : 0,
    timestamp: Date.now(),
  };
}
