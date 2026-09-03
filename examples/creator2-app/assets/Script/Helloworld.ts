import { guanceSdk, setReplayCamera } from '@cloudcare/cocos-sdk/creator2';
import {
  DiagnosticGameState,
  snapshotAttributes,
  type DiagnosticAttributes,
  type DiagnosticFaultContext,
  type DiagnosticFaultKind,
  type DiagnosticPendingFault,
  type DiagnosticRole,
} from './DiagnosticGameState';
import { enterCocos } from './SdkBootstrap';

const { ccclass, property } = cc._decorator;

const COLORS = {
  background: cc.color(12, 18, 34, 255),
  panel: cc.color(24, 34, 57, 245),
  panelAlt: cc.color(34, 47, 73, 245),
  primary: cc.color(44, 202, 178, 255),
  warning: cc.color(245, 166, 35, 255),
  danger: cc.color(236, 83, 103, 255),
  info: cc.color(73, 142, 245, 255),
  text: cc.color(239, 244, 255, 255),
  muted: cc.color(151, 164, 190, 255),
};

let activeSample: Creator2DiagnosticSample | undefined;

/** Creator 2.4 counterpart of the Creator 3 diagnostic game sample. */
@ccclass
export default class DiagnosticSample extends cc.Component {
  @property({ tooltip: 'Attach to the SDK initialized by the native host and enter the Cocos runtime.' })
  autoEnterCocos = true;

  @property({ tooltip: 'Stable ID used to correlate repeated diagnostic runs.' })
  sampleUserId = 'cocos-demo-001';

  start(): void {
    if (activeSample) return;
    if (this.autoEnterCocos) enterCocos();
    activeSample = new Creator2DiagnosticSample(this.sampleUserId);
    activeSample.start();
  }
}

class Creator2DiagnosticSample {
  private readonly state = new DiagnosticGameState();
  private selectedRole: DiagnosticRole | null = null;
  private resourceSequence = 0;
  private interactionLocked = false;
  private networkRequestInFlight = false;
  private animationSequence = 0;
  private battleRoot?: any;
  private playerNode?: any;
  private enemyNode?: any;
  private playerHpFill?: any;
  private enemyHpFill?: any;
  private enemyHpLabel?: any;
  private statusLabel?: any;
  private eventLabel?: any;
  private battleRunId = 0;

  constructor(private readonly sampleUserId: string) {}

  start(): void {
    this.showLogin();
  }

  private showLogin(): void {
    this.runScene('LoginScene', (root) => {
      this.drawPageBackground(root, 'Login and Role Selection', 'Scene transitions, Actions, and Replay preserve the complete user journey');
      const card = this.panel(root, 'login_card', 0, -20, 780, 440, COLORS.panel);
      this.label(card, 'Account (Replay masks EditBox by default)', -100, 165, 420, 24, 18, COLORS.muted, cc.Label.HorizontalAlign.LEFT);
      const inputNode = this.panel(card, 'user_id_input', -110, 120, 410, 54, COLORS.panelAlt);
      const editBox = inputNode.addComponent(cc.EditBox);
      editBox.string = this.sampleUserId;
      editBox.placeholder = 'Enter player ID';
      editBox.textLabel = this.label(inputNode, this.sampleUserId, 0, 0, 370, 30, 20, COLORS.text, cc.Label.HorizontalAlign.LEFT);

      this.label(card, 'Select a role', -210, 70, 200, 24, 18, COLORS.muted, cc.Label.HorizontalAlign.LEFT);
      const roleStatus = this.label(card, `Current role: ${roleName(this.selectedRole)}`, 0, -72, 360, 24, 17, COLORS.muted);
      const roles: Array<{ role: DiagnosticRole; title: string; detail: string }> = [
        { role: 'knight', title: 'Knight', detail: 'Melee / High HP' },
        { role: 'ranger', title: 'Ranger', detail: 'Ranged / High Mobility' },
        { role: 'mage', title: 'Mage', detail: 'Magic / High Burst' },
      ];
      roles.forEach((item, index) => {
        const selected = item.role === this.selectedRole;
        this.button(card, `role_${item.role}`, `${selected ? '✓ ' : ''}${item.title}\n${item.detail}`,
          -250 + index * 250, 0, 215, 82, () => {
            this.selectedRole = item.role;
            this.state.selectRole(item.role);
            guanceSdk.rum.addAction('role_selected', 'select', this.state.attributes({ 'role.selected': item.role }));
            guanceSdk.logger.log(`Role selected: ${item.role}`, 'info', this.state.attributes());
            roleStatus.string = `Current role: ${item.title} (selected)`;
            roleStatus.node.color = COLORS.primary;
          }, selected ? COLORS.primary : COLORS.info);
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
          userName: `Cocos ${this.selectedRole}`,
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
        { id: 1, name: 'Forest Ruins', note: 'Resource loading and basic combat', color: cc.color(40, 139, 105, 255) },
        { id: 2, name: 'Lava Fortress', note: 'Rendering and performance faults', color: cc.color(190, 86, 50, 255) },
        { id: 3, name: 'Stellar Rift', note: 'Network and compatibility faults', color: cc.color(91, 80, 190, 255) },
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
      this.drawPageBackground(root, `Level ${snapshot.levelId} · ${levelName(snapshot.levelId)}`, 'Move into attack range and defeat three waves; all operations stay in one RUM Session');
      const arena = this.panel(root, 'battle_arena', -150, 40, 620, 330, levelColor(snapshot.levelId));
      this.drawArena(arena);
      this.statusLabel = this.label(root, '', 330, 133, 280, 152, 15, COLORS.text, cc.Label.HorizontalAlign.LEFT);
      this.eventLabel = this.label(root, 'Loading level resources...', 330, 31, 280, 40, 14, COLORS.warning, cc.Label.HorizontalAlign.LEFT);

      this.button(root, 'move_left', '← Move Left', -380, -168, 120, 44, () => this.move(-1), COLORS.info);
      this.button(root, 'attack', 'Attack / Intermittent', -235, -168, 150, 44, () => this.attack(), COLORS.primary);
      this.button(root, 'move_right', 'Move Right →', -75, -168, 120, 44, () => this.move(1), COLORS.info);
      this.button(root, 'heal', 'Heal +30', 70, -168, 130, 44, () => this.heal(), COLORS.primary);
      this.button(root, 'exit_level', 'Exit Level', 365, -220, 130, 40, () => this.exitLevel(), COLORS.panelAlt);

      const faults: Array<{ name: string; title: string; action: () => void; color: any }> = [
        { name: 'fault_business', title: 'Business Logic', action: () => this.triggerFault('business_logic'), color: COLORS.danger },
        { name: 'fault_resource', title: 'Resource 404', action: () => this.triggerResourceFault(), color: COLORS.warning },
        { name: 'fault_render', title: 'Rendering Fault', action: () => this.triggerFault('rendering'), color: COLORS.danger },
        { name: 'fault_network', title: 'Network Failure', action: () => this.triggerNetworkFault(), color: COLORS.warning },
        { name: 'fault_device', title: 'Device Compatibility', action: () => this.triggerFault('device_compatibility'), color: COLORS.info },
        { name: 'fault_long_task', title: 'Main Thread Stall', action: () => this.triggerLongTask(), color: COLORS.danger },
      ];
      faults.forEach((fault, index) => {
        this.button(root, fault.name, fault.title, 220 + (index % 3) * 105, -66 - Math.floor(index / 3) * 57,
          98, 42, fault.action, fault.color);
      });
      this.label(root, 'Controlled Faults (not required to complete)', 330, -22, 280, 24, 15, COLORS.muted, cc.Label.HorizontalAlign.LEFT);
      this.refreshBattleStatus();
      this.trackInitialLevelResource();
    });
  }

  private drawArena(arena: any): void {
    const grid = arena.addComponent(cc.Graphics);
    grid.strokeColor = cc.color(255, 255, 255, 35);
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

    this.playerNode = new cc.Node('player_avatar');
    arena.addChild(this.playerNode);
    this.playerNode.setPosition(this.playerArenaX(), -35);
    const player = this.playerNode.addComponent(cc.Graphics);
    player.fillColor = COLORS.primary;
    player.circle(0, 0, 30);
    player.fill();
    player.fillColor = COLORS.text;
    player.circle(-10, 8, 4);
    player.circle(10, 8, 4);
    player.fill();
    this.label(this.playerNode, roleGlyph(this.state.snapshot().role), 0, -52, 100, 24, 16, COLORS.text);

    this.enemyNode = new cc.Node('level_boss');
    arena.addChild(this.enemyNode);
    this.enemyNode.setPosition(220, 35);
    const bossGraphics = this.enemyNode.addComponent(cc.Graphics);
    bossGraphics.fillColor = COLORS.danger;
    bossGraphics.roundRect(-42, -42, 84, 84, 12);
    bossGraphics.fill();
    this.label(this.enemyNode, 'BOSS', 0, 0, 80, 24, 15, COLORS.text);
    cc.tween(this.enemyNode).repeatForever(cc.tween().to(0.8, { scale: 1.08 }).to(0.8, { scale: 1 })).start();

    this.label(arena, 'PLAYER HP', -215, 145, 150, 20, 13, COLORS.text);
    this.playerHpFill = this.healthBar(arena, 'player_hp', -215, 128, 170, COLORS.primary);
    this.enemyHpLabel = this.label(arena, 'WAVE 1 · ENEMY', 145, 145, 210, 20, 13, COLORS.text);
    this.enemyHpFill = this.healthBar(arena, 'enemy_hp', 145, 128, 210, COLORS.danger);
  }

  private move(direction: -1 | 1): void {
    if (!this.isBattleReady()) return;
    const snapshot = this.state.move(direction);
    const animationToken = ++this.animationSequence;
    guanceSdk.rum.addAction(direction < 0 ? 'player_move_left' : 'player_move_right', 'game_control', this.state.attributes());
    cc.tween(this.playerNode).to(0.22, { position: cc.v3(this.playerArenaX(), -35, 0) }).call(() => {
      const current = this.state.snapshot();
      if (animationToken === this.animationSequence
        && current.scene === 'BattleScene' && current.phase === 'playing' && current.animation === 'run') {
        this.state.setAnimation('idle');
      }
      this.refreshBattleStatus();
    }).start();
    this.showEvent(`Moved to (${snapshot.playerX}, ${snapshot.playerY})`, COLORS.info);
    this.refreshBattleStatus();
  }

  private attack(): void {
    if (!this.isBattleReady()) return;
    const before = this.state.snapshot();
    const attackRange = roleAttackRange(before.role);
    const distance = Math.abs(Number(this.enemyNode?.x || 0) - Number(this.playerNode?.x || 0));
    if (distance > attackRange) {
      this.state.recordAction('attack_out_of_range');
      guanceSdk.rum.addAction('player_attack_missed', 'game_control', this.state.attributes({
        'attack.result': 'out_of_range',
        'attack.distance': Math.round(distance),
        'attack.range': attackRange,
      }));
      cc.tween(this.playerNode).to(0.08, { scaleX: 1.12, scaleY: 0.9 }).to(0.1, { scaleX: 1, scaleY: 1 }).start();
      this.showEvent(`Distance ${Math.round(distance)}; ${roleName(before.role)} attack range is ${attackRange}. Move right first`, COLORS.warning);
      this.refreshBattleStatus();
      return;
    }

    const result = this.state.attack();
    const animationToken = ++this.animationSequence;
    this.animateAttack(before.role);
    const attackAttributes: DiagnosticAttributes = {
      'attack.combo': result.snapshot.intermittentAttempt,
      'attack.damage': result.damage,
      'attack.distance': Math.round(distance),
      'attack.range': attackRange,
      'attack.result': result.enemyDefeated ? 'enemy_defeated' : 'hit',
      'enemy.hp_before': before.enemyHp,
      'enemy.hp_after': result.snapshot.enemyHp,
    };
    if (result.shouldTriggerIntermittentFault) {
      const pending = this.state.prepareFault('intermittent');
      guanceSdk.rum.addAction('player_attack', 'game_control', this.state.attributes({
        ...attackAttributes,
        'fault.id': pending.id,
        'fault.kind': pending.kind,
      }));
      const fault = this.state.completeFault(pending, () => { this.state.damage(17); });
      this.reportError(fault, 'The third consecutive attack triggered an intermittent state race', 'game_state_race');
      this.showEvent(`Dealt ${result.damage} damage and reproduced intermittent fault ${fault.id}`, COLORS.danger);
    } else {
      guanceSdk.rum.addAction('player_attack', 'game_control', this.state.attributes(attackAttributes));
      this.showEvent(result.enemyDefeated
        ? `Defeated wave ${result.snapshot.wave}; score +60`
        : `Hit for ${result.damage} damage; enemy has ${result.snapshot.enemyHp} HP remaining`, COLORS.primary);
      this.afterBattleDelay(220, () => {
        const current = this.state.snapshot();
        if (animationToken === this.animationSequence
          && current.scene === 'BattleScene' && current.phase === 'playing' && current.animation === 'attack') {
          this.state.setAnimation('idle');
        }
        this.refreshBattleStatus();
      });
    }
    this.refreshBattleStatus();
    if (result.enemyDefeated) this.handleEnemyDefeated();
    else this.afterBattleDelay(620, () => this.enemyCounterAttack());
  }

  private heal(): void {
    if (!this.isBattleReady()) return;
    const before = this.state.snapshot();
    if (before.hp >= 100) {
      this.showEvent('HP is full; the heal remains available', COLORS.warning);
      return;
    }
    if (before.healsRemaining <= 0) {
      this.showEvent('The heal was used this wave and resets on the next wave', COLORS.warning);
      return;
    }
    const after = this.state.heal(30);
    guanceSdk.rum.addAction('player_heal', 'game_control', {
      ...snapshotAttributes(before, 'before'),
      ...snapshotAttributes(after, 'after'),
      'heal.amount': after.hp - before.hp,
    });
    cc.tween(this.playerNode).to(0.12, { scale: 1.22 }).to(0.18, { scale: 1 }).start();
    this.showEvent(`Restored ${after.hp - before.hp} HP; ${after.healsRemaining} heal(s) remain this wave`, COLORS.primary);
    this.refreshBattleStatus();
  }

  private animateAttack(role: DiagnosticRole | null): void {
    if (role === 'knight') {
      const originX = Number(this.playerNode?.x || 0);
      cc.tween(this.playerNode)
        .to(0.1, { position: cc.v3(originX + 48, -35, 0), scaleX: 1.25, scaleY: 0.82 })
        .to(0.14, { position: cc.v3(originX, -35, 0), scaleX: 1, scaleY: 1 })
        .start();
      return;
    }
    if (!cc.isValid(this.playerNode) || !cc.isValid(this.enemyNode)) return;
    const projectile = new cc.Node(role === 'mage' ? 'magic_orb' : 'arrow');
    this.playerNode.parent.addChild(projectile);
    projectile.setPosition(this.playerNode.position);
    const graphics = projectile.addComponent(cc.Graphics);
    graphics.fillColor = role === 'mage' ? cc.color(171, 112, 255, 255) : COLORS.warning;
    graphics.circle(0, 0, role === 'mage' ? 13 : 7);
    graphics.fill();
    cc.tween(projectile)
      .to(0.24, { position: cc.v3(this.enemyNode.x, this.enemyNode.y, 0), scale: role === 'mage' ? 1.45 : 1 })
      .call(() => { if (cc.isValid(projectile)) projectile.destroy(); })
      .start();
  }

  private enemyCounterAttack(): void {
    const before = this.state.snapshot();
    if (before.scene !== 'BattleScene' || before.phase !== 'playing' || before.enemyHp <= 0 || this.interactionLocked) return;
    const damage = 8 + before.levelId * 2 + before.wave * 2;
    const after = this.state.enemyAttack(damage);
    guanceSdk.rum.addAction('enemy_attack', 'game_event', {
      ...snapshotAttributes(before, 'before'),
      ...snapshotAttributes(after, 'after'),
      'enemy.damage': damage,
    });
    const enemyOriginX = Number(this.enemyNode?.x || 220);
    cc.tween(this.enemyNode).to(0.1, { position: cc.v3(enemyOriginX - 34, 35, 0) })
      .to(0.14, { position: cc.v3(enemyOriginX, 35, 0) }).start();
    cc.tween(this.playerNode).to(0.06, { scaleX: 0.82, scaleY: 1.18 }).to(0.12, { scaleX: 1, scaleY: 1 }).start();
    this.showEvent(`Enemy counterattack dealt ${damage} damage; player has ${after.hp} HP remaining`, COLORS.danger);
    this.refreshBattleStatus();
    if (after.hp === 0) {
      const defeated = this.state.finishDefeat();
      guanceSdk.rum.addAction('player_defeated', 'game_progress', {
        ...snapshotAttributes(before, 'before'),
        ...snapshotAttributes(defeated, 'after'),
      });
      this.afterBattleDelay(320, () => this.showResult());
      return;
    }
    this.afterBattleDelay(220, () => {
      const current = this.state.snapshot();
      if (current.scene === 'BattleScene' && current.phase === 'playing' && current.animation === 'hit') {
        this.state.setAnimation('idle');
        this.refreshBattleStatus();
      }
    });
  }

  private handleEnemyDefeated(): void {
    const defeated = this.state.snapshot();
    this.interactionLocked = true;
    guanceSdk.rum.addAction('enemy_defeated', 'game_progress', this.state.attributes({
      'wave.completed': defeated.wave,
      'enemy.defeated_count': defeated.enemiesDefeated,
    }));
    cc.tween(this.enemyNode).to(0.28, { opacity: 0, scale: 0.2 }).start();
    this.afterBattleDelay(620, () => {
      if (defeated.wave >= defeated.maxWaves) {
        this.interactionLocked = false;
        this.completeLevel();
        return;
      }
      const next = this.state.advanceWave();
      if (cc.isValid(this.enemyNode)) {
        this.enemyNode.opacity = 255;
        this.enemyNode.setScale(1, 1);
        this.enemyNode.setPosition(220, 35);
      }
      this.interactionLocked = false;
      guanceSdk.rum.addAction('wave_started', 'game_progress', this.state.attributes({ 'wave.started': next.wave }));
      this.showEvent(`Wave ${next.wave}/${next.maxWaves} started: enemy HP ${next.enemyHp}`, COLORS.warning);
      this.refreshBattleStatus();
    });
  }

  private afterBattleDelay(delayMs: number, action: () => void): void {
    const runId = this.battleRunId;
    setTimeout(() => {
      if (runId !== this.battleRunId || !cc.isValid(this.battleRoot)) return;
      action();
    }, delayMs);
  }

  private triggerFault(kind: DiagnosticFaultKind): void {
    if (!this.isBattleReady()) return;
    if (kind === 'rendering' || kind === 'device_compatibility') this.interactionLocked = true;
    const pending = this.beginFault(kind, `trigger_${kind}`);
    let message = 'The combat state machine received an invalid skill cooldown state';
    let type = 'business_logic_error';
    const fault = this.state.completeFault(pending, () => {
      if (kind === 'business_logic') this.state.damage(25);
      if (kind === 'rendering') {
        this.state.setAnimation('corrupted-frame');
        this.state.setVisualState('distorted');
      }
      if (kind === 'device_compatibility') {
        this.state.setAnimation('hit');
        this.state.setVisualState('compatibility_fallback');
      }
    });
    if (kind === 'rendering') {
      message = 'The character skeletal animation produced an invalid frame index';
      type = 'rendering_error';
      this.playerNode.setScale(2.1, 0.25);
    } else if (kind === 'device_compatibility') {
      const gl = cc.game._renderContext;
      const maxTextureSize = gl?.getParameter && gl?.MAX_TEXTURE_SIZE
        ? Number(gl.getParameter(gl.MAX_TEXTURE_SIZE))
        : 0;
      const requestedTextureSize = maxTextureSize > 0 ? maxTextureSize + 1 : 32768;
      message = `Requested texture size ${requestedTextureSize} exceeds device limit ${maxTextureSize || 'unknown'}`;
      type = 'device_compatibility_error';
      fault.attributes = {
        ...fault.attributes,
        'device.os': String(cc.sys.os),
        'device.os_version': String(cc.sys.osVersion || 'unknown'),
        'device.platform': String(cc.sys.platform),
        'device.is_native': cc.sys.isNative,
        'device.render_type': String(cc.game.renderType),
        'device.max_texture_size': maxTextureSize,
        'compat.requested_texture_size': requestedTextureSize,
        'compat.supported': maxTextureSize >= requestedTextureSize,
      };
      this.playerNode.setScale(0.82, 0.82);
    }
    this.reportError(fault, message, type);
    this.showEvent(`${fault.id}: Error includes before/after state${kind === 'rendering' ? '; Replay shows the distortion' : ''}`, COLORS.danger);
    this.refreshBattleStatus();
    if (kind === 'rendering' || kind === 'device_compatibility') {
      const expectedVisualState = kind === 'rendering' ? 'distorted' : 'compatibility_fallback';
      setTimeout(() => {
        this.interactionLocked = false;
        if (cc.isValid(this.playerNode)) this.playerNode.setScale(1, 1);
        const current = this.state.snapshot();
        if (current.scene === 'BattleScene' && current.visualState === expectedVisualState) {
          this.state.setAnimation('idle');
          this.state.setVisualState('normal');
        }
        this.refreshBattleStatus();
      }, 1400);
    }
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
      if (cc.isValid(this.playerNode)) this.playerNode.opacity = 120;
      guanceSdk.rum.stopResource(key, fault.attributes);
      guanceSdk.rum.addResource(key, {
        url: `game://assets/${missingPath}.png`, httpMethod: 'GET', statusCode: 404,
        responseContentType: 'image/png', responseBody: String(loadError || 'Cocos resource loader returned no asset'),
      }, { fetchStartTime: started, responseStartTime: nowNs(), responseEndTime: nowNs() });
      this.reportError(fault, 'The level boss texture failed to load through the Cocos resource loader', 'resource_load_error');
      this.showEvent(`Resource fault ${fault.id}: the real load failure is linked to Resource 404`, COLORS.warning);
      this.refreshBattleStatus();
    };
    cc.resources.load(missingPath, cc.Texture2D, (loadError: Error | null) => finish(loadError));
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
        url, httpMethod: 'POST', requestHeaders: traceHeaders, statusCode,
        responseContentType: 'application/json', responseBody: detail,
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

  private triggerLongTask(): void {
    if (!this.isBattleReady()) return;
    const pending = this.beginFault('long_task', 'trigger_long_task');
    const fault = this.state.completeFault(pending, () => { this.state.setAnimation('hit'); });
    const started = Date.now();
    while (Date.now() - started < 320) Math.sqrt((Date.now() - started) * 13);
    const durationMs = Date.now() - started;
    const attributes = { ...fault.attributes, 'long_task.duration_ms': durationMs };
    guanceSdk.rum.addLongTask('DiagnosticSample.triggerLongTask', durationMs * 1_000_000, attributes);
    guanceSdk.logger.log(`Simulated main-thread stall: ${durationMs}ms`, 'warning', attributes);
    this.showEvent(`${durationMs}ms stall: animation and LongTask are visible together`, COLORS.danger);
    this.state.setAnimation('idle');
    this.refreshBattleStatus();
  }

  private completeLevel(): void {
    const before = this.state.snapshot();
    if (before.scene !== 'BattleScene' || before.phase !== 'playing') return;
    this.state.completeLevel();
    guanceSdk.rum.addAction('level_complete', 'game_progress', { ...snapshotAttributes(before, 'before'), ...this.state.attributes() });
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
      const completed = snapshot.phase === 'completed';
      this.drawPageBackground(root, completed ? 'Level Complete' : 'Challenge Failed', 'ResultScene stays in the same Session as combat; retry to generate comparison data');
      const card = this.panel(root, 'result_card', 0, 10, 620, 330, COLORS.panel);
      this.label(card, completed ? '✓' : '×', 0, 92, 90, 70, 60, completed ? COLORS.primary : COLORS.danger);
      this.label(card, `Level ${snapshot.levelId} ${completed ? 'Passed' : 'Failed'}`, 0, 34, 420, 40, 30, COLORS.text);
      this.label(card, `Role ${roleName(snapshot.role)}   Score ${snapshot.score}   Defeated ${snapshot.enemiesDefeated}/${snapshot.maxWaves}`, 0, -18, 560, 28, 20, COLORS.muted);
      this.button(card, 'retry_level', 'Retry', -150, -102, 240, 54, () => {
        const levelId = this.state.snapshot().levelId;
        this.state.startLevel(levelId);
        guanceSdk.rum.addAction('retry_level', 'navigation', this.state.attributes());
        this.showBattle();
      }, COLORS.primary);
      this.button(card, 'return_lobby', 'Return to Lobby', 150, -102, 240, 54, () => {
        this.state.returnToLobby();
        guanceSdk.rum.addAction('return_to_lobby', 'navigation', this.state.attributes());
        this.showLobby();
      }, COLORS.info);
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
    const finish = (loadError: Error | null, asset?: any): void => {
      if (completed) return;
      completed = true;
      if (!cc.isValid(this.battleRoot) || this.state.snapshot().scene !== 'BattleScene') {
        guanceSdk.rum.stopResource(key, { 'resource.cancelled': true });
        return;
      }
      if (loadError || !asset) {
        const pending = this.state.prepareFault('resource_load');
        const fault = this.state.completeFault(pending, () => { this.state.markLevelLoadFailed(); });
        guanceSdk.rum.stopResource(key, fault.attributes);
        guanceSdk.rum.addResource(key, {
          url: `game://assets/resources/${path}.json`, httpMethod: 'GET', statusCode: 500,
          responseContentType: 'application/json', responseBody: String(loadError || 'manifest asset missing'),
        }, { fetchStartTime: started, responseStartTime: nowNs(), responseEndTime: nowNs() });
        this.reportError(fault, 'The initial level manifest failed to load', 'resource_load_error');
        this.showEvent('Initial level resources failed to load; return to the lobby and retry', COLORS.danger);
        this.refreshBattleStatus();
        return;
      }
      this.state.markLevelReady();
      guanceSdk.rum.stopResource(key, this.state.attributes());
      guanceSdk.rum.addResource(key, {
        url: `game://assets/resources/${path}.json`, httpMethod: 'GET', statusCode: 200,
        responseContentType: 'application/json', responseBody: JSON.stringify(asset.json),
      }, { fetchStartTime: started, responseStartTime: nowNs(), responseEndTime: nowNs() });
      guanceSdk.logger.log('Level resources loaded', 'info', this.state.attributes());
      this.showEvent('Level resources loaded; controls are ready', COLORS.primary);
      this.refreshBattleStatus();
    };
    cc.resources.load(path, cc.JsonAsset, (error: Error | null, asset: any) => finish(error, asset));
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
      'fault.id': fault.id, 'fault.kind': fault.kind, ...snapshotAttributes(fault.before, 'game'),
    });
    guanceSdk.rum.addError(message, new Error(message).stack || '', type, 'run', fault.attributes);
    guanceSdk.logger.log(`[after] ${message}`, 'error', {
      'fault.id': fault.id, 'fault.kind': fault.kind, ...snapshotAttributes(fault.after, 'game'),
    });
  }

  private isBattleReady(): boolean {
    if (this.state.snapshot().phase === 'playing' && !this.interactionLocked) return true;
    this.showEvent(this.interactionLocked ? 'A diagnostic request is finishing; try again shortly' : 'Level resources are still loading; try again shortly', COLORS.warning);
    return false;
  }

  private refreshBattleStatus(): void {
    if (!cc.isValid(this.statusLabel)) return;
    const state = this.state.snapshot();
    this.statusLabel.string = [
      `Scene  ${state.scene}`, `Level  ${state.levelId} · Wave ${state.wave}/${state.maxWaves}`,
      `Role   ${roleName(state.role)}`, `HP ${state.hp} · Heal ${state.healsRemaining}`,
      `Enemy ${state.enemyHp}/${state.enemyMaxHp} · Kills ${state.enemiesDefeated}`,
      `Score ${state.score} · Anim ${state.animation}`, `Asset ${state.resourceState} · Net ${state.networkState}`,
      `Visual ${state.visualState} · Input #${state.inputSequence}`,
    ].join('\n');
    if (cc.isValid(this.playerHpFill)) this.playerHpFill.scaleX = state.hp / 100;
    if (cc.isValid(this.enemyHpFill)) this.enemyHpFill.scaleX = state.enemyMaxHp > 0 ? state.enemyHp / state.enemyMaxHp : 0;
    if (this.enemyHpLabel && cc.isValid(this.enemyHpLabel.node)) {
      this.enemyHpLabel.string = `WAVE ${state.wave}/${state.maxWaves} · ENEMY ${state.enemyHp} HP`;
    }
  }

  private showEvent(text: string, color: any): void {
    if (!cc.isValid(this.eventLabel)) return;
    this.eventLabel.string = text;
    this.eventLabel.node.color = color;
  }

  private playerArenaX(): number {
    return -270 + (this.state.snapshot().playerX / 100) * 430;
  }

  private nextResourceKey(name: string): string {
    this.resourceSequence += 1;
    return `diagnostic-${name}-${Date.now().toString(36)}-${this.resourceSequence}`;
  }

  private runScene(name: string, render: (root: any) => void): void {
    this.battleRunId += 1;
    const scene = new cc.Scene();
    scene.name = name;
    const canvasNode = new cc.Node('Canvas');
    canvasNode.width = 960;
    canvasNode.height = 640;
    scene.addChild(canvasNode);
    const canvas = canvasNode.addComponent(cc.Canvas);
    const cameraNode = new cc.Node('ReplayCamera');
    canvasNode.addChild(cameraNode);
    cameraNode.z = 1000;
    const camera = cameraNode.addComponent(cc.Camera);
    camera.ortho = true;
    camera.orthoSize = 320;
    canvas.camera = camera;
    const root = new cc.Node('DiagnosticUI');
    root.width = 960;
    root.height = 640;
    canvasNode.addChild(root);
    cc.director.runSceneImmediate(scene);
    setReplayCamera(camera);
    render(root);
  }

  private drawPageBackground(root: any, title: string, subtitle: string): void {
    this.panel(root, 'page_background', 0, 0, 960, 640, COLORS.background).setSiblingIndex(0);
    this.label(root, title, 0, 266, 840, 48, 34, COLORS.text, cc.Label.HorizontalAlign.LEFT);
    this.label(root, subtitle, 0, 228, 840, 28, 16, COLORS.muted, cc.Label.HorizontalAlign.LEFT);
    this.panel(root, 'header_accent', -448, 267, 6, 50, COLORS.primary);
  }

  private panel(parent: any, name: string, x: number, y: number, width: number, height: number, color: any): any {
    const node = new cc.Node(name);
    node.width = width;
    node.height = height;
    parent.addChild(node);
    node.setPosition(x, y);
    const graphics = node.addComponent(cc.Graphics);
    graphics.fillColor = color;
    graphics.roundRect(-width / 2, -height / 2, width, height, Math.min(18, height / 4));
    graphics.fill();
    return node;
  }

  private healthBar(parent: any, name: string, x: number, y: number, width: number, color: any): any {
    const track = this.panel(parent, `${name}_track`, x, y, width, 12, cc.color(8, 12, 22, 210));
    const fill = new cc.Node(`${name}_fill`);
    fill.width = width - 6;
    fill.height = 6;
    track.addChild(fill);
    fill.setPosition(-width / 2 + 3, 0);
    const graphics = fill.addComponent(cc.Graphics);
    graphics.fillColor = color;
    graphics.roundRect(0, -3, width - 6, 6, 3);
    graphics.fill();
    return fill;
  }

  private button(parent: any, name: string, text: string, x: number, y: number, width: number, height: number,
    onClick: () => void, color: any): any {
    const node = this.panel(parent, name, x, y, width, height, color);
    node.addComponent(cc.Button);
    node.on('click', onClick);
    this.label(node, text, 0, 0, width - 12, height - 4, Math.min(18, height / 2.5), COLORS.text);
    return node;
  }

  private label(parent: any, text: string, x: number, y: number, width: number, height: number, fontSize: number,
    color: any, alignment = cc.Label.HorizontalAlign.CENTER): any {
    const node = new cc.Node(`label_${text.slice(0, 16)}`);
    node.color = color;
    parent.addChild(node);
    node.setPosition(x, y);
    const label = node.addComponent(cc.Label);
    // Creator 2.4 resets the node size when cc.Label is added. Apply the
    // intended layout afterwards so labels remain visible in web/native runs.
    node.width = width;
    node.height = height;
    label.string = text;
    label.fontSize = fontSize;
    label.lineHeight = Math.ceil(fontSize * 1.25);
    label.horizontalAlign = alignment;
    label.verticalAlign = cc.Label.VerticalAlign.CENTER;
    label.overflow = cc.Label.Overflow.SHRINK;
    return label;
  }

  private notice(parent: any, text: string, color: any): void {
    const label = this.label(parent, text, 0, -155, 400, 28, 18, color);
    setTimeout(() => {
      if (cc.isValid(label.node)) label.node.destroy();
    }, 1200);
  }
}

function nowNs(): number { return Date.now() * 1_000_000; }

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

function roleAttackRange(role: DiagnosticRole | null): number {
  if (role === 'knight') return 125;
  if (role === 'ranger') return 440;
  if (role === 'mage') return 300;
  return 120;
}

function levelName(levelId: number): string {
  return ['Unknown Area', 'Forest Ruins', 'Lava Fortress', 'Stellar Rift'][levelId] || 'Unknown Area';
}

function levelColor(levelId: number): any {
  if (levelId === 1) return cc.color(24, 76, 68, 255);
  if (levelId === 2) return cc.color(88, 47, 43, 255);
  return cc.color(45, 42, 91, 255);
}
