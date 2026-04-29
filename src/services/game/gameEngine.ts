import { v4 as uuidv4 } from 'uuid';

export type TokenPos = { area: 'home' | 'track' | 'finish'; step: number };
export type PlayerColor = 'red' | 'blue' | 'green' | 'yellow';
export type SlotType = { playerId: string; isBot: boolean; color: PlayerColor; name: string; elo: number };

export interface GameState {
  id: string;
  tokens: Record<string, TokenPos[]>; // playerId → 4 tokens
  currentTurn: string; // playerId
  dice: number | null;
  diceRolled: boolean;
  sixStreak: number;
  turnStartedAt: number;
  phase: 'waiting' | 'playing' | 'finished';
  winner: string | null;
  slots: SlotType[];
}

const TRACK_LENGTH = 52;
const HOME_COLUMN_LENGTH = 6;
const MAX_TURN_MS = 30_000; // 30s per turn

// Each color's starting step on the shared track
const START_STEPS: Record<PlayerColor, number> = {
  red: 0, blue: 13, green: 26, yellow: 39,
};

// Safe squares (can't be captured)
const SAFE_SQUARES = new Set([0, 8, 13, 21, 26, 34, 39, 47]);

export class LudoEngine {

  createGame(slots: SlotType[]): GameState {
    const tokens: Record<string, TokenPos[]> = {};
    slots.forEach(s => {
      tokens[s.playerId] = Array(4).fill(null).map(() => ({ area: 'home', step: 0 }));
    });
    return {
      id: uuidv4(),
      tokens,
      currentTurn: slots[0].playerId,
      dice: null,
      diceRolled: false,
      sixStreak: 0,
      turnStartedAt: Date.now(),
      phase: 'playing',
      winner: null,
      slots,
    };
  }

  // Server-authoritative dice roll
  rollDice(state: GameState, playerId: string): { state: GameState; dice: number; canMove: boolean } {
    if (state.currentTurn !== playerId) throw new Error('Not your turn');
    if (state.diceRolled) throw new Error('Already rolled');

    const dice = Math.floor(Math.random() * 6) + 1;
    const newState = { ...state, dice, diceRolled: true };

    // Check if player has any valid moves
    const canMove = this.hasValidMoves(newState, playerId, dice);

    if (!canMove) {
      // Auto-advance turn if no moves possible
      return { state: this.advanceTurn(newState), dice, canMove: false };
    }

    return { state: newState, dice, canMove: true };
  }

  moveToken(state: GameState, playerId: string, tokenIndex: number): GameState {
    if (state.currentTurn !== playerId) throw new Error('Not your turn');
    if (!state.diceRolled || state.dice === null) throw new Error('Roll dice first');

    const slot = state.slots.find(s => s.playerId === playerId)!;
    const token = state.tokens[playerId][tokenIndex];
    const dice = state.dice;

    // Validate move
    if (!this.isValidMove(state, playerId, tokenIndex, dice)) {
      throw new Error('Invalid move');
    }

    const newState = JSON.parse(JSON.stringify(state)) as GameState;
    const newPos = this.calculateNewPosition(token, dice, slot.color);
    newState.tokens[playerId][tokenIndex] = newPos;

    // Check capture (send opponent token home)
    if (newPos.area === 'track') {
      newState.slots.forEach(s => {
        if (s.playerId === playerId) return;
        s && newState.tokens[s.playerId].forEach((t, i) => {
          if (t.area === 'track' && t.step === newPos.step && !SAFE_SQUARES.has(newPos.step)) {
            newState.tokens[s.playerId][i] = { area: 'home', step: 0 };
          }
        });
      });
    }

    // Check win
    const allFinished = newState.tokens[playerId].every(t => t.area === 'finish' && t.step === HOME_COLUMN_LENGTH);
    if (allFinished) {
      newState.phase = 'finished';
      newState.winner = playerId;
      return newState;
    }

    // Roll 6 = extra turn
    if (dice === 6) {
      newState.sixStreak = (newState.sixStreak || 0) + 1;
      if (newState.sixStreak >= 3) {
        // 3 sixes in a row = forfeit turn (anti-cheat)
        return this.advanceTurn({ ...newState, sixStreak: 0 });
      }
      return { ...newState, diceRolled: false, dice: null, turnStartedAt: Date.now() };
    }

    return this.advanceTurn({ ...newState, sixStreak: 0 });
  }

  private calculateNewPosition(token: TokenPos, dice: number, color: PlayerColor): TokenPos {
    const startStep = START_STEPS[color];

    if (token.area === 'home') {
      if (dice !== 6) throw new Error('Need 6 to leave home');
      return { area: 'track', step: startStep };
    }

    if (token.area === 'track') {
      // Calculate steps from home entry
      const stepsFromStart = (token.step - startStep + TRACK_LENGTH) % TRACK_LENGTH;
      const newStepsFromStart = stepsFromStart + dice;

      if (newStepsFromStart >= TRACK_LENGTH) {
        // Enter home column
        const homeStep = newStepsFromStart - TRACK_LENGTH;
        if (homeStep > HOME_COLUMN_LENGTH) throw new Error('Overshoot - invalid');
        return { area: homeStep === HOME_COLUMN_LENGTH ? 'finish' : 'track', step: homeStep };
      }

      const newStep = (startStep + newStepsFromStart) % TRACK_LENGTH;
      return { area: 'track', step: newStep };
    }

    // In home column
    const newStep = token.step + dice;
    if (newStep > HOME_COLUMN_LENGTH) throw new Error('Overshoot');
    return { area: newStep === HOME_COLUMN_LENGTH ? 'finish' : 'track', step: newStep };
  }

  private isValidMove(state: GameState, playerId: string, tokenIndex: number, dice: number): boolean {
    const token = state.tokens[playerId][tokenIndex];
    if (token.area === 'finish') return false;
    if (token.area === 'home' && dice !== 6) return false;
    try {
      const slot = state.slots.find(s => s.playerId === playerId)!;
      this.calculateNewPosition(token, dice, slot.color);
      return true;
    } catch {
      return false;
    }
  }

  private hasValidMoves(state: GameState, playerId: string, dice: number): boolean {
    return state.tokens[playerId].some((_, i) => this.isValidMove(state, playerId, i, dice));
  }

  private advanceTurn(state: GameState): GameState {
    const idx = state.slots.findIndex(s => s.playerId === state.currentTurn);
    const next = state.slots[(idx + 1) % state.slots.length];
    return { ...state, currentTurn: next.playerId, diceRolled: false, dice: null, turnStartedAt: Date.now() };
  }

  // Auto-move for timed-out turns
  autoMove(state: GameState): GameState {
    if (Date.now() - state.turnStartedAt < MAX_TURN_MS) return state;
    if (!state.diceRolled) {
      const { state: rolled } = this.rollDice(state, state.currentTurn);
      return rolled;
    }
    return this.advanceTurn(state);
  }
}

export const ludoEngine = new LudoEngine();
