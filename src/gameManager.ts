import type { Card, GameState, Player, Rank, Suit } from './types';

export class GameManager {
  private state: GameState;

  constructor(initialState?: GameState) {
    if (initialState) {
      this.state = initialState;
    } else {
      this.state = {
        players: [],
        drawPile: [],
        discardPile: [],
        currentTurnPlayerId: null,
        status: 'waiting',
        direction: 1,
        lastPlayWasSeven: false,
        winnerId: null,
      };
    }
  }

  public getState(): GameState {
    return this.state;
  }

  public addPlayer(id: string, name: string): void {
    if (this.state.status !== 'waiting') return;
    if (this.state.players.some(p => p.id === id)) return;

    this.state.players.push({
      id,
      name,
      hand: [],
      faceUpCards: [],
      faceDownCards: [],
      isConnected: true,
      isReady: false,
    });
  }

  public removePlayer(id: string): void {
    if (this.state.status !== 'waiting') {
        const player = this.state.players.find(p => p.id === id);
        if (player) player.isConnected = false;
        return;
    }
    this.state.players = this.state.players.filter(p => p.id !== id);
  }

  public startGame(): void {
    if (this.state.players.length < 2) return; 
    this.state.status = 'setup'; // Start in setup phase
    this.state.discardPile = [];
    this.state.winnerId = null;
    this.state.direction = 1;
    this.state.lastPlayWasSeven = false;

    const numDecks = this.state.players.length >= 3 ? 2 : 1;
    this.state.drawPile = this.createDeck(numDecks);

    // Deal cards: 3 down, 3 up, 5 hand
    this.state.players.forEach(player => {
        player.isReady = false;
        player.faceDownCards = this.drawCardsFromDeck(3);
        player.faceUpCards = this.drawCardsFromDeck(3);
        player.hand = this.drawCardsFromDeck(5);
    });

    const startPlayerIndex = Math.floor(Math.random() * this.state.players.length);
    this.state.currentTurnPlayerId = this.state.players[startPlayerIndex].id;

    const startCard = this.state.drawPile.pop();
    if (startCard) {
        this.state.discardPile.push(startCard);
    }
  }

  public swapCards(playerId: string, handCardId: string, faceUpCardId: string): boolean {
      if (this.state.status !== 'setup') return false;
      const player = this.state.players.find(p => p.id === playerId);
      if (!player) return false;
      if (player.isReady) return false; // Locked in

      const handCardIndex = player.hand.findIndex(c => c.id === handCardId);
      const faceUpCardIndex = player.faceUpCards.findIndex(c => c.id === faceUpCardId);

      if (handCardIndex === -1 || faceUpCardIndex === -1) return false;

      // Swap
      const temp = player.hand[handCardIndex];
      player.hand[handCardIndex] = player.faceUpCards[faceUpCardIndex];
      player.faceUpCards[faceUpCardIndex] = temp;
      
      return true;
  }

  public setPlayerReady(playerId: string): void {
      if (this.state.status !== 'setup') return;
      const player = this.state.players.find(p => p.id === playerId);
      if (player) {
          player.isReady = true;
          this.checkAllReady();
      }
  }

  private checkAllReady(): void {
      if (this.state.players.every(p => p.isReady)) {
          this.state.status = 'playing';
      }
  }


  public playCards(playerId: string, cardIds: string[]): boolean {
    if (this.state.status !== 'playing') return false;
    if (this.state.currentTurnPlayerId !== playerId) return false;
    
    const player = this.state.players.find(p => p.id === playerId);
    if (!player) return false;

    // Find cards - could be in hand, faceUp, or faceDown (blind play)
    // Rules: Hand first. If empty, FaceUp. If empty, FaceDown.
    let source: 'hand' | 'faceUp' | 'faceDown' = 'hand';
    let cardsToPlay: Card[] = [];

    if (player.hand.length > 0) {
        cardsToPlay = player.hand.filter(c => cardIds.includes(c.id));
        source = 'hand';
    } else if (player.faceUpCards.length > 0) {
        cardsToPlay = player.faceUpCards.filter(c => cardIds.includes(c.id));
        source = 'faceUp';
    } else {
        cardsToPlay = player.faceDownCards.filter(c => cardIds.includes(c.id));
        source = 'faceDown';
    }

    if (cardsToPlay.length === 0) return false;

    // Validate move
    const topCard = this.state.discardPile[this.state.discardPile.length - 1];
    
    // Check if cards are same rank (if multiple)
    const firstRank = cardsToPlay[0].rank;
    if (!cardsToPlay.every(c => c.rank === firstRank)) return false;

    // Special card logic
    const isTwo = firstRank === '2';
    const isTen = firstRank === '10';
    const isSeven = firstRank === '7'; // 7 is not special play-wise, but valid on anything? "The next player will have to play a card lower than 7"
    // Wait, prompt says: "On their turn a player can play the 7 on any card... They can also play the other special cards like 2 or 10"
    // So 2, 7, 10 are playable on anything.
    
    const isSpecialPlayableOnAny = isTwo || isTen || isSeven;

    let isValid = false;
    
    if (isSpecialPlayableOnAny) {
        isValid = true;
    } else if (!topCard) {
        isValid = true;
    } else {
        // Normal comparison
        // "equal to or higher value"
        // Need value mapping
        const playValue = this.getCardValue(cardsToPlay[0]);
        const topValue = this.getCardValue(topCard);

        if (this.state.lastPlayWasSeven) {
            // Must play LOWER or equal? Prompt: "Next player will have to play a card lower than 7" (and we assume equal is usually disallowed if checks are strictly lower, but wording is "lower than 7")
            // Actually, usually 7 forces <= 7. "Lower than 7" implies < 7.
            // Let's assume <= 7 for now based on "lower than". If I play a 6, it's lower.
            // But can I play an 8? No.
            // Also 2, 7, 10 are always playable.
            isValid = playValue <= 7; 
        } else {
            isValid = playValue >= topValue;
        }
    }

    // Attempt blind play logic handling
    if (source === 'faceDown' && !isValid) {
        // Failed blind play -> Pick up discard pile + the failed card
        // Reveal the card
        player.faceDownCards = player.faceDownCards.filter(c => !cardIds.includes(c.id));
        player.hand.push(...this.state.discardPile, ...cardsToPlay);
        this.state.discardPile = [];
        this.cardPlayFailed();
        return true; 
    }

    if (!isValid) return false;

    // Execute play
    // Remove from source
    if (source === 'hand') player.hand = player.hand.filter(c => !cardIds.includes(c.id));
    if (source === 'faceUp') player.faceUpCards = player.faceUpCards.filter(c => !cardIds.includes(c.id));
    if (source === 'faceDown') player.faceDownCards = player.faceDownCards.filter(c => !cardIds.includes(c.id));

    // Add to discard
    // 10 burns the pile
    if (isTen) {
        this.state.discardPile = []; // "Takes the discard pile out of the game"
    } else {
        this.state.discardPile.push(...cardsToPlay);
    }

    // Draw up to 5 cards
    // "players will draw a card after they play a card from their hand"
    // Assuming this means maintaining the hand size of 5.
    while (player.hand.length < 5 && this.state.drawPile.length > 0) {
        const drawn = this.state.drawPile.pop();
        if (drawn) player.hand.push(drawn);
    }

    // Check win condition
    if (player.hand.length === 0 && player.faceUpCards.length === 0 && player.faceDownCards.length === 0) {
        this.state.winnerId = player.id;
        this.state.status = 'finished';
        return true;
    }

    // Effect of 2: Resets discard pile to 2 (effectively clears value requirement, but card stays?)
    // "On their turn a player can play any 2 card which resets the discard pile to 2, starting the sequence all over."
    // This usually means the value requirements reset.
    
    // Effect of 7: Next player constraints.
    // "play the 7... next player will have to play a card lower than 7"
    this.state.lastPlayWasSeven = isSeven;
    
    // Advance turn
    // Only 2 lets the same player go again.
    if (!isTwo) {
        this.advanceTurn();
    }
    
    return true;
  }

  public pickUpDiscard(playerId: string): void {
      if (this.state.status !== 'playing') return;
      if (this.state.currentTurnPlayerId !== playerId) return;
      
      const player = this.state.players.find(p => p.id === playerId);
      if (!player) return;

      if (this.state.discardPile.length > 0) {
        player.hand.push(...this.state.discardPile);
        this.state.discardPile = [];
      }
      
      this.state.lastPlayWasSeven = false; // Reset 7 effect if pile picked up
      this.advanceTurn();
  }

  private advanceTurn(): void {
      // Simple round robin for now
      const currentIndex = this.state.players.findIndex(p => p.id === this.state.currentTurnPlayerId);
      const nextIndex = (currentIndex + this.state.direction + this.state.players.length) % this.state.players.length;
      this.state.currentTurnPlayerId = this.state.players[nextIndex].id;
  }

    private cardPlayFailed() {
      this.state.lastPlayWasSeven = false;
      this.advanceTurn();
  }

  private createDeck(numDecks: number): Card[] {
      const suits: Suit[] = ['hearts', 'diamonds', 'clubs', 'spades'];
      const ranks: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
      const deck: Card[] = [];

      for (let i = 0; i < numDecks; i++) {
          for (const suit of suits) {
              for (const rank of ranks) {
                  deck.push({
                      suit,
                      rank,
                      value: this.getRankValue(rank),
                      id: `${i}-${suit}-${rank}-${Math.random().toString(36).substr(2, 5)}`
                  });
              }
          }
      }
      return this.shuffle(deck);
  }

  private getRankValue(rank: Rank): number {
        const map: Record<Rank, number> = {
            '2': 2, 
            '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
          'J': 11, 'Q': 12, 'K': 13, 'A': 14
      };
      // 2 is special, handle in logic, but raw value 2 is fine as long as we check isTwo flag
      return map[rank];
  }

  private getCardValue(card: Card): number {
      return this.getRankValue(card.rank);
  }

  private shuffle(deck: Card[]): Card[] {
      for (let i = deck.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [deck[i], deck[j]] = [deck[j], deck[i]];
      }
      return deck;
  }

  private drawCardsFromDeck(count: number): Card[] {
      const drawn = [];
      for (let i = 0; i < count; i++) {
          const card = this.state.drawPile.pop();
          if (card) drawn.push(card);
      }
      return drawn;
  }
}
