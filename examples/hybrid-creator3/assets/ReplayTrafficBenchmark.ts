import {
  Camera,
  Canvas,
  Color,
  EventTouch,
  Graphics,
  Input,
  Label,
  Layers,
  Node,
  Scene,
  Touch,
  UITransform,
  director,
  game,
  input,
  native,
  sys,
  view,
} from 'cc';
import { guanceSdk, setReplayCamera } from '@cloudcare/cocos-sdk/creator3';

const VIEW_NAME = 'CocosReplayTrafficBenchmark';
const OBJECT_COUNT = 48;

interface ReplayTrafficBootstrap {
  enabled: boolean;
  controlUrl?: string;
}

interface ReplayTrafficRunConfig {
  runId: string;
  platform: 'android' | 'ios';
  deviceLabel: string;
  groupId: string;
  scenario: 'STATIC' | 'UI-DELTA' | 'FULL-MOTION';
  repeat: number;
  randomSeed: number;
  targetFrameRate: number;
  canvas: { width: number; height: number; orientation: 'landscape' };
  warmupMs: number;
  measurementMs: number;
  quietPeriodMs: number;
  flushTimeoutMs: number;
  replay: {
    captureFps: number;
    maxImageDimension?: number;
    imagePolicy?: {
      quality?: 'low' | 'medium' | 'high';
      maxFrameBytes?: number;
      maxBytesPerMinute?: number;
      adaptiveCapture?: boolean;
    };
    touchPrivacy: 'hide' | 'show';
    tapsPerSecond?: number;
  };
}

interface DiagnosticEvent {
  type: string;
  timestamp: number;
  [key: string]: unknown;
}

interface BenchmarkGlobal {
  __FT_COCOS_REPLAY_BENCHMARK_OBSERVER__?: (event: DiagnosticEvent) => void;
}

export function startReplayTrafficBenchmarkIfConfigured(): boolean {
  if (!sys.isNative) return false;
  const bootstrap = readBootstrap();
  if (!bootstrap.enabled || !bootstrap.controlUrl) return false;
  new ReplayTrafficBenchmarkRuntime(bootstrap.controlUrl).start();
  return true;
}

class ReplayTrafficBenchmarkRuntime {
  private readonly diagnosticEvents: DiagnosticEvent[] = [];
  private root?: Node;
  private status?: Label;
  private load?: Graphics;
  private delta?: Graphics;
  private deltaLabel?: Label;
  private loadTimer?: ReturnType<typeof setInterval>;
  private touchTimer?: ReturnType<typeof setInterval>;
  private frame = 0;

  constructor(private readonly controlUrl: string) {}

  async start(): Promise<void> {
    try {
      const config = await this.request<ReplayTrafficRunConfig>('GET', '/config');
      this.validatePlatform(config);
      game.frameRate = config.targetFrameRate;
      const { root, camera } = this.createScene(config);
      this.root = root;
      setReplayCamera(camera);
      this.render(config);
      this.startLoad(config);
      this.setStatus(`WARMUP · ${config.warmupMs / 1000}s`, new Color(245, 166, 35, 255));
      await this.delay(config.warmupMs);
      prepareNativeBenchmark(config);
      await this.request('POST', '/runs/start', { runId: config.runId });
      (globalThis as BenchmarkGlobal).__FT_COCOS_REPLAY_BENCHMARK_OBSERVER__ = (event) => {
        this.diagnosticEvents.push(event);
      };
      guanceSdk.attach({
        replay: replayConfig(config.replay),
        autoTrack: { scenes: false, actions: false, errors: false, console: false, network: false },
      });
      guanceSdk.enterCocos({ viewName: VIEW_NAME });
      this.startTouches(config);
      this.setStatus(`MEASURING · ${config.measurementMs / 1000}s`, new Color(44, 202, 178, 255));
      await this.delay(config.measurementMs);
      await this.stopAndFlush(config);
    } catch (error) {
      this.setStatus(`FAILED · ${error instanceof Error ? error.message : String(error)}`, new Color(236, 83, 103, 255));
      console.error('[ReplayTrafficBenchmark] failed', error);
    }
  }

  private async stopAndFlush(config: ReplayTrafficRunConfig): Promise<void> {
    if (this.touchTimer !== undefined) clearInterval(this.touchTimer);
    this.touchTimer = undefined;
    guanceSdk.leaveCocos();
    const flushRequestedAt = Date.now();
    this.diagnosticEvents.push({ type: 'flush_requested', timestamp: flushRequestedAt });
    flushNativeBenchmark();
    this.setStatus('FLUSHING · waiting for 10s quiet', new Color(73, 142, 245, 255));

    const deadline = flushRequestedAt + config.flushTimeoutMs;
    let lastUploadAt = flushRequestedAt;
    while (Date.now() < deadline) {
      const status = await this.request<{ lastDataAt?: number }>('GET', '/status');
      if (Number.isFinite(status.lastDataAt)) lastUploadAt = Math.max(lastUploadAt, status.lastDataAt!);
      if (Date.now() - lastUploadAt >= config.quietPeriodMs) break;
      await this.delay(1000);
    }

    await this.request('POST', `/runs/${encodeURIComponent(config.runId)}/events`, {
      events: this.diagnosticEvents,
    });
    (globalThis as BenchmarkGlobal).__FT_COCOS_REPLAY_BENCHMARK_OBSERVER__ = undefined;
    const stopped = await this.request<{ resultDirectory: string }>(
      'POST',
      `/runs/${encodeURIComponent(config.runId)}/stop`,
      {
        flushRequestedAt,
        flushWaitMs: Date.now() - flushRequestedAt,
        intendedMeasurementMs: config.measurementMs,
      },
    );
    this.setStatus(`COMPLETE · ${stopped.resultDirectory}`, new Color(44, 202, 178, 255));
  }

  private createScene(config: ReplayTrafficRunConfig): { root: Node; camera: Camera } {
    const scene = new Scene(VIEW_NAME);
    const cameraNode = new Node('ReplayTrafficCamera');
    cameraNode.layer = Layers.Enum.UI_2D;
    cameraNode.setPosition(0, 0, 1000);
    scene.addChild(cameraNode);
    const camera = cameraNode.addComponent(Camera);
    camera.projection = Camera.ProjectionType.ORTHO;
    camera.orthoHeight = config.canvas.height / 2;
    camera.visibility = Layers.Enum.UI_2D;
    camera.clearColor = new Color(7, 13, 28, 255);

    const canvasNode = new Node('ReplayTrafficCanvas');
    canvasNode.layer = Layers.Enum.UI_2D;
    scene.addChild(canvasNode);
    canvasNode.addComponent(UITransform).setContentSize(config.canvas.width, config.canvas.height);
    const canvas = canvasNode.addComponent(Canvas);
    canvas.cameraComponent = camera;

    const root = new Node('ReplayTrafficLoad');
    root.layer = Layers.Enum.UI_2D;
    root.addComponent(UITransform).setContentSize(config.canvas.width, config.canvas.height);
    canvasNode.addChild(root);
    director.runSceneImmediate(scene);
    return { root, camera };
  }

  private render(config: ReplayTrafficRunConfig): void {
    const root = this.root!;
    this.drawPanel(root, 'Background', 0, 0, 960, 640, new Color(7, 13, 28, 255));
    const loadNode = new Node('DeterministicLoad');
    loadNode.layer = Layers.Enum.UI_2D;
    loadNode.addComponent(UITransform).setContentSize(960, 640);
    root.addChild(loadNode);
    this.load = loadNode.addComponent(Graphics);

    const deltaNode = this.drawPanel(root, 'UIDelta', 0, 10, 440, 130, new Color(73, 142, 245, 255));
    this.delta = deltaNode.getComponent(Graphics) || undefined;
    this.deltaLabel = this.label(deltaNode, 'DETERMINISTIC UI DELTA', 0, 0, 390, 52, 24, Color.WHITE);

    const header = this.drawPanel(root, 'Header', 0, 264, 900, 84, new Color(18, 29, 52, 235));
    this.label(header, 'COCOS SESSION REPLAY · REAL TRAFFIC', 0, 18, 850, 34, 25, Color.WHITE);
    this.label(header, `${config.groupId} · ${config.scenario} · r${config.repeat}`, 0, -20, 850, 28, 18, new Color(151, 164, 190, 255));

    const footer = this.drawPanel(root, 'Footer', 0, -270, 900, 72, new Color(18, 29, 52, 235));
    this.status = this.label(footer, 'PREPARING', 0, 16, 850, 28, 17, new Color(245, 166, 35, 255));
    this.label(
      footer,
      `960×640 · landscape · ${config.targetFrameRate} fps · ${OBJECT_COUNT} objects · seed ${config.randomSeed}`,
      0,
      -15,
      850,
      24,
      14,
      new Color(151, 164, 190, 255),
    );
  }

  private startLoad(config: ReplayTrafficRunConfig): void {
    this.drawLoad(config);
    if (config.scenario === 'STATIC') return;
    const interval = config.scenario === 'UI-DELTA' ? 1000 : Math.round(1000 / config.targetFrameRate);
    this.loadTimer = setInterval(() => {
      this.frame += 1;
      this.drawLoad(config);
    }, interval);
  }

  private drawLoad(config: ReplayTrafficRunConfig): void {
    if (config.scenario === 'STATIC') {
      this.load?.clear();
      this.drawObjects(this.load, config.randomSeed, 0, false);
      return;
    }
    if (config.scenario === 'UI-DELTA') {
      const palette = [
        new Color(73, 142, 245, 255),
        new Color(44, 202, 178, 255),
        new Color(245, 166, 35, 255),
        new Color(236, 83, 103, 255),
      ];
      const color = palette[this.frame % palette.length];
      this.delta?.clear();
      if (this.delta) {
        this.delta.fillColor = color;
        this.delta.roundRect(-220, -65, 440, 130, 18);
        this.delta.fill();
        this.delta.node.setPosition(((this.frame % 5) - 2) * 24, 10);
      }
      if (this.deltaLabel) this.deltaLabel.string = `UI DELTA · ${(`0000${this.frame}`).slice(-4)}`;
      return;
    }
    this.load?.clear();
    this.drawObjects(this.load, config.randomSeed, this.frame, true);
  }

  private drawObjects(graphics: Graphics | undefined, seed: number, frame: number, moving: boolean): void {
    if (!graphics) return;
    for (let index = 0; index < OBJECT_COUNT; index += 1) {
      const phase = hash(seed, index, frame);
      const baseX = ((index % 8) - 3.5) * 118;
      const baseY = (Math.floor(index / 8) - 2.5) * 86;
      const dx = moving ? Math.sin((frame + index * 7) * 0.075) * 54 : 0;
      const dy = moving ? Math.cos((frame + index * 11) * 0.061) * 38 : 0;
      const size = 24 + (phase % 34);
      graphics.fillColor = new Color(
        40 + (phase & 0x9f),
        40 + ((phase >>> 8) & 0x9f),
        40 + ((phase >>> 16) & 0x9f),
        230,
      );
      graphics.roundRect(baseX + dx - size / 2, baseY + dy - size / 2, size, size, 8);
      graphics.fill();
    }
  }

  private startTouches(config: ReplayTrafficRunConfig): void {
    const tapsPerSecond = config.replay.tapsPerSecond || 0;
    if (config.replay.touchPrivacy !== 'show' || tapsPerSecond === 0) return;
    let sequence = 0;
    this.touchTimer = setInterval(() => {
      const x = 120 + ((sequence * 83) % 720);
      const y = 100 + ((sequence * 47) % 420);
      sequence += 1;
      const tapId = sequence;
      emitTouch(Input.EventType.TOUCH_START, tapId, x, y);
      setTimeout(() => emitTouch(Input.EventType.TOUCH_END, tapId, x, y), 20);
    }, 1000 / tapsPerSecond);
  }

  private drawPanel(parent: Node, name: string, x: number, y: number, width: number, height: number, color: Color): Node {
    const node = new Node(name);
    node.layer = Layers.Enum.UI_2D;
    parent.addChild(node);
    node.setPosition(x, y);
    node.addComponent(UITransform).setContentSize(width, height);
    const graphics = node.addComponent(Graphics);
    graphics.fillColor = color;
    graphics.roundRect(-width / 2, -height / 2, width, height, Math.min(18, height / 4));
    graphics.fill();
    return node;
  }

  private label(parent: Node, text: string, x: number, y: number, width: number, height: number, fontSize: number, color: Color): Label {
    const node = new Node(`Label-${text.slice(0, 18)}`);
    node.layer = Layers.Enum.UI_2D;
    parent.addChild(node);
    node.setPosition(x, y);
    node.addComponent(UITransform).setContentSize(width, height);
    const label = node.addComponent(Label);
    label.string = text;
    label.fontSize = fontSize;
    label.lineHeight = Math.ceil(fontSize * 1.3);
    label.color = color;
    label.horizontalAlign = Label.HorizontalAlign.CENTER;
    label.verticalAlign = Label.VerticalAlign.CENTER;
    label.overflow = Label.Overflow.SHRINK;
    return label;
  }

  private setStatus(text: string, color: Color): void {
    if (!this.status?.node.isValid) return;
    this.status.string = text;
    this.status.color = color;
  }

  private validatePlatform(config: ReplayTrafficRunConfig): void {
    const actual = sys.os === sys.OS.ANDROID ? 'android' : sys.os === sys.OS.IOS ? 'ios' : undefined;
    if (!actual || actual !== config.platform) {
      throw new Error(`Configured platform ${config.platform} does not match ${actual || sys.os}`);
    }
  }

  private request<T = unknown>(method: string, route: string, body?: unknown): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open(method, `${this.controlUrl}${route}`, true);
      request.timeout = 15_000;
      if (body !== undefined) request.setRequestHeader('content-type', 'application/json');
      request.onload = () => {
        if (request.status < 200 || request.status >= 300) {
          reject(new Error(`${method} ${route} failed (${request.status})`));
          return;
        }
        try {
          resolve(JSON.parse(request.responseText || '{}') as T);
        } catch (error) {
          reject(error);
        }
      };
      request.onerror = () => reject(new Error(`${method} ${route} network error`));
      request.ontimeout = () => reject(new Error(`${method} ${route} timed out`));
      request.send(body === undefined ? null : JSON.stringify(body));
    });
  }

  private delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }
}

function replayConfig(config: ReplayTrafficRunConfig['replay']): ReplayTrafficRunConfig['replay'] {
  const { tapsPerSecond: _tapsPerSecond, ...replay } = config;
  return replay;
}

function readBootstrap(): ReplayTrafficBootstrap {
  try {
    const value = callNative('replayTrafficBenchmarkConfig');
    return typeof value === 'string' ? JSON.parse(value) as ReplayTrafficBootstrap : { enabled: false };
  } catch {
    return { enabled: false };
  }
}

function prepareNativeBenchmark(config: ReplayTrafficRunConfig): void {
  callNative('prepareReplayTrafficBenchmark', JSON.stringify({
    runId: config.runId,
    groupId: config.groupId,
    scenario: config.scenario,
    repeat: config.repeat,
  }));
}

function flushNativeBenchmark(): void {
  callNative('flushReplayTrafficBenchmark');
}

function callNative(method: string, argument?: string): unknown {
  const call = native.reflection.callStaticMethod as (...values: unknown[]) => unknown;
  if (sys.os === sys.OS.ANDROID) {
    if (argument === undefined) {
      const signature = method === 'replayTrafficBenchmarkConfig' ? '()Ljava/lang/String;' : '()V';
      return call('com/cloudcare/cocos/sample/HybridSampleSdk', method, signature);
    }
    return call('com/cloudcare/cocos/sample/HybridSampleSdk', method, '(Ljava/lang/String;)V', argument);
  }
  return argument === undefined
    ? call('HybridSampleSDK', method)
    : call('HybridSampleSDK', `${method}:`, argument);
}

function emitTouch(eventName: string, id: number, x: number, y: number): void {
  const touch = new Touch(x, y, id);
  const event = new EventTouch([touch], false, eventName as Input.EventType, eventName === Input.EventType.TOUCH_END ? [] : [touch]);
  event.simulate = true;
  (input as unknown as { _dispatchEventTouch(value: EventTouch): void })._dispatchEventTouch(event);
}

function hash(seed: number, index: number, frame: number): number {
  let value = (seed ^ Math.imul(index + 1, 0x9e3779b1) ^ Math.imul(frame + 1, 0x85ebca6b)) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return (value ^ (value >>> 16)) >>> 0;
}
