export type Suit = 'hearts' | 'diamonds' | 'clubs' | 'spades';
export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A';

export interface Card {
  suit: Suit;
  rank: Rank;
  value: number; // For comparison (2 is special, 10 is special)
  id: string; // Unique ID for React keys/tracking
}

export interface Player {
  id: string; // Ably clientId
  name: string;
  hand: Card[];
  faceUpCards: Card[];
  faceDownCards: Card[];
  isConnected: boolean;
  isReady: boolean;
}

export type GameStatus = 'waiting' | 'setup' | 'playing' | 'finished';

export interface GameState {
  players: Player[];
  drawPile: Card[];
  discardPile: Card[];
  currentTurnPlayerId: string | null;
  status: GameStatus;
  direction: 1 | -1; // 1 for clockwise, -1 for counter-clockwise
  lastPlayWasSeven: boolean; // Track if the last card played was a 7 (next player must play <= 7)
  winnerId: string | null;
}
