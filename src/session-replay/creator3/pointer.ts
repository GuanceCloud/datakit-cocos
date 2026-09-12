import { Input, input, view } from 'cc';
import type { FTReplayPointerEvent, FTReplayPointerSource } from '../core/replay.js';

export class FTCreator3PointerSource implements FTReplayPointerSource {
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
