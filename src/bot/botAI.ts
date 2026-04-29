import { GameState, LudoEngine, ludoEngine, TokenPos, PlayerColor } from '../game/gameEngine';

type Difficulty = 'easy' | 'medium' | 'hard';

interface BotProfile {
  id: string;
  name: string;
  isBot: true;
  difficulty: Difficulty;
  elo: number;
  thinkingMs: number; // simulated delay
}

const BOT_NAMES = [
  'LudoBot', 'RoboKing', 'AutoPlay', 'BotMaster',
  'CyberKing', 'DigiPlayer', 'MechRoller', 'AlphaBot'
];

export function createBot(avgHumanElo: number): BotProfile {
  let difficulty: Difficulty;
  let elo: number;
  let thinkingMs: number;

  if (avgHumanElo < 1000)      { difficulty = 'easy';   elo = 700 + Math.random() * 250;  thinkingMs = 2500; }
  else if (avgHumanElo < 1400) { difficulty = 'medium'; elo = 1000 + Math.random() * 350; thinkingMs = 1500; }
  else                          { difficulty = 'hard';   elo = 1400 + Math.random() * 400; thinkingMs = 800;  }

  return {
    id: `bot_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name: BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)],
    isBot: true,
    difficulty,
    elo: Math.floor(elo),
    thinkingMs,
  };
}

export class BotAI {

  chooseBestMove(state: GameState, botId: string, dice: number, difficulty: Difficulty): number {
    const tokens = state.tokens[botId];
    const slot = state.slots.find(s => s.playerId === botId)!;
    const validTokens: number[] = [];

    tokens.forEach((token, i) => {
      if (token.area === 'finish') return;
      if (token.area === 'home' && dice !== 6) return;
      validTokens.push(i);
    });

    if (validTokens.length === 0) return -1;
    if (validTokens.length === 1) return validTokens[0];

    switch (difficulty) {
      case 'easy':   return this.easyStrategy(validTokens, tokens, state, botId, dice, slot.color);
      case 'medium': return this.mediumStrategy(validTokens, tokens, state, botId, dice, slot.color);
      case 'hard':   return this.hardStrategy(validTokens, tokens, state, botId, dice, slot.color);
    }
  }

  // Easy: mostly random, occasionally makes obvious moves
  private easyStrategy(validTokens: number[], tokens: TokenPos[], state: GameState, botId: string, dice: number, color: PlayerColor): number {
    // 70% random, 30% pick token furthest along
    if (Math.random() < 0.7) return validTokens[Math.floor(Math.random() * validTokens.length)];
    return this.tokenFurthestAlong(validTokens, tokens);
  }

  // Medium: prefers captures and getting tokens out of home
  private mediumStrategy(validTokens: number[], tokens: TokenPos[], state: GameState, botId: string, dice: number, color: PlayerColor): number {
    // Priority 1: Capture opponent token
    const captureMove = this.findCaptureMove(validTokens, tokens, state, botId, dice, color);
    if (captureMove !== -1) return captureMove;

    // Priority 2: Leave home if dice is 6
    if (dice === 6) {
      const homeToken = validTokens.find(i => tokens[i].area === 'home');
      if (homeToken !== undefined) return homeToken;
    }

    // Priority 3: Move token closest to finish
    return this.tokenFurthestAlong(validTokens, tokens);
  }

  // Hard: full strategic evaluation
  private hardStrategy(validTokens: number[], tokens: TokenPos[], state: GameState, botId: string, dice: number, color: PlayerColor): number {
    const scores = validTokens.map(i => this.scoreMove(i, tokens, state, botId, dice, color));
    const maxScore = Math.max(...scores);
    const bestMoves = validTokens.filter((_, idx) => scores[idx] === maxScore);
    return bestMoves[Math.floor(Math.random() * bestMoves.length)];
  }

  private scoreMove(tokenIndex: number, tokens: TokenPos[], state: GameState, botId: string, dice: number, color: PlayerColor): number {
    let score = 0;
    const token = tokens[tokenIndex];

    // Heavily prioritise finishing a token
    if (token.area === 'track' && token.step + dice === 52) score += 100;

    // Capture opponent tokens
    if (this.wouldCapture(token, dice, state, botId, color)) score += 50;

    // Leave home to activate token
    if (token.area === 'home' && dice === 6) score += 30;

    // Prefer tokens in danger (move them out of opponent's reach)
    if (this.isInDanger(token, state, botId)) score += 25;

    // Prefer tokens furthest along
    if (token.area === 'track') {
      score += Math.floor(token.step / 5);
    }

    // Avoid landing on non-safe squares when opponent is nearby
    if (this.landingIsDangerous(token, dice, state, botId, color)) score -= 20;

    return score;
  }

  private findCaptureMove(validTokens: number[], tokens: TokenPos[], state: GameState, botId: string, dice: number, color: PlayerColor): number {
    for (const i of validTokens) {
      if (this.wouldCapture(tokens[i], dice, state, botId, color)) return i;
    }
    return -1;
  }

  private wouldCapture(token: TokenPos, dice: number, state: GameState, botId: string, color: PlayerColor): boolean {
    if (token.area !== 'track') return false;
    const newStep = (token.step + dice) % 52;
    if ([0, 8, 13, 21, 26, 34, 39, 47].includes(newStep)) return false;

    return state.slots.some(s => {
      if (s.playerId === botId) return false;
      return state.tokens[s.playerId].some(t => t.area === 'track' && t.step === newStep);
    });
  }

  private isInDanger(token: TokenPos, state: GameState, botId: string): boolean {
    if (token.area !== 'track' || [0, 8, 13, 21, 26, 34, 39, 47].includes(token.step)) return false;
    return state.slots.some(s => {
      if (s.playerId === botId) return false;
      return state.tokens[s.playerId].some(t =>
        t.area === 'track' && Math.abs(t.step - token.step) <= 6
      );
    });
  }

  private landingIsDangerous(token: TokenPos, dice: number, state: GameState, botId: string, color: PlayerColor): boolean {
    const newStep = (token.step + dice) % 52;
    if ([0, 8, 13, 21, 26, 34, 39, 47].includes(newStep)) return false;
    return state.slots.some(s => {
      if (s.playerId === botId) return false;
      return state.tokens[s.playerId].some(t => t.area === 'track' && Math.abs(t.step - newStep) <= 6);
    });
  }

  private tokenFurthestAlong(validTokens: number[], tokens: TokenPos[]): number {
    return validTokens.reduce((best, i) => {
      const stepA = tokens[i].area === 'track' ? tokens[i].step : 0;
      const stepB = tokens[best].area === 'track' ? tokens[best].step : 0;
      return stepA > stepB ? i : best;
    }, validTokens[0]);
  }
}

export const botAI = new BotAI();
