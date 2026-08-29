export type DiagnosticRole = 'knight' | 'ranger' | 'mage';
export type DiagnosticScene = 'LoginScene' | 'LobbyScene' | 'BattleScene' | 'ResultScene';
export type DiagnosticPhase = 'login' | 'selecting' | 'loading' | 'playing' | 'paused' | 'failed' | 'completed';
export type DiagnosticAnimation = 'idle' | 'run' | 'attack' | 'hit' | 'victory' | 'corrupted-frame';
export type DiagnosticResourceState = 'idle' | 'loading' | 'ready' | 'failed';
export type DiagnosticNetworkState = 'online' | 'slow' | 'offline';
export type DiagnosticVisualState = 'normal' | 'missing_asset' | 'distorted' | 'compatibility_fallback';
export type DiagnosticFaultKind =
  | 'business_logic'
  | 'resource_load'
  | 'rendering'
  | 'device_compatibility'
  | 'network'
  | 'long_task'
  | 'intermittent';

export type DiagnosticAttributeValue = string | number | boolean | null;
export type DiagnosticAttributes = Record<string, DiagnosticAttributeValue>;

export interface DiagnosticSnapshot {
  scene: DiagnosticScene;
  screen: string;
  phase: DiagnosticPhase;
  role: DiagnosticRole | null;
  userId: string;
  levelId: number;
  wave: number;
  hp: number;
  score: number;
  enemyHp: number;
  enemyMaxHp: number;
  enemiesDefeated: number;
  maxWaves: number;
  healsRemaining: number;
  playerX: number;
  playerY: number;
  animation: DiagnosticAnimation;
  resourceState: DiagnosticResourceState;
  networkState: DiagnosticNetworkState;
  visualState: DiagnosticVisualState;
  inputSequence: number;
  intermittentAttempt: number;
  lastAction: string;
}

export interface DiagnosticFaultContext {
  id: string;
  kind: DiagnosticFaultKind;
  before: DiagnosticSnapshot;
  after: DiagnosticSnapshot;
  attributes: DiagnosticAttributes;
}

export interface DiagnosticPendingFault {
  id: string;
  kind: DiagnosticFaultKind;
  before: DiagnosticSnapshot;
}

export interface DiagnosticAttackResult {
  snapshot: DiagnosticSnapshot;
  damage: number;
  enemyDefeated: boolean;
  shouldTriggerIntermittentFault: boolean;
}

const INITIAL_STATE: DiagnosticSnapshot = {
  scene: 'LoginScene',
  screen: 'login',
  phase: 'selecting',
  role: null,
  userId: '',
  levelId: 0,
  wave: 0,
  hp: 100,
  score: 0,
  enemyHp: 0,
  enemyMaxHp: 0,
  enemiesDefeated: 0,
  maxWaves: 3,
  healsRemaining: 1,
  playerX: 20,
  playerY: 50,
  animation: 'idle',
  resourceState: 'idle',
  networkState: 'online',
  visualState: 'normal',
  inputSequence: 0,
  intermittentAttempt: 0,
  lastAction: 'sample_opened',
};

/**
 * Framework-independent state used by both Creator samples. Keeping the game
 * state separate from nodes makes every telemetry event use one consistent
 * snapshot and gives intermittent failures a deterministic reproduction path.
 */
export class DiagnosticGameState {
  private state: DiagnosticSnapshot = { ...INITIAL_STATE };
  private faultSequence = 0;

  reset(): DiagnosticSnapshot {
    this.state = { ...INITIAL_STATE };
    return this.snapshot();
  }

  snapshot(): DiagnosticSnapshot {
    return { ...this.state };
  }

  selectRole(role: DiagnosticRole): DiagnosticSnapshot {
    this.state.role = role;
    this.recordInput(`select_role:${role}`);
    return this.snapshot();
  }

  login(userId: string): DiagnosticSnapshot {
    const normalizedUserId = userId.trim();
    if (!normalizedUserId) throw new TypeError('userId must not be empty');
    if (!this.state.role) throw new Error('Select a role before login');
    this.state.userId = normalizedUserId;
    this.state.scene = 'LobbyScene';
    this.state.screen = 'level_select';
    this.state.phase = 'selecting';
    this.recordInput('login_success');
    return this.snapshot();
  }

  startLevel(levelId: number): DiagnosticSnapshot {
    if (!Number.isInteger(levelId) || levelId < 1) throw new RangeError('levelId must be a positive integer');
    if (!this.state.userId || !this.state.role) throw new Error('Login before starting a level');
    this.state.scene = 'BattleScene';
    this.state.screen = `level_${levelId}`;
    this.state.phase = 'loading';
    this.state.levelId = levelId;
    this.state.wave = 1;
    this.state.hp = 100;
    this.state.score = 0;
    this.state.enemyMaxHp = enemyHealth(levelId, 1);
    this.state.enemyHp = this.state.enemyMaxHp;
    this.state.enemiesDefeated = 0;
    this.state.healsRemaining = 1;
    this.state.playerX = 20;
    this.state.playerY = 50;
    this.state.animation = 'idle';
    this.state.resourceState = 'loading';
    this.state.networkState = 'online';
    this.state.visualState = 'normal';
    this.state.intermittentAttempt = 0;
    this.recordInput(`start_level:${levelId}`);
    return this.snapshot();
  }

  markLevelReady(): DiagnosticSnapshot {
    this.state.phase = 'playing';
    this.state.resourceState = 'ready';
    this.state.animation = 'idle';
    this.state.lastAction = 'level_ready';
    return this.snapshot();
  }

  markLevelLoadFailed(): DiagnosticSnapshot {
    this.state.phase = 'failed';
    this.state.resourceState = 'failed';
    this.state.visualState = 'missing_asset';
    this.state.lastAction = 'level_load_failed';
    return this.snapshot();
  }

  move(direction: -1 | 1): DiagnosticSnapshot {
    this.assertPlaying();
    this.state.playerX = clamp(this.state.playerX + direction * 12, 8, 92);
    this.state.animation = 'run';
    this.recordInput(direction < 0 ? 'move_left' : 'move_right');
    return this.snapshot();
  }

  attack(): DiagnosticAttackResult {
    this.assertPlaying();
    if (this.state.enemyHp === 0) throw new Error('Enemy is already defeated');
    const damage = roleDamage(this.state.role);
    this.state.animation = 'attack';
    this.state.enemyHp = clamp(this.state.enemyHp - damage, 0, this.state.enemyMaxHp);
    this.state.score += 10;
    this.state.intermittentAttempt += 1;
    this.recordInput('attack', true);
    const enemyDefeated = this.state.enemyHp === 0;
    if (enemyDefeated) {
      this.state.enemiesDefeated += 1;
      this.state.score += 50;
      this.state.animation = 'victory';
    }
    return {
      snapshot: this.snapshot(),
      damage,
      enemyDefeated,
      shouldTriggerIntermittentFault: this.state.intermittentAttempt % 3 === 0,
    };
  }

  advanceWave(): DiagnosticSnapshot {
    this.assertPlaying();
    if (this.state.enemyHp > 0) throw new Error('Defeat the current enemy before advancing');
    if (this.state.wave >= this.state.maxWaves) throw new Error('No remaining waves');
    this.state.wave += 1;
    this.state.enemyMaxHp = enemyHealth(this.state.levelId, this.state.wave);
    this.state.enemyHp = this.state.enemyMaxHp;
    this.state.healsRemaining = 1;
    this.state.animation = 'idle';
    this.state.lastAction = `wave_${this.state.wave}_started`;
    return this.snapshot();
  }

  heal(amount = 30): DiagnosticSnapshot {
    this.assertPlaying();
    if (this.state.healsRemaining <= 0) throw new Error('No heals remaining in this wave');
    this.state.hp = clamp(this.state.hp + Math.max(0, amount), 0, 100);
    this.state.healsRemaining -= 1;
    this.state.animation = 'idle';
    this.recordInput('heal');
    return this.snapshot();
  }

  enemyAttack(amount: number): DiagnosticSnapshot {
    this.assertPlaying();
    this.state.hp = clamp(this.state.hp - Math.max(0, amount), 0, 100);
    this.state.animation = 'hit';
    this.state.lastAction = 'enemy_attack';
    return this.snapshot();
  }

  setAnimation(animation: DiagnosticAnimation): DiagnosticSnapshot {
    this.state.animation = animation;
    return this.snapshot();
  }

  setResourceState(resourceState: DiagnosticResourceState): DiagnosticSnapshot {
    this.state.resourceState = resourceState;
    return this.snapshot();
  }

  setNetworkState(networkState: DiagnosticNetworkState): DiagnosticSnapshot {
    this.state.networkState = networkState;
    return this.snapshot();
  }

  setVisualState(visualState: DiagnosticVisualState): DiagnosticSnapshot {
    this.state.visualState = visualState;
    return this.snapshot();
  }

  damage(amount: number): DiagnosticSnapshot {
    this.state.hp = clamp(this.state.hp - Math.max(0, amount), 0, 100);
    this.state.animation = 'hit';
    if (this.state.hp === 0) this.state.phase = 'failed';
    return this.snapshot();
  }

  completeLevel(): DiagnosticSnapshot {
    this.state.scene = 'ResultScene';
    this.state.screen = 'level_result';
    this.state.phase = 'completed';
    this.state.animation = 'victory';
    this.recordInput('complete_level');
    return this.snapshot();
  }

  finishDefeat(): DiagnosticSnapshot {
    this.state.scene = 'ResultScene';
    this.state.screen = 'level_result';
    this.state.phase = 'failed';
    this.state.animation = 'hit';
    this.state.lastAction = 'player_defeated';
    return this.snapshot();
  }

  returnToLobby(): DiagnosticSnapshot {
    this.state.scene = 'LobbyScene';
    this.state.screen = 'level_select';
    this.state.phase = 'selecting';
    this.state.levelId = 0;
    this.state.wave = 0;
    this.state.enemyHp = 0;
    this.state.enemyMaxHp = 0;
    this.state.enemiesDefeated = 0;
    this.state.healsRemaining = 1;
    this.state.animation = 'idle';
    this.state.resourceState = 'idle';
    this.state.networkState = 'online';
    this.state.visualState = 'normal';
    this.recordInput('return_to_lobby');
    return this.snapshot();
  }

  recordAction(name: string): DiagnosticSnapshot {
    this.recordInput(name);
    return this.snapshot();
  }

  captureFault(kind: DiagnosticFaultKind, mutate: () => void): DiagnosticFaultContext {
    return this.completeFault(this.prepareFault(kind), mutate);
  }

  prepareFault(kind: DiagnosticFaultKind): DiagnosticPendingFault {
    const before = this.snapshot();
    this.faultSequence += 1;
    return {
      id: `${kind}-${String(this.faultSequence).padStart(3, '0')}`,
      kind,
      before,
    };
  }

  completeFault(pending: DiagnosticPendingFault, mutate: () => void): DiagnosticFaultContext {
    mutate();
    const after = this.snapshot();
    return {
      id: pending.id,
      kind: pending.kind,
      before: pending.before,
      after,
      attributes: {
        'fault.id': pending.id,
        'fault.kind': pending.kind,
        ...snapshotAttributes(pending.before, 'before'),
        ...snapshotAttributes(after, 'after'),
      },
    };
  }

  attributes(extra?: DiagnosticAttributes): DiagnosticAttributes {
    return { ...snapshotAttributes(this.state, 'game'), ...(extra || {}) };
  }

  private recordInput(name: string, preserveAttackSequence = false): void {
    if (!preserveAttackSequence) this.state.intermittentAttempt = 0;
    this.state.inputSequence += 1;
    this.state.lastAction = name;
  }

  private assertPlaying(): void {
    if (this.state.phase !== 'playing') throw new Error('Level is not ready for input');
  }
}

export function snapshotAttributes(snapshot: DiagnosticSnapshot, prefix: string): DiagnosticAttributes {
  return {
    [`${prefix}.scene`]: snapshot.scene,
    [`${prefix}.screen`]: snapshot.screen,
    [`${prefix}.phase`]: snapshot.phase,
    [`${prefix}.role`]: snapshot.role || 'none',
    [`${prefix}.user_id`]: snapshot.userId || 'anonymous',
    [`${prefix}.level_id`]: snapshot.levelId,
    [`${prefix}.wave`]: snapshot.wave,
    [`${prefix}.hp`]: snapshot.hp,
    [`${prefix}.score`]: snapshot.score,
    [`${prefix}.enemy_hp`]: snapshot.enemyHp,
    [`${prefix}.enemy_max_hp`]: snapshot.enemyMaxHp,
    [`${prefix}.enemies_defeated`]: snapshot.enemiesDefeated,
    [`${prefix}.max_waves`]: snapshot.maxWaves,
    [`${prefix}.heals_remaining`]: snapshot.healsRemaining,
    [`${prefix}.player_x`]: snapshot.playerX,
    [`${prefix}.player_y`]: snapshot.playerY,
    [`${prefix}.animation`]: snapshot.animation,
    [`${prefix}.resource_state`]: snapshot.resourceState,
    [`${prefix}.network_state`]: snapshot.networkState,
    [`${prefix}.visual_state`]: snapshot.visualState,
    [`${prefix}.input_sequence`]: snapshot.inputSequence,
    [`${prefix}.intermittent_attempt`]: snapshot.intermittentAttempt,
    [`${prefix}.last_action`]: snapshot.lastAction,
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function roleDamage(role: DiagnosticRole | null): number {
  if (role === 'knight') return 30;
  if (role === 'ranger') return 24;
  if (role === 'mage') return 36;
  return 20;
}

function enemyHealth(levelId: number, wave: number): number {
  return 50 + levelId * 10 + (wave - 1) * 15;
}
