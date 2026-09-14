import { Director, Input, Node, director, input, view } from 'cc';
import type { FTReplayPointerEvent, FTReplayPointerSource } from '../core/replay.js';

export class FTCreator3PointerSource implements FTReplayPointerSource {
  onReplayPointer(callback: (event: FTReplayPointerEvent) => void): () => void {
    const listeners = [
      [Input.EventType.TOUCH_START, Node.EventType.TOUCH_START, observe('down')],
      [Input.EventType.TOUCH_MOVE, Node.EventType.TOUCH_MOVE, observe('move')],
      [Input.EventType.TOUCH_END, Node.EventType.TOUCH_END, observe('up')],
      [Input.EventType.TOUCH_CANCEL, Node.EventType.TOUCH_CANCEL, observe('up')],
    ] as const;
    let scene: any;
    const bindScene = (): void => {
      for (const [, type, handler] of listeners) scene?.off(type, handler, undefined, true);
      scene = director.getScene();
      // Creator 3 dispatches UI before global input. Buttons, joysticks and
      // BlockInputEvents can consume the event before input.on sees it.
      for (const [, type, handler] of listeners) scene?.on(type, handler, undefined, true);
    };
    for (const [type, , handler] of listeners) input.on(type, handler);
    director.on(Director.EVENT_AFTER_SCENE_LAUNCH, bindScene);
    bindScene();
    return () => {
      director.off(Director.EVENT_AFTER_SCENE_LAUNCH, bindScene);
      for (const [type, sceneType, handler] of listeners) {
        input.off(type, handler);
        scene?.off(sceneType, handler, undefined, true);
      }
    };

    function observe(eventType: FTReplayPointerEvent['eventType']): (event: any) => void {
      const seen = new WeakMap<object, Set<number>>();
      return (event: any): void => {
        const pointer = replayPointer(event, eventType);
        // One EventTouch can be dispatched for several fingers and UI nodes.
        // Do not duplicate a touch that also reaches the global input listener.
        let ids = seen.get(event);
        if (!ids) {
          ids = new Set();
          seen.set(event, ids);
          Promise.resolve().then(() => seen.delete(event));
        }
        if (ids.has(pointer.pointerId)) return;
        ids.add(pointer.pointerId);
        callback(pointer);
      };
    }
  }
}

function replayPointer(event: any, eventType: FTReplayPointerEvent['eventType']): FTReplayPointerEvent {
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
