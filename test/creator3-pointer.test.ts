/// <reference path="../src/creator3/shims.d.ts" />

import { afterEach, describe, expect, it, vi } from 'vitest';
import { FTCreator3PointerSource } from '../src/session-replay/creator3/pointer';
import type { FTReplayPointerEvent } from '../src/session-replay/core/replay';

const engine = vi.hoisted(() => {
  class Events {
    readonly handlers = new Map<string, Set<(event: any) => void>>();
    on(type: string, handler: (event: any) => void): void {
      if (!this.handlers.has(type)) this.handlers.set(type, new Set());
      this.handlers.get(type)!.add(handler);
    }
    off(type: string, handler: (event: any) => void): void { this.handlers.get(type)?.delete(handler); }
    emit(type: string, event?: any): void { this.handlers.get(type)?.forEach((handler) => handler(event)); }
    get count(): number { return [...this.handlers.values()].reduce((count, set) => count + set.size, 0); }
  }
  class Scene extends Events {
    readonly captures = new Events();
    override on(type: string, handler: (event: any) => void, _target?: any, capture?: boolean): void {
      if (capture) this.captures.on(type, handler);
      else super.on(type, handler);
    }
    override off(type: string, handler: (event: any) => void, _target?: any, capture?: boolean): void {
      if (capture) this.captures.off(type, handler);
      else super.off(type, handler);
    }
  }
  return { Events, Scene, scene: new Scene(), input: new Events(), director: new Events() };
});

vi.mock('cc', () => {
  const EventType = { TOUCH_START: 'down', TOUCH_MOVE: 'move', TOUCH_END: 'up', TOUCH_CANCEL: 'cancel' };
  return {
    Input: { EventType }, Node: { EventType }, input: engine.input,
    Director: { EVENT_AFTER_SCENE_LAUNCH: 'scene-launch' },
    director: {
      getScene: () => engine.scene,
      on: engine.director.on.bind(engine.director),
      off: engine.director.off.bind(engine.director),
    },
    view: { getVisibleSize: () => ({ width: 200, height: 100 }), getVisibleOrigin: () => ({ x: 10, y: 20 }) },
  };
});

afterEach(() => {
  engine.scene = new engine.Scene();
  engine.input.handlers.clear();
  engine.director.handlers.clear();
  vi.useRealTimers();
});

function touch(id = 1, x = 60, y = 45) {
  return { getID: () => id, getUILocation: () => ({ x, y }), propagationStopped: false, preventSwallow: false };
}

// Match Creator 3.8's UI-before-GLOBAL dispatch: a claimed UI touch does not
// reach input.on, even when its target permits propagation to other UI nodes.
function dispatch(type: string, event: ReturnType<typeof touch>, uiTarget: boolean): void {
  if (uiTarget) {
    engine.scene.captures.emit(type, event);
    event.propagationStopped = true; // Button / BlockInputEvents target handler.
    return;
  }
  engine.input.emit(type, event);
}

describe('Creator 3 replay pointer dispatch', () => {
  it('records a UI button press before the target swallows it, with the input timestamp and coordinates', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1234);
    const records: FTReplayPointerEvent[] = [];
    const stop = new FTCreator3PointerSource().onReplayPointer((event) => records.push(event));
    const down = touch();
    dispatch('down', down, true);
    vi.setSystemTime(1250);
    dispatch('up', touch(), true);
    expect(records).toEqual([
      { eventType: 'down', pointerId: 1, normalizedX: .25, normalizedY: .75, timestamp: 1234 },
      { eventType: 'up', pointerId: 1, normalizedX: .25, normalizedY: .75, timestamp: 1250 },
    ]);
    expect(down.preventSwallow).toBe(false);
    stop();
  });

  it('records joystick motion and cancellation as well as touches outside UI', () => {
    const records: FTReplayPointerEvent[] = [];
    const stop = new FTCreator3PointerSource().onReplayPointer((event) => records.push(event));
    dispatch('down', touch(1), true);
    dispatch('move', touch(1, 110, 70), true);
    dispatch('down', touch(2), false);
    dispatch('cancel', touch(1, 110, 70), true);
    dispatch('up', touch(2), false);
    expect(records.map((event) => [event.eventType, event.pointerId])).toEqual([
      ['down', 1], ['move', 1], ['down', 2], ['up', 1], ['up', 2],
    ]);
    expect(records[1]).toMatchObject({ normalizedX: .5, normalizedY: .5 });
    stop();
  });

  it('deduplicates UI/global delivery without dropping other fingers in the same EventTouch', async () => {
    const records: FTReplayPointerEvent[] = [];
    const stop = new FTCreator3PointerSource().onReplayPointer((event) => records.push(event));
    let id = 1;
    const event = { ...touch(), getID: () => id };
    engine.scene.captures.emit('down', event);
    engine.scene.captures.emit('down', event);
    engine.input.emit('down', event);
    id = 2;
    engine.scene.captures.emit('down', event);
    engine.input.emit('down', event);
    expect(records.map((record) => record.pointerId)).toEqual([1, 2]);
    expect(event).toMatchObject({ propagationStopped: false, preventSwallow: false });
    await Promise.resolve();
    engine.input.emit('down', event); // A later dispatch may reuse the object.
    expect(records).toHaveLength(3);
    stop();
  });

  it('rebinds on scene launch and removes both input paths on stop', () => {
    const records: FTReplayPointerEvent[] = [];
    const stop = new FTCreator3PointerSource().onReplayPointer((event) => records.push(event));
    const first = engine.scene;
    engine.scene = new engine.Scene();
    engine.director.emit('scene-launch');
    expect(first.captures.count).toBe(0);
    first.captures.emit('down', touch());
    dispatch('down', touch(), true);
    expect(records).toHaveLength(1);
    stop();
    expect(engine.scene.captures.count).toBe(0);
    expect(engine.director.count).toBe(0);
    expect(engine.input.count).toBe(0);
    dispatch('up', touch(), true);
    dispatch('up', touch(), false);
    expect(records).toHaveLength(1);
  });
});
