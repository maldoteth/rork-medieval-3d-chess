/**
 * The wire between this game and whatever is hosting it.
 * ======================================================
 * On dehub.io the game runs inside an iframe sandboxed WITHOUT
 * `allow-same-origin`, so the frame is an opaque origin: no shared storage, no
 * shared DOM, and `postMessage` is the only channel. In the DeHub mobile app
 * the same build runs inside a React Native WebView, where the channel is
 * `window.ReactNativeWebView.postMessage` outbound and injected script events
 * inbound. This module speaks both without knowing which host it has.
 *
 * The game NEVER talks to a network from here. Matchmaking, identity, wallets
 * and the match server are the host's business; the game is a board that
 * reports the moves made on it and plays the moves it is told. That split is
 * what lets the frame stay sandboxed — nothing inside it is worth stealing.
 *
 * OUTBOUND (game → host), all stamped `source: "chess-game"`:
 *   bridge-ready                     the bridge is listening; safe to `start`
 *   move { from,to,promotion,san,fen } the local player moved; fen is post-move
 *   resign                           the local player lowered the banner
 *   game-ended { winner, reason }    the board reached a verdict on its own
 *   desync { fen }                   a served move was illegal here — the two
 *                                    boards disagree; restart from server FEN
 *   exit                             the player asked to leave (settings button)
 *
 * INBOUND (host → game), all required to carry `source: "dehub-host"`:
 *   start { color, clockMs, fen?, opponent? }  begin an online match
 *   opponent-move { from, to, promotion? }     the other side moved
 *   clock { whiteMs, blackMs }                 server clock sync
 *   result { winner, reason }                  server-authoritative verdict
 *
 * Any frame on a page can post to any other, and an opaque-origin frame posts
 * with `origin: "null"`, so origins prove nothing here. The `source` field is
 * the discriminator instead — same convention as the existing exit bridge.
 */

import type { Faction, PieceKind, SquareId } from "./types";

export const GAME_SOURCE = "chess-game";
export const HOST_SOURCE = "dehub-host";

declare global {
  interface Window {
    /** Present only inside a React Native WebView. Takes strings, not objects. */
    ReactNativeWebView?: { postMessage(data: string): void };
  }
}

export interface HostStart {
  color: Faction;
  /** Per-side starting time in ms, or null for an untimed duel. */
  clockMs: number | null;
  /** Position to open from; absent means the initial position. */
  fen?: string;
  /** Display name of the other player, when the host knows it. */
  opponent?: string;
}

export interface HostMessage {
  source?: string;
  type?: string;
  [key: string]: unknown;
}

/**
 * Posts to every host shape at once. An iframe parent that is this window is
 * skipped (standalone deploy); a missing ReactNativeWebView is skipped; a host
 * that has navigated away throws, and losing it is not an error worth
 * surfacing mid-game.
 */
export function postToHost(message: Record<string, unknown>): void {
  const payload = { source: GAME_SOURCE, ...message };
  try {
    if (window.parent !== window) window.parent.postMessage(payload, "*");
  } catch {
    // Host gone; nothing to tell it.
  }
  try {
    window.ReactNativeWebView?.postMessage(JSON.stringify(payload));
  } catch {
    // Same.
  }
}

/**
 * Listens for host messages on both delivery paths: `window` (iframes, RN on
 * iOS) and `document` (RN on Android delivers injected messages there).
 * A React Native host sends strings; an iframe host sends structured clones —
 * both are accepted, anything unparseable or unstamped is ignored.
 */
export function onHostMessage(handler: (message: HostMessage) => void): () => void {
  const listen = (event: Event): void => {
    const raw = (event as MessageEvent).data;
    let data: unknown = raw;
    if (typeof raw === "string") {
      try {
        data = JSON.parse(raw);
      } catch {
        return;
      }
    }
    if (!data || typeof data !== "object") return;
    const message = data as HostMessage;
    if (message.source !== HOST_SOURCE || typeof message.type !== "string") return;
    handler(message);
  };
  window.addEventListener("message", listen);
  document.addEventListener("message", listen as EventListener);
  return () => {
    window.removeEventListener("message", listen);
    document.removeEventListener("message", listen as EventListener);
  };
}

/**
 * Whether the host asked for an online session in the frame URL — the flag
 * that suppresses the local menu so a player waiting for an opponent cannot
 * wander into a game against the machine while the summons is out.
 *
 * In the hash, not the query string: the host may add it to a URL it does not
 * otherwise control, and a hash never busts an HTTP cache.
 */
export function isOnlineHost(): boolean {
  if (typeof window === "undefined") return false;
  return window.location.hash.includes("online");
}
