import {
  _decorator,
  Button,
  Camera,
  Canvas,
  Color,
  Component,
  EditBox,
  Graphics,
  JsonAsset,
  Label,
  Layers,
  Node,
  Scene,
  Texture2D,
  UIOpacity,
  UITransform,
  Vec3,
  director,
  resources,
  sys,
  tween,
  view,
} from 'cc';
import { guanceSdk, setReplayCamera } from '@cloudcare/cocos-sdk/creator3';
import {
  DiagnosticGameState,
  snapshotAttributes,
  type DiagnosticAttributes,
  type DiagnosticFaultContext,
  type DiagnosticPendingFault,
  type DiagnosticRole,
} from '../shared/DiagnosticGameState';
import { enterCocos } from './SdkBootstrap';

const { ccclass, property } = _decorator;

const COLORS = {
  background: new Color(12, 18, 34, 255),
  panel: new Color(24, 34, 57, 245),
  panelAlt: new Color(34, 47, 73, 245),
  primary: new Color(44, 202, 178, 255),
  warning: new Color(245, 166, 35, 255),
  danger: new Color(236, 83, 103, 255),
  info: new Color(73, 142, 245, 255),
  text: new Color(239, 244, 255, 255),
  muted: new Color(151, 164, 190, 255),
};

let activeSample: Creator3DiagnosticSample | undefined;

/**
 * Attach this component to an otherwise empty startup scene. The sample then
 * creates real Login/Lobby/Battle/Result scenes so automatic View tracking and
 * Session Replay observe the same transitions that a game user sees.
 */
@ccclass('DiagnosticSample')
export class DiagnosticSample extends Component {
  @property({ tooltip: 'Attach to the SDK initialized by the native host and enter the Cocos runtime.' })
  autoEnterCocos = true;

  @property({ tooltip: 'Stable ID used to correlate repeated diagnostic runs.' })
  sampleUserId = 'cocos-demo-001';

  start(): void {
    if (activeSample) return;
    if (this.autoEnterCocos) enterCocos();
    activeSample = new Creator3DiagnosticSample(this.sampleUserId);
    activeSample.start();
  }
}

class Creator3DiagnosticSample {
  private readonly state = new DiagnosticGameState();
  private selectedRole: DiagnosticRole | null = null;
  private resourceSequence = 0;
  private interactionLocked = false;
  private networkRequestInFlight = false;
  private animationSequence = 0;
  private battleRoot?: Node;
  private playerNode?: Node;
  private statusLabel?: Label;
  private eventLabel?: Label;

  constructor(private readonly sampleUserId: string) {}

  start(): void {
    this.showLogin();
  }

  private showLogin(): void {
    this.runScene('LoginScene', (root) => {
      this.drawPageBackground(root, 'Login and Role Selection', 'Every step stays in one RUM Session, with Replay preserving visual state');
      const card = this.panel(root, 'login_card', 0, -20, 780, 440, COLORS.panel);
      this.label(card, 'Account (Replay masks input nodes by default)', -310, 165, 420, 24, 18, COLORS.muted);
      const inputNode = this.panel(card, 'user_id_input', -110, 120, 410, 54, COLORS.panelAlt);
      const editBox = inputNode.addComponent(EditBox);
      editBox.string = this.sampleUserId;
      editBox.placeholder = 'Enter player ID';
      editBox.textLabel = this.label(inputNode, this.sampleUserId, 0, 0, 370, 30, 20, COLORS.text, Label.HorizontalAlign.LEFT);

      this.label(card, 'Select a role', -310, 70, 200, 24, 18, COLORS.muted);
      const roleStatus = this.label(card, `Current role: ${roleName(this.selectedRole)}`, 0, -72, 360, 24, 17, COLORS.muted);
      const roles: Array<{ role: DiagnosticRole; title: string; detail: string }> = [
        { role: 'knight', title: 'Knight', detail: 'Melee / High HP' },
        { role: 'ranger', title: 'Ranger', detail: 'Ranged / High Mobility' },
        { role: 'mage', title: 'Mage', detail: 'Magic / High Burst' },
      ];
      roles.forEach((item, index) => {
        const selected = item.role === this.selectedRole;
        this.button(
          card,
          `role_${item.role}`,
          `${selected ? '✓ ' : ''}${item.title}\n${item.detail}`,
          -250 + index * 250,
          0,
          215,
          82,
          () => {
            this.selectedRole = item.role;
            this.state.selectRole(item.role);
            guanceSdk.rum.addAction('role_selected', 'select', this.state.attributes({ 'role.selected': item.role }));
            guanceSdk.logger.log(`Role selected: ${item.role}`, 'info', this.state.attributes());
            roleStatus.string = `Current role: ${item.title} (selected)`;
            roleStatus.color = COLORS.primary;
          },
          selected ? COLORS.primary : COLORS.info,
        );
      });

      this.button(card, 'login_submit', 'Log In and Enter Level Lobby', 0, -115, 460, 62, () => {
        if (!this.selectedRole) {
          guanceSdk.rum.addAction('login_validation_failed', 'submit', this.state.attributes({ 'validation.reason': 'role_missing' }));
          this.notice(card, 'Select a role first', COLORS.warning);
          return;
        }
        const snapshot = this.state.login(editBox.string || this.sampleUserId);
        guanceSdk.mobile.bindUser({
          userId: snapshot.userId,
          userName: `Fake Cocos ${this.selectedRole} Player`,
          userEmail: `cocos-${this.selectedRole}@example.test`,
          extra: { role: this.selectedRole, sample: 'diagnostic-game' },
        });
        guanceSdk.rum.addAction('login_success', 'submit', this.state.attributes());
        guanceSdk.logger.log('Player logged in', 'info', this.state.attributes());
        this.showLobby();
      }, COLORS.primary);

      this.label(card, 'Scenes, buttons, input masking, and user binding', 0, -185, 650, 24, 16, COLORS.muted);
    });
  }

  private showLobby(): void {
    this.runScene('LobbyScene', (root) => {
      const snapshot = this.state.snapshot();
      this.drawPageBackground(root, 'Level Lobby', `Player ${snapshot.userId} · Role ${roleName(snapshot.role)}`);
      this.label(root, 'Select a level to trigger normal actions and seven diagnostic scenarios', 0, 190, 760, 30, 20, COLORS.text);
      const levels = [
        { id: 1, name: 'Forest Ruins', note: 'Resource loading and basic combat', color: new Color(40, 139, 105, 255) },
        { id: 2, name: 'Lava Fortress', note: 'Rendering and performance faults', color: new Color(190, 86, 50, 255) },
        { id: 3, name: 'Stellar Rift', note: 'Network and compatibility faults', color: new Color(91, 80, 190, 255) },
      ];
      levels.forEach((level, index) => {
        const x = -270 + index * 270;
        const card = this.panel(root, `level_card_${level.id}`, x, 10, 240, 280, COLORS.panel);
        this.panel(card, `level_art_${level.id}`, 0, 62, 190, 100, level.color);
        this.label(card, `Level ${level.id}\n${level.name}`, 0, -18, 200, 64, 24, COLORS.text);
        this.label(card, level.note, 0, -74, 200, 24, 15, COLORS.muted);
        this.button(card, `enter_level_${level.id}`, 'Enter Level', 0, -112, 170, 42, () => this.enterLevel(level.id), COLORS.info);
      });
      this.button(root, 'logout', 'Unbind User and Return to Login', 0, -235, 260, 46, () => {
        guanceSdk.rum.addAction('logout', 'click', this.state.attributes());
        guanceSdk.mobile.unbindUser();
        this.state.reset();
        this.selectedRole = null;
        this.showLogin();
      }, COLORS.panelAlt);
    });
  }

  private enterLevel(levelId: number): void {
    this.state.startLevel(levelId);
    guanceSdk.rum.addAction('level_enter', 'navigation', this.state.attributes({ 'level.requested': levelId }));
    guanceSdk.logger.log(`Entering level ${levelId}`, 'info', this.state.attributes());
    this.showBattle();
  }

  private showBattle(): void {
    this.runScene('BattleScene', (root) => {
      this.battleRoot = root;
      const snapshot = this.state.snapshot();
      this.drawPageBackground(root, `Level ${snapshot.levelId} · ${levelName(snapshot.levelId)}`, 'Operate the character and trigger faults as needed; the status is added to Action, Error, and Log data');

      const arena = this.panel(root, 'battle_arena', -150, 40, 620, 330, levelColor(snapshot.levelId));
      this.drawArena(arena);
      this.statusLabel = this.label(root, '', 205, 140, 300, 190, 16, COLORS.text, Label.HorizontalAlign.LEFT);
      this.eventLabel = this.label(root, 'Loading level resources...', 205, 42, 300, 56, 16, COLORS.warning, Label.HorizontalAlign.LEFT);

      this.button(root, 'move_left', '← Move Left', -380, -168, 120, 44, () => this.move(-1), COLORS.info);
      this.button(root, 'attack', 'Attack / Intermittent', -235, -168, 150, 44, () => this.attack(), COLORS.primary);
      this.button(root, 'move_right', 'Move Right →', -75, -168, 120, 44, () => this.move(1), COLORS.info);
      this.button(root, 'complete_level', 'Complete Level', 70, -168, 130, 44, () => this.completeLevel(), COLORS.primary);
      this.button(root, 'exit_level', 'Exit Level', 365, -220, 130, 40, () => this.exitLevel(), COLORS.panelAlt);

      const faults: Array<{ name: string; title: string; action: () => void; color: Color }> = [
        { name: 'fault_business', title: 'Business Logic', action: () => this.triggerBusinessFault(), color: COLORS.danger },
        { name: 'fault_resource', title: 'Resource 404', action: () => this.triggerResourceFault(), color: COLORS.warning },
        { name: 'fault_render', title: 'Rendering Fault', action: () => this.triggerRenderingFault(), color: COLORS.danger },
        { name: 'fault_network', title: 'Network Failure', action: () => this.triggerNetworkFault(), color: COLORS.warning },
        { name: 'fault_device', title: 'Device Compatibility', action: () => this.triggerCompatibilityFault(), color: COLORS.info },
        { name: 'fault_long_task', title: 'Main Thread Stall', action: () => this.triggerLongTask(), color: COLORS.danger },
      ];
      faults.forEach((fault, index) => {
        const column = index % 3;
        const row = Math.floor(index / 3);
        this.button(root, fault.name, fault.title, 238 + column * 115, -66 - row * 57, 104, 42, fault.action, fault.color);
      });
      this.label(root, 'Controlled Faults', 208, -22, 300, 24, 16, COLORS.muted, Label.HorizontalAlign.LEFT);
      this.refreshBattleStatus();
      this.trackInitialLevelResource();
    });
  }

  private drawArena(arena: Node): void {
    const grid = arena.addComponent(Graphics);
    grid.strokeColor = new Color(255, 255, 255, 35);
    grid.lineWidth = 1;
    for (let x = -280; x <= 280; x += 70) {
      grid.moveTo(x, -140);
      grid.lineTo(x, 140);
    }
    for (let y = -140; y <= 140; y += 70) {
      grid.moveTo(-280, y);
      grid.lineTo(280, y);
    }
    grid.stroke();

    this.playerNode = new Node('player_avatar');
    this.playerNode.layer = Layers.Enum.UI_2D;
    arena.addChild(this.playerNode);
    this.playerNode.setPosition(this.playerArenaX(), -35);
    const player = this.playerNode.addComponent(Graphics);
    player.fillColor = COLORS.primary;
    player.circle(0, 0, 30);
    player.fill();
    player.fillColor = COLORS.text;
    player.circle(-10, 8, 4);
    player.circle(10, 8, 4);
    player.fill();
    this.label(this.playerNode, roleGlyph(this.state.snapshot().role), 0, -52, 100, 24, 16, COLORS.text);

    const boss = new Node('level_boss');
    boss.layer = Layers.Enum.UI_2D;
    arena.addChild(boss);
    boss.setPosition(220, 35);
    const bossGraphics = boss.addComponent(Graphics);
    bossGraphics.fillColor = COLORS.danger;
    bossGraphics.roundRect(-42, -42, 84, 84, 12);
    bossGraphics.fill();
    this.label(boss, 'BOSS', 0, 0, 80, 24, 15, COLORS.text);
    tween(boss).repeatForever(tween().to(0.8, { scale: new Vec3(1.08, 1.08, 1) }).to(0.8, { scale: Vec3.ONE })).start();
  }

  private move(direction: -1 | 1): void {
    if (!this.isBattleReady()) return;
    const snapshot = this.state.move(direction);
    const animationToken = ++this.animationSequence;
    guanceSdk.rum.addAction(direction < 0 ? 'player_move_left' : 'player_move_right', 'game_control', this.state.attributes());
    guanceSdk.logger.log(`Player moved to x=${snapshot.playerX}`, 'info', this.state.attributes());
    if (this.playerNode) {
      tween(this.playerNode).to(0.22, { position: new Vec3(this.playerArenaX(), -35, 0) }).call(() => {
        const current = this.state.snapshot();
        if (animationToken === this.animationSequence
          && current.scene === 'BattleScene' && current.phase === 'playing' && current.animation === 'run') {
          this.state.setAnimation('idle');
        }
        this.refreshBattleStatus();
      }).start();
    }
    this.showEvent(`Moved to (${snapshot.playerX}, ${snapshot.playerY})`, COLORS.info);
    this.refreshBattleStatus();
  }

  private attack(): void {
    if (!this.isBattleReady()) return;
    const result = this.state.attack();
    const animationToken = ++this.animationSequence;
    if (this.playerNode) {
      tween(this.playerNode).to(0.09, { scale: new Vec3(1.25, 0.8, 1) }).to(0.12, { scale: Vec3.ONE }).start();
    }
    if (result.shouldTriggerIntermittentFault) {
      const pending = this.state.prepareFault('intermittent');
      guanceSdk.rum.addAction('player_attack', 'game_control', this.state.attributes({
        'attack.combo': result.snapshot.intermittentAttempt,
        'fault.id': pending.id,
        'fault.kind': pending.kind,
      }));
      const fault = this.state.completeFault(pending, () => { this.state.damage(17); });
      this.reportError(fault, 'The third consecutive attack triggered an intermittent state race', 'game_state_race');
      this.showEvent(`Reproduced intermittent fault ${fault.id} (triggered every third attack)`, COLORS.danger);
    } else {
      guanceSdk.rum.addAction('player_attack', 'game_control', this.state.attributes({ 'attack.combo': result.snapshot.intermittentAttempt }));
      this.showEvent(`Attack succeeded; ${3 - (result.snapshot.intermittentAttempt % 3)} more attack(s) reproduce the intermittent fault`, COLORS.primary);
      setTimeout(() => {
        const current = this.state.snapshot();
        if (animationToken === this.animationSequence
          && current.scene === 'BattleScene' && current.phase === 'playing' && current.animation === 'attack') {
          this.state.setAnimation('idle');
        }
        this.refreshBattleStatus();
      }, 220);
    }
    this.refreshBattleStatus();
  }

  private triggerBusinessFault(): void {
    if (!this.isBattleReady()) return;
    const pending = this.beginFault('business_logic', 'trigger_business_fault');
    const fault = this.state.completeFault(pending, () => { this.state.damage(25); });
    this.reportError(fault, 'The combat state machine received an invalid skill cooldown state', 'business_logic_error');
    this.showEvent(`Business fault ${fault.id}: HP was reduced unexpectedly`, COLORS.danger);
    this.refreshBattleStatus();
  }

  private triggerResourceFault(): void {
    if (!this.isBattleReady()) return;
    this.interactionLocked = true;
    const pending = this.beginFault('resource_load', 'trigger_resource_fault');
    const key = this.nextResourceKey('missing-texture');
    const started = nowNs();
    const missingPath = `__ft_diagnostic__/level-${this.state.snapshot().levelId}/boss-texture`;
    guanceSdk.rum.startResource(key, this.state.attributes({
      'resource.kind': 'texture',
      'resource.loader': 'cc.resources.load',
      'fault.id': pending.id,
      'fault.kind': pending.kind,
    }));
    this.showEvent('Calling Cocos resources.load for a missing texture...', COLORS.warning);
    let completed = false;
    const finish = (loadError: Error | null): void => {
      if (completed) return;
      completed = true;
      this.interactionLocked = false;
      const fault = this.state.completeFault(pending, () => {
        this.state.setResourceState('failed');
        this.state.setVisualState('missing_asset');
      });
      if (this.playerNode?.isValid) {
        const opacity = this.playerNode.getComponent(UIOpacity) || this.playerNode.addComponent(UIOpacity);
        opacity.opacity = 120;
      }
      guanceSdk.rum.stopResource(key, fault.attributes);
      guanceSdk.rum.addResource(key, {
        url: `game://assets/${missingPath}.png`,
        httpMethod: 'GET',
        statusCode: 404,
        responseContentType: 'image/png',
        responseBody: String(loadError || 'Cocos resource loader returned no asset'),
      }, { fetchStartTime: started, responseStartTime: nowNs(), responseEndTime: nowNs() });
      this.reportError(fault, 'The level boss texture failed to load through the Cocos resource loader', 'resource_load_error');
      this.showEvent(`Resource fault ${fault.id}: the real load failure is linked to Resource 404`, COLORS.warning);
      this.refreshBattleStatus();
    };
    resources.load(missingPath, Texture2D, (loadError) => finish(loadError));
    setTimeout(() => finish(new Error('Cocos resource load timed out after 2000ms')), 2000);
  }

  private triggerNetworkFault(): void {
    if (this.networkRequestInFlight) {
      this.showEvent('A network diagnostic request is still waiting for the native request to finish', COLORS.warning);
      return;
    }
    if (!this.isBattleReady()) return;
    this.interactionLocked = true;
    this.networkRequestInFlight = true;
    const pending = this.beginFault('network', 'trigger_network_fault');
    const key = this.nextResourceKey('battle-api');
    const url = 'https://game.example.invalid/api/battle/sync';
    const started = nowNs();
    const traceHeaders = {
      ...guanceSdk.trace.getHeaders(url, key),
      'content-type': 'application/json',
      'x-ft-fault-id': pending.id,
    };
    guanceSdk.rum.startResource(key, this.state.attributes({
      'network.request': 'battle_sync',
      'fault.id': pending.id,
      'fault.kind': pending.kind,
    }));
    this.showEvent('Sending a real request to the reserved .invalid domain...', COLORS.warning);
    let completed = false;
    const finish = (statusCode: number, detail: string): void => {
      if (completed) return;
      completed = true;
      this.interactionLocked = false;
      const fault = this.state.completeFault(pending, () => { this.state.setNetworkState('offline'); });
      guanceSdk.rum.stopResource(key, fault.attributes);
      guanceSdk.rum.addResource(key, {
        url,
        httpMethod: 'POST',
        requestHeaders: traceHeaders,
        statusCode,
        responseContentType: 'application/json',
        responseBody: detail,
      }, { fetchStartTime: started, responseStartTime: nowNs(), responseEndTime: nowNs() });
      this.reportError(fault, `Battle synchronization request failed (status ${statusCode})`, 'network_error');
      this.showEvent(`Network fault ${fault.id}: request, Trace, Resource, and Error are linked`, COLORS.warning);
      this.refreshBattleStatus();
    };
    if (typeof fetch !== 'function') {
      this.networkRequestInFlight = false;
      finish(0, 'fetch is unavailable on this runtime');
      return;
    }
    const controller = typeof AbortController === 'function' ? new AbortController() : undefined;
    fetch(url, { method: 'POST', headers: traceHeaders, body: '{"action":"sync"}', signal: controller?.signal })
      .then((response) => {
        this.networkRequestInFlight = false;
        finish(response.status, `unexpected response: ${response.status}`);
      })
      .catch((error) => {
        this.networkRequestInFlight = false;
        finish(0, String(error));
      });
    setTimeout(() => {
      finish(504, 'network timeout after 1500ms');
      controller?.abort();
    }, 1500);
  }

  private triggerRenderingFault(): void {
    if (!this.isBattleReady()) return;
    this.interactionLocked = true;
    const pending = this.beginFault('rendering', 'trigger_rendering_fault');
    const fault = this.state.completeFault(pending, () => {
      this.state.setAnimation('corrupted-frame');
      this.state.setVisualState('distorted');
    });
    if (this.playerNode) {
      this.playerNode.setScale(2.1, 0.25, 1);
      const graphics = this.playerNode.getComponent(Graphics);
      if (graphics) graphics.fillColor = new Color(255, 0, 220, 255);
    }
    this.reportError(fault, 'The character skeletal animation produced an invalid frame index', 'rendering_error');
    this.showEvent(`Rendering fault ${fault.id}: Replay shows the character distortion`, COLORS.danger);
    this.refreshBattleStatus();
    setTimeout(() => {
      this.interactionLocked = false;
      if (this.playerNode?.isValid) this.playerNode.setScale(1, 1, 1);
      const current = this.state.snapshot();
      if (current.scene === 'BattleScene' && current.visualState === 'distorted') {
        this.state.setAnimation('idle');
        this.state.setVisualState('normal');
      }
      this.refreshBattleStatus();
    }, 1400);
  }

  private triggerCompatibilityFault(): void {
    if (!this.isBattleReady()) return;
    this.interactionLocked = true;
    const pending = this.beginFault('device_compatibility', 'trigger_compatibility_fault');
    const device = director.root?.device;
    const maxTextureSize = device?.capabilities.maxTextureSize || 0;
    const requestedTextureSize = maxTextureSize > 0 ? maxTextureSize + 1 : 32768;
    const fault = this.state.completeFault(pending, () => {
      this.state.setAnimation('hit');
      this.state.setVisualState('compatibility_fallback');
    });
    if (this.playerNode) this.playerNode.setScale(0.82, 0.82, 1);
    const deviceAttributes: DiagnosticAttributes = {
      ...fault.attributes,
      'device.os': String(sys.os),
      'device.os_version': String(sys.osVersion || 'unknown'),
      'device.platform': String(sys.platform),
      'device.is_native': sys.isNative,
      'device.gfx_api': String(device?.gfxAPI ?? 'unknown'),
      'device.gpu_renderer': device?.renderer || 'unknown',
      'device.gpu_vendor': device?.vendor || 'unknown',
      'device.max_texture_size': maxTextureSize,
      'compat.requested_texture_size': requestedTextureSize,
      'compat.supported': maxTextureSize >= requestedTextureSize,
    };
    const message = `Requested texture size ${requestedTextureSize} exceeds device limit ${maxTextureSize || 'unknown'}`;
    this.reportError({ ...fault, attributes: deviceAttributes }, message, 'device_compatibility_error');
    this.showEvent(`Compatibility fault ${fault.id}: the actual GPU capability limit was recorded`, COLORS.info);
    this.refreshBattleStatus();
    setTimeout(() => {
      this.interactionLocked = false;
      if (this.playerNode?.isValid) this.playerNode.setScale(1, 1, 1);
      const current = this.state.snapshot();
      if (current.scene === 'BattleScene' && current.visualState === 'compatibility_fallback') {
        this.state.setAnimation('idle');
        this.state.setVisualState('normal');
      }
      this.refreshBattleStatus();
    }, 1400);
  }

  private triggerLongTask(): void {
    if (!this.isBattleReady()) return;
    const pending = this.beginFault('long_task', 'trigger_long_task');
    const fault = this.state.completeFault(pending, () => { this.state.setAnimation('hit'); });
    const started = Date.now();
    while (Date.now() - started < 320) {
      Math.sqrt((Date.now() - started) * 13);
    }
    const durationMs = Date.now() - started;
    const attributes = { ...fault.attributes, 'long_task.duration_ms': durationMs };
    guanceSdk.rum.addLongTask('DiagnosticSample.triggerLongTask', durationMs * 1_000_000, attributes);
    guanceSdk.logger.log(`Simulated main-thread stall: ${durationMs}ms`, 'warning', attributes);
    this.showEvent(`${durationMs}ms stall: frozen animation and LongTask are visible together`, COLORS.danger);
    this.state.setAnimation('idle');
    this.refreshBattleStatus();
  }

  private completeLevel(): void {
    if (!this.isBattleReady()) return;
    const before = this.state.snapshot();
    this.state.completeLevel();
    guanceSdk.rum.addAction('level_complete', 'game_progress', {
      ...snapshotAttributes(before, 'before'),
      ...this.state.attributes(),
    });
    guanceSdk.logger.log('Level completed', 'info', this.state.attributes());
    this.showResult();
  }

  private exitLevel(): void {
    if (this.interactionLocked) {
      this.showEvent('A diagnostic request is finishing; exit again shortly', COLORS.warning);
      return;
    }
    const before = this.state.snapshot();
    this.state.returnToLobby();
    guanceSdk.rum.addAction('exit_level', 'navigation', {
      ...snapshotAttributes(before, 'before'),
      ...this.state.attributes(),
    });
    this.showLobby();
  }

  private showResult(): void {
    this.runScene('ResultScene', (root) => {
      const snapshot = this.state.snapshot();
      this.drawPageBackground(root, 'Level Complete', 'ResultScene keeps the previous level\'s Action, Error, and Resource data in the same Session');
      const card = this.panel(root, 'result_card', 0, 10, 620, 330, COLORS.panel);
      this.label(card, '✓', 0, 92, 90, 70, 60, COLORS.primary);
      this.label(card, `Level ${snapshot.levelId} Results`, 0, 28, 420, 40, 30, COLORS.text);
      this.label(card, `Role ${roleName(snapshot.role)}   Score ${snapshot.score}   Remaining HP ${snapshot.hp}`, 0, -30, 520, 28, 20, COLORS.muted);
      this.button(card, 'return_lobby', 'Return to Lobby and Compare', 0, -102, 280, 54, () => {
        this.state.returnToLobby();
        guanceSdk.rum.addAction('return_to_lobby', 'navigation', this.state.attributes());
        this.showLobby();
      }, COLORS.primary);
    });
  }

  private trackInitialLevelResource(): void {
    const key = this.nextResourceKey('level-manifest');
    const started = nowNs();
    const path = 'diagnostic-level';
    guanceSdk.rum.startResource(key, this.state.attributes({
      'resource.kind': 'level_manifest',
      'resource.loader': 'cc.resources.load',
    }));
    let completed = false;
    const finish = (loadError: Error | null, asset?: JsonAsset): void => {
      if (completed) return;
      completed = true;
      if (!this.battleRoot?.isValid || this.state.snapshot().scene !== 'BattleScene') {
        guanceSdk.rum.stopResource(key, { 'resource.cancelled': true });
        return;
      }
      if (loadError || !asset) {
        const pending = this.state.prepareFault('resource_load');
        const fault = this.state.completeFault(pending, () => { this.state.markLevelLoadFailed(); });
        guanceSdk.rum.stopResource(key, fault.attributes);
        guanceSdk.rum.addResource(key, {
          url: `game://assets/resources/${path}.json`,
          httpMethod: 'GET',
          statusCode: 500,
          responseContentType: 'application/json',
          responseBody: String(loadError || 'manifest asset missing'),
        }, { fetchStartTime: started, responseStartTime: nowNs(), responseEndTime: nowNs() });
        this.reportError(fault, 'The initial level manifest failed to load', 'resource_load_error');
        this.showEvent('Initial level resources failed to load; return to the lobby and retry', COLORS.danger);
        this.refreshBattleStatus();
        return;
      }
      this.state.markLevelReady();
      guanceSdk.rum.stopResource(key, this.state.attributes());
      guanceSdk.rum.addResource(key, {
        url: `game://assets/resources/${path}.json`,
        httpMethod: 'GET',
        statusCode: 200,
        responseContentType: 'application/json',
        responseBody: JSON.stringify(asset.json),
      }, { fetchStartTime: started, responseStartTime: nowNs(), responseEndTime: nowNs() });
      guanceSdk.logger.log('Level resources loaded', 'info', this.state.attributes());
      this.showEvent('Level resources loaded; controls are ready', COLORS.primary);
      this.refreshBattleStatus();
    };
    resources.load(path, JsonAsset, (error, asset) => finish(error, asset));
    setTimeout(() => finish(new Error('Cocos resource load timed out after 2000ms')), 2000);
  }

  private beginFault(kind: DiagnosticPendingFault['kind'], actionName: string): DiagnosticPendingFault {
    this.state.recordAction(actionName);
    const pending = this.state.prepareFault(kind);
    guanceSdk.rum.addAction(actionName, 'diagnostic', this.state.attributes({
      'fault.id': pending.id,
      'fault.kind': pending.kind,
    }));
    return pending;
  }

  private reportError(fault: DiagnosticFaultContext, message: string, type: string): void {
    guanceSdk.logger.log(`[before] ${message}`, 'warning', {
      'fault.id': fault.id,
      'fault.kind': fault.kind,
      ...snapshotAttributes(fault.before, 'game'),
    });
    guanceSdk.rum.addError(message, new Error(message).stack || '', type, 'run', fault.attributes);
    guanceSdk.logger.log(`[after] ${message}`, 'error', {
      'fault.id': fault.id,
      'fault.kind': fault.kind,
      ...snapshotAttributes(fault.after, 'game'),
    });
  }

  private isBattleReady(): boolean {
    if (this.state.snapshot().phase === 'playing' && !this.interactionLocked) return true;
    this.showEvent(this.interactionLocked ? 'A diagnostic request is finishing; try again shortly' : 'Level resources are still loading; try again shortly', COLORS.warning);
    return false;
  }

  private refreshBattleStatus(): void {
    if (!this.statusLabel?.isValid) return;
    const state = this.state.snapshot();
    this.statusLabel.string = [
      `Scene   ${state.scene}`,
      `Level   ${state.levelId} / Wave ${state.wave}`,
      `Role    ${roleName(state.role)}`,
      `HP      ${state.hp}    Score ${state.score}`,
      `Anim    ${state.animation}`,
      `Asset   ${state.resourceState}`,
      `Network ${state.networkState}`,
      `Visual  ${state.visualState}`,
      `Input # ${state.inputSequence}`,
    ].join('\n');
  }

  private showEvent(text: string, color: Color): void {
    if (!this.eventLabel?.isValid) return;
    this.eventLabel.string = text;
    this.eventLabel.color = color;
  }

  private playerArenaX(): number {
    return -270 + (this.state.snapshot().playerX / 100) * 430;
  }

  private nextResourceKey(name: string): string {
    this.resourceSequence += 1;
    return `diagnostic-${name}-${Date.now().toString(36)}-${this.resourceSequence}`;
  }

  private runScene(name: string, render: (root: Node) => void): void {
    const scene = new Scene(name);
    const cameraNode = new Node('ReplayCamera');
    cameraNode.layer = Layers.Enum.UI_2D;
    scene.addChild(cameraNode);
    cameraNode.setPosition(0, 0, 1000);
    const camera = cameraNode.addComponent(Camera);
    camera.projection = Camera.ProjectionType.ORTHO;
    camera.orthoHeight = Math.max(320, view.getVisibleSize().height / 2);
    camera.visibility = Layers.Enum.UI_2D;
    camera.clearColor = COLORS.background;

    const canvasNode = new Node('Canvas');
    canvasNode.layer = Layers.Enum.UI_2D;
    scene.addChild(canvasNode);
    const canvasTransform = canvasNode.addComponent(UITransform);
    canvasTransform.setContentSize(960, 640);
    const canvas = canvasNode.addComponent(Canvas);
    canvas.cameraComponent = camera;

    const root = new Node('DiagnosticUI');
    root.layer = Layers.Enum.UI_2D;
    canvasNode.addChild(root);
    root.addComponent(UITransform).setContentSize(960, 640);
    director.runSceneImmediate(scene);
    setReplayCamera(camera);
    render(root);
  }

  private drawPageBackground(root: Node, title: string, subtitle: string): void {
    this.panel(root, 'page_background', 0, 0, 960, 640, COLORS.background).setSiblingIndex(0);
    this.label(root, title, -420, 266, 840, 48, 34, COLORS.text, Label.HorizontalAlign.LEFT);
    this.label(root, subtitle, -420, 228, 840, 28, 16, COLORS.muted, Label.HorizontalAlign.LEFT);
    this.panel(root, 'header_accent', -448, 267, 6, 50, COLORS.primary);
  }

  private panel(parent: Node, name: string, x: number, y: number, width: number, height: number, color: Color): Node {
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

  private button(
    parent: Node,
    name: string,
    text: string,
    x: number,
    y: number,
    width: number,
    height: number,
    onClick: () => void,
    color: Color,
  ): Node {
    const node = this.panel(parent, name, x, y, width, height, color);
    node.addComponent(Button);
    node.on(Button.EventType.CLICK, onClick);
    this.label(node, text, 0, 0, width - 12, height - 4, Math.min(18, height / 2.5), COLORS.text);
    return node;
  }

  private label(
    parent: Node,
    text: string,
    x: number,
    y: number,
    width: number,
    height: number,
    fontSize: number,
    color: Color,
    alignment = Label.HorizontalAlign.CENTER,
  ): Label {
    const node = new Node(`label_${text.slice(0, 16)}`);
    node.layer = Layers.Enum.UI_2D;
    parent.addChild(node);
    node.setPosition(x, y);
    node.addComponent(UITransform).setContentSize(width, height);
    const label = node.addComponent(Label);
    label.string = text;
    label.fontSize = fontSize;
    label.lineHeight = Math.ceil(fontSize * 1.25);
    label.color = color;
    label.horizontalAlign = alignment;
    label.verticalAlign = Label.VerticalAlign.CENTER;
    label.overflow = Label.Overflow.SHRINK;
    return label;
  }

  private notice(parent: Node, text: string, color: Color): void {
    const label = this.label(parent, text, 0, -155, 400, 28, 18, color);
    setTimeout(() => {
      if (label.node.isValid) label.node.destroy();
    }, 1200);
  }
}

function nowNs(): number {
  return Date.now() * 1_000_000;
}

function roleName(role: DiagnosticRole | null): string {
  if (role === 'knight') return 'Knight';
  if (role === 'ranger') return 'Ranger';
  if (role === 'mage') return 'Mage';
  return 'Not Selected';
}

function roleGlyph(role: DiagnosticRole | null): string {
  if (role === 'knight') return 'KNIGHT';
  if (role === 'ranger') return 'RANGER';
  if (role === 'mage') return 'MAGE';
  return 'PLAYER';
}

function levelName(levelId: number): string {
  return ['Unknown Area', 'Forest Ruins', 'Lava Fortress', 'Stellar Rift'][levelId] || 'Unknown Area';
}

function levelColor(levelId: number): Color {
  if (levelId === 1) return new Color(24, 76, 68, 255);
  if (levelId === 2) return new Color(88, 47, 43, 255);
  return new Color(45, 42, 91, 255);
}
