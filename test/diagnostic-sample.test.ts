import { describe, expect, it } from 'vitest';
import { DiagnosticGameState } from '../examples/shared/DiagnosticGameState';

describe('diagnostic game sample state', () => {
  it('carries login, role, level, animation, and input context through the game flow', () => {
    const game = new DiagnosticGameState();

    game.selectRole('ranger');
    game.login('player-42');
    game.startLevel(2);
    game.markLevelReady();
    game.move(1);
    const attack = game.attack();

    expect(attack.snapshot).toMatchObject({
      scene: 'BattleScene',
      screen: 'level_2',
      phase: 'playing',
      role: 'ranger',
      userId: 'player-42',
      levelId: 2,
      playerX: 32,
      animation: 'attack',
      visualState: 'normal',
      score: 10,
      enemyHp: 46,
      enemyMaxHp: 70,
      inputSequence: 5,
      lastAction: 'attack',
    });
    expect(game.attributes()).toMatchObject({
      'game.scene': 'BattleScene',
      'game.level_id': 2,
      'game.animation': 'attack',
      'game.last_action': 'attack',
    });
  });

  it('records independent before and after snapshots on a fault', () => {
    const game = readyBattle();

    const fault = game.captureFault('resource_load', () => {
      game.setResourceState('failed');
      game.damage(20);
    });

    expect(fault.id).toBe('resource_load-001');
    expect(fault.before).toMatchObject({ hp: 100, resourceState: 'ready', animation: 'idle' });
    expect(fault.after).toMatchObject({ hp: 80, resourceState: 'failed', animation: 'hit' });
    expect(fault.attributes).toMatchObject({
      'fault.id': 'resource_load-001',
      'fault.kind': 'resource_load',
      'before.hp': 100,
      'before.resource_state': 'ready',
      'after.hp': 80,
      'after.resource_state': 'failed',
    });
  });

  it('reproduces the intermittent scenario on the third consecutive attack', () => {
    const game = readyBattle(1, 'ranger');

    expect(game.attack().shouldTriggerIntermittentFault).toBe(false);
    expect(game.attack().shouldTriggerIntermittentFault).toBe(false);
    game.move(1);
    expect(game.attack()).toMatchObject({ shouldTriggerIntermittentFault: false, enemyDefeated: true });
    game.advanceWave();
    expect(game.attack().shouldTriggerIntermittentFault).toBe(false);
    expect(game.attack().shouldTriggerIntermittentFault).toBe(true);
  });

  it('supports a playable battle loop with enemy health, waves, counterattacks, and healing', () => {
    const game = readyBattle();

    expect(game.attack()).toMatchObject({ damage: 30, enemyDefeated: false });
    expect(game.attack()).toMatchObject({ enemyDefeated: true });
    expect(game.snapshot()).toMatchObject({ enemyHp: 0, enemiesDefeated: 1, score: 70 });
    expect(() => game.attack()).toThrow('already defeated');

    expect(game.advanceWave()).toMatchObject({ wave: 2, enemyHp: 75, enemyMaxHp: 75, healsRemaining: 1 });
    expect(game.enemyAttack(14)).toMatchObject({ hp: 86, animation: 'hit' });
    expect(game.heal()).toMatchObject({ hp: 100, healsRemaining: 0, lastAction: 'heal' });
    expect(() => game.heal()).toThrow('No heals remaining');
  });

  it('keeps fault IDs unique when the same SDK session logs out and starts again', () => {
    const game = readyBattle();
    expect(game.captureFault('network', () => game.setNetworkState('offline')).id).toBe('network-001');

    game.reset();
    game.selectRole('mage');
    game.login('player-2');
    game.startLevel(1);
    game.markLevelReady();

    expect(game.captureFault('network', () => game.setNetworkState('offline')).id).toBe('network-002');
  });

  it('makes an initial level-load failure observable and recoverable', () => {
    const game = new DiagnosticGameState();
    game.selectRole('mage');
    game.login('player-3');
    game.startLevel(3);

    const fault = game.captureFault('resource_load', () => game.markLevelLoadFailed());
    expect(fault.before).toMatchObject({ phase: 'loading', resourceState: 'loading', visualState: 'normal' });
    expect(fault.after).toMatchObject({ phase: 'failed', resourceState: 'failed', visualState: 'missing_asset' });

    expect(game.returnToLobby()).toMatchObject({
      scene: 'LobbyScene',
      phase: 'selecting',
      resourceState: 'idle',
      visualState: 'normal',
    });
  });

  it('rejects invalid flow transitions before telemetry can describe a fake state', () => {
    const game = new DiagnosticGameState();

    expect(() => game.login('player-42')).toThrow('Select a role');
    expect(() => game.startLevel(0)).toThrow('positive integer');
    expect(() => game.attack()).toThrow('Level is not ready');
  });
});

function readyBattle(levelId = 1, role: 'knight' | 'ranger' | 'mage' = 'knight'): DiagnosticGameState {
  const game = new DiagnosticGameState();
  game.selectRole(role);
  game.login('player-1');
  game.startLevel(levelId);
  game.markLevelReady();
  return game;
}
