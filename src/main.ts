import './style.css'
import { initializeAbly, getChannel } from './ablyClient';
import { GameManager } from './gameManager';
import type { GameState, Card, Player } from './types';

const app = document.querySelector<HTMLDivElement>('#app')!;
let gameManager: GameManager;
let myClientId: string;
let myChannel: any;
let selectedCards: string[] = [];

// Simple router check
const checkRoute = async () => {
  const path = window.location.pathname;
  const match = path.match(/^\/room\/([a-zA-Z0-9-]+)$/);

  if (match) {
    const roomId = match[1];
    showJoiningUI(roomId);
    await connectToAbly(roomId);
  } else {
    showCreateGameUI();
  }
};

const showCreateGameUI = () => {
  app.innerHTML = `
    <div class="container center-screen">
      <h1>Castle Game</h1>
      <button id="create-game-btn" class="primary-btn">Create Game</button>
    </div>
  `;

  document.getElementById('create-game-btn')?.addEventListener('click', () => {
    const roomId = Math.random().toString(36).substring(2, 9);
    window.history.pushState({}, '', `/room/${roomId}`);
    checkRoute();
  });
};

const showJoiningUI = (roomId: string) => {
  app.innerHTML = `
    <div class="container">
      <div id="status-bar">Room: ${roomId} | <span id="status">Connecting...</span></div>
      
      <div id="game-area"></div>
      
      <div id="lobby-area" class="lobby">
        <div id="game-link-section" style="display:none;">
            <h3>Invite Friends</h3>
            <div class="link-box">
                <input type="text" value="${window.location.href}" id="game-link" readonly>
                <button id="copy-link-btn">Copy</button>
            </div>
            <span id="copy-status"></span>
        </div>
        
        <div class="player-list">
            <h3>Players (<span id="user-count">0</span>)</h3>
            <ul id="players-ul"></ul>
        </div>
        
        <button id="start-game-btn" class="primary-btn" disabled>Start Game</button>
      </div>
    </div>
  `;
};

const connectToAbly = async (roomId: string) => {
  try {
    const apiKey = import.meta.env.VITE_ABLY_API_KEY;
    if (!apiKey) {
       console.warn("Ably API Key missing.");
       const statusDiv = document.getElementById('status');
       if (statusDiv) statusDiv.innerHTML = "Error: API Key missing.";
       return;
    }

    // Generate ID
    myClientId = Math.random().toString(36).substring(2, 8);
    
    initializeAbly(apiKey, myClientId);
    const channel = getChannel(roomId);
    myChannel = channel;
    
    // Initialize GameManager locally
    gameManager = new GameManager();

    const statusDiv = document.getElementById('status');
    if (statusDiv) statusDiv.innerHTML = `Connected as ${myClientId}`;

    // Show lobby elements
    const linkSection = document.getElementById('game-link-section');
    if (linkSection) linkSection.style.display = 'block';

    // Verify connection & Presence
    channel.on('attached', async () => {
      await channel.presence.enter({ name: `Player ${myClientId}` });
    });

    // Subscribe to game state updates
    channel.subscribe('game-state', (message) => {
        const newState = message.data as GameState;
        
        // Render
        renderGame(newState);
        
        // Update local logic state
        // In a real app we'd verify hash or ensure valid transitions.
        // Here we just accept the source of truth from channel.
        // We create a new manager with this state to handle next logic steps.
        gameManager = new GameManager(newState);
        
        // Hide lobby if game started
        const lobby = document.getElementById('lobby-area');
        if (newState.status === 'playing' && lobby) {
            lobby.style.display = 'none';
        }
    });

    setupLobbyListeners(channel);

  } catch (error) {
    console.error("Failed to connect", error);
  }
};

const setupLobbyListeners = (channel: any) => {
    // Copy Link
    document.getElementById('copy-link-btn')?.addEventListener('click', () => {
        navigator.clipboard.writeText(window.location.href);
        const s = document.getElementById('copy-status');
        if(s) { s.innerText = 'Copied!'; setTimeout(() => s.innerText='', 2000); }
    });

    // Start Game
    const startBtn = document.getElementById('start-game-btn') as HTMLButtonElement;
    startBtn?.addEventListener('click', async () => {
        // Get current players from presence
        const members = await channel.presence.get();
        // Add players to game manager
        // Clear existing just in case
        gameManager = new GameManager();
        
        members.forEach((m:any) => {
            gameManager.addPlayer(m.clientId, m.data?.name || m.clientId);
        });
        
        gameManager.startGame();
        const state = gameManager.getState();
        channel.publish('game-state', state);
    });

    // Presence updates for Lobby
    const updateLobby = async () => {
        const members = await channel.presence.get();
        const countSpan = document.getElementById('user-count');
        const list = document.getElementById('players-ul');
        const startBtn = document.getElementById('start-game-btn') as HTMLButtonElement;
        
        if (countSpan) countSpan.innerText = members.length.toString();
        if (list) {
            list.innerHTML = members.map((m:any) => `<li>${m.clientId} ${m.clientId === myClientId ? '(You)' : ''}</li>`).join('');
        }
        
        if (startBtn) {
            // Need at least 2 players
            startBtn.disabled = members.length < 2; 
        }
    };
    
    channel.presence.subscribe('enter', updateLobby);
    channel.presence.subscribe('leave', updateLobby);
    // Also update on present to get initial list if we joined late
    channel.presence.subscribe('present', updateLobby); 
    updateLobby();
};

const renderGame = (state: GameState) => {
    const gameArea = document.getElementById('game-area');
    if (!gameArea) return;
    
    // If waiting, render nothing (lobby is shown)
    if (state.status === 'waiting') {
        gameArea.innerHTML = ''; 
        return;
    }

    // Identify my player
    const me = state.players.find(p => p.id === myClientId);
    if (!me) {
        // Spectator view (or joined mid-game)
        gameArea.innerHTML = '<div class="spectator-msg"><h1>Game in progress. You are a spectator.</h1></div>';
        return;
    }

    // Setup Phase View
    if (state.status === 'setup') {
        renderSetupPhase(state, me);
        return;
    }
    
    const isMyTurn = state.currentTurnPlayerId === myClientId;
    
    // Top card
    const topDiscard = state.discardPile.length > 0 ? state.discardPile[state.discardPile.length-1] : null;

    // Render HTML
    let html = `
        <div class="game-board">
            <div class="top-info">
                <div class="info-badge">Turn: <span class="${isMyTurn ? 'highlight-turn' : ''}">${isMyTurn ? "YOUR TURN" : (state.players.find(p=>p.id===state.currentTurnPlayerId)?.name || 'Unknown')}</span></div>
                <div class="info-badge">Deck: ${state.drawPile.length}</div>
                <div class="info-badge">Discard: ${state.discardPile.length}</div>
                ${state.winnerId ? `<div class="winner-banner">Winner: ${state.winnerId}</div>` : ''}
            </div>
            
            <!-- Opponents -->
            <div class="opponents-row">
                ${state.players.filter(p => p.id !== myClientId).map(p => `
                    <div class="opponent-card ${state.currentTurnPlayerId === p.id ? 'active-turn-glow' : ''}">
                        <div class="opponent-name">${p.name}</div>
                        <div class="opponent-stats">
                            <div>🖐️ ${p.hand.length}</div>
                            <div>⬆️ ${p.faceUpCards.length}</div>
                            <div>⬇️ ${p.faceDownCards.length}</div>
                        </div>
                        <div class="opponent-face-up">
                            ${p.faceUpCards.map(c => renderMiniCard(c)).join('')}
                        </div>
                    </div>
                `).join('')}
            </div>

            <!-- Center Stacks -->
            <div class="center-table">
                <div class="stack draw-pile card-back">
                    <span>${state.drawPile.length}</span>
                </div>
                <div class="stack discard-pile" id="discard-pile">
                    ${topDiscard ? renderCard(topDiscard) : '<div class="empty-text">Discard</div>'}
                </div>
            </div>

            <!-- My Area -->
            <div class="my-area ${isMyTurn ? 'my-turn-active' : ''}">
                
                <!-- Table Cards (Face Down + Face Up) -->
                <div class="my-table-cards">
                    ${renderTableCards(me)}
                </div>

                <!-- Hand -->
                <div class="my-hand">
                    ${me.hand.map(c => renderCard(c, true)).join('')}
                </div>
                
                <!-- Actions -->
                <div class="action-bar">
                     <button id="play-btn" class="primary-btn" disabled>Play Selected</button>
                     <button id="pickup-btn" class="secondary-btn" ${!isMyTurn ? 'disabled' : ''}>Pick Up Pile</button>
                </div>
            </div>
        </div>
    `;
    
    gameArea.innerHTML = html;
    
    attachGameListeners(isMyTurn);
};

const renderSetupPhase = (state: GameState, me: Player) => {
    const gameArea = document.getElementById('game-area');
    if (!gameArea) return;

    let html = `
        <div class="container center-screen setup-container">
            <h2>Setup Phase</h2>
            <p>Select one card from your hand and one face-up card to swap them. Click "Ready" when you are done.</p>
            
            <div class="status-summary">
                 ${state.players.map(p => `<span class="${p.isReady ? 'ready' : 'not-ready'}">${p.name}: ${p.isReady ? 'READY' : '...'}</span>`).join(' | ')}
            </div>

            <div class="setup-area">
                <div class="face-up-group">
                    <h3>Face Up Cards</h3>
                    <div class="cards-row">
                        ${me.faceUpCards.map(c => renderCard(c, false, 'setup-card face-up', 'faceUp')).join('')}
                    </div>
                </div>

                <div class="hand-group">
                    <h3>Your Hand</h3>
                    <div class="cards-row">
                        ${me.hand.map(c => renderCard(c, true, 'setup-card hand', 'hand')).join('')}
                    </div>
                </div>
            </div>

            <button id="ready-btn" class="primary-btn" ${me.isReady ? 'disabled' : ''}>${me.isReady ? 'Waiting for others...' : 'Ready to Start'}</button>
        </div>
    `;

    gameArea.innerHTML = html;
    
    // Attach setup listeners
    let selection: { id: string, source: 'hand' | 'faceUp' } | null = null;

    document.querySelectorAll('.setup-card').forEach(el => {
        el.addEventListener('click', (e) => {
            if (me.isReady) return; // Locked

            const cardEl = e.currentTarget as HTMLElement;
            const cardId = cardEl.dataset.id!;
            const source = cardEl.dataset.source as 'hand' | 'faceUp';

            if (!selection) {
                // Select first
                selection = { id: cardId, source };
                cardEl.classList.add('selected');
            } else {
                // Select second
                if (selection.id === cardId) {
                    // Deselect
                    selection = null;
                    cardEl.classList.remove('selected');
                } else if (selection.source === source) {
                    // Switch selection (same group)
                    document.querySelectorAll('.setup-card').forEach(c => c.classList.remove('selected'));
                    selection = { id: cardId, source };
                    cardEl.classList.add('selected');
                } else {
                    // Swap!
                    confirmSwap(selection.id, cardId); // One from hand, one from faceUp
                    selection = null;
                }
            }
        });
    });

    document.getElementById('ready-btn')?.addEventListener('click', () => {
        gameManager.setPlayerReady(myClientId);
        myChannel.publish('game-state', gameManager.getState());
        renderSetupPhase(gameManager.getState(), me); // optimistic update
    });
};

const confirmSwap = (id1: string, id2: string) => {
    // Attempt swap in manager
    // We don't know which is which order-wise but the manager method expects handId, faceUpId
    // We try both combinations or check state
    const p = gameManager.getState().players.find(p => p.id === myClientId);
    if (!p) return;

    let handId = p.hand.find(c => c.id === id1) ? id1 : id2;
    let faceUpId = p.faceUpCards.find(c => c.id === id1) ? id1 : id2;
    
    // logic check: ensure we actually have one of each
    if (handId === faceUpId) return; // both from same place? should be caught by click handler logic but strict check here.

    const success = gameManager.swapCards(myClientId, handId, faceUpId);
    if (success) {
        myChannel.publish('game-state', gameManager.getState());
        renderSetupPhase(gameManager.getState(), p); // re-render
    }
};

const renderTableCards = (player: Player) => {
    // We have 3 "slots" typically for Castle face-down cards.
    // If logic changes, we iterate faceDown array.
    // FaceUp cards sit "on top" of FaceDown cards legally?
    // Prompt says: "Place them face up on the three face down cards"
    // So visual stacking: FaceDown[0] has FaceUp[0] on top.
    
    let html = '';
    const max = Math.max(player.faceDownCards.length, player.faceUpCards.length);
    
    for (let i=0; i<max; i++) {
        const faceDown = player.faceDownCards[i];
        const faceUp = player.faceUpCards[i];
        
        html += `<div class="card-slot">`;
        
        if (faceDown) {
            // Face Down Card
             html += `<div class="card card-back face-down-card clickable" data-id="${faceDown.id}" data-source="faceDown"></div>`;
        } else {
             html += `<div class="card-placeholder"></div>`;
        }
        
        if (faceUp) {
            // Face Up Card (on top)
             html += renderCard(faceUp, false, 'face-up-card');
        }
        
        html += `</div>`;
    }
    return html;
};

const renderCard = (card: Card, _: boolean = false, extraClass: string = '', source?: string) => {
    const isSelected = selectedCards.includes(card.id);
    const colorClass = (card.suit === 'hearts' || card.suit === 'diamonds') ? 'red' : 'black'; // Fixed suit check
    return `
        <div class="card rank-${card.rank} ${colorClass} clickable ${isSelected ? 'selected' : ''} ${extraClass}" 
             data-id="${card.id}" ${source ? `data-source="${source}"` : ''}>
            <div class="card-content">
                <span class="rank-tl">${card.rank}</span>
                <span class="suit-center">${getSuitSymbol(card.suit)}</span>
                <span class="rank-br">${card.rank}</span>
            </div>
        </div>
    `;
};

const renderMiniCard = (card: Card) => {
    const colorClass = (card.suit === 'hearts' || card.suit === 'diamonds') ? 'red' : 'black';
    return `
        <div class="mini-card ${colorClass}">
            <span>${card.rank}${getSuitSymbol(card.suit)}</span>
        </div>
    `;
};

const getSuitSymbol = (suit: string) => {
    switch(suit) {
        case 'hearts': return '♥';
        case 'diamonds': return '♦';
        case 'clubs': return '♣';
        case 'spades': return '♠';
        default: return '';
    }
};

const attachGameListeners = (isMyTurn: boolean) => {
    // Card Clicks
    document.querySelectorAll('.clickable').forEach(el => {
        el.addEventListener('click', (e) => {
            if (!isMyTurn) return; // Prevent selection if not my turn? optional. simple validation.
            const cardId = (e.currentTarget as HTMLElement).dataset.id;
            if (cardId) toggleCardSelection(cardId);
        });
    });

    // Play Button
    const playBtn = document.getElementById('play-btn') as HTMLButtonElement;
    if (playBtn) {
        playBtn.disabled = selectedCards.length === 0 || !isMyTurn;
        playBtn.addEventListener('click', () => {
             const success = gameManager.playCards(myClientId, selectedCards);
             if (success) {
                 myChannel.publish('game-state', gameManager.getState());
                 selectedCards = [];
             } else {
                 alert('Invalid Move!');
                 // Optionally clear selection or shake UI
             }
        });
    }

    // Pickup Button
    document.getElementById('pickup-btn')?.addEventListener('click', () => {
        gameManager.pickUpDiscard(myClientId);
        myChannel.publish('game-state', gameManager.getState());
    });
};

const toggleCardSelection = (cardId: string) => {
    const idx = selectedCards.indexOf(cardId);
    if (idx >= 0) {
        selectedCards.splice(idx, 1);
    } else {
        selectedCards.push(cardId);
    }
    
    // Re-render essentially just to update selection classes and button state
    // We can optimization direct DOM manipulation
    document.querySelectorAll(`[data-id="${cardId}"]`).forEach(el => {
        if (idx >= 0) el.classList.remove('selected');
        else el.classList.add('selected');
    });
    
    const playBtn = document.getElementById('play-btn') as HTMLButtonElement;
    if (playBtn) playBtn.disabled = selectedCards.length === 0;
};

// Handle Browser history
window.addEventListener('popstate', checkRoute);
checkRoute();
