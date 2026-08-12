// DEHUB PATCH (1 of 3) — see public/chess-game/README.md in the dehubweb repo.
//
// Upstream loads the search worker by URL:
//
//   new Worker(new URL("./engine.worker.ts", import.meta.url), { type: "module" })
//
// dehub.io embeds this build in an iframe sandboxed WITHOUT `allow-same-origin`,
// so the frame runs in an opaque origin. A URL-addressed worker is then refused
// outright — "Script at '…/engine.worker.js' cannot be accessed from origin
// 'null'" — and a module worker fails even from a blob, because module scripts
// are always fetched in CORS mode. Both were measured in Chromium, not guessed.
//
// A CLASSIC worker over an inlined script is the one form that survives an
// opaque origin, and `?worker&inline` is exactly that: Vite embeds the compiled
// worker in the bundle and hands back a wrapper that constructs it from a
// blob/data URL with no `type`. Nothing about the search itself changes, and it
// still runs off the main thread.
import EngineWorker from "./engine.worker.ts?worker&inline";

import type { Difficulty, PieceKind, SquareId } from "../core/types";

interface EngineReply {
  id: number;
  from: SquareId;
  to: SquareId;
  promotion: string | null;
  score: number;
  depth: number;
}

export interface EngineMove {
  from: SquareId;
  to: SquareId;
  promotion: PieceKind | null;
  score: number;
  depth: number;
}

/**
 * Main-thread handle for the search worker. Only one search runs at a time;
 * `cancel()` invalidates any in-flight result (new game, undo, resign).
 */
export class AiClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending: { id: number; resolve: (move: EngineMove | null) => void } | null = null;

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new EngineWorker();
    worker.onmessage = (event: MessageEvent<EngineReply | null>) => {
      const pending = this.pending;
      if (!pending) return;
      const data = event.data;
      if (data && data.id !== pending.id) return;
      this.pending = null;
      pending.resolve(
        data
          ? {
              from: data.from,
              to: data.to,
              promotion: (data.promotion as PieceKind | null) ?? null,
              score: data.score,
              depth: data.depth,
            }
          : null,
      );
    };
    worker.onerror = (event) => {
      console.error("[ai] worker error", event.message);
      const pending = this.pending;
      this.pending = null;
      pending?.resolve(null);
    };
    this.worker = worker;
    return worker;
  }

  bestMove(fen: string, difficulty: Difficulty): Promise<EngineMove | null> {
    this.cancel();
    const worker = this.ensureWorker();
    const id = this.nextId++;
    return new Promise<EngineMove | null>((resolve) => {
      this.pending = { id, resolve };
      worker.postMessage({ id, fen, difficulty });
    });
  }

  /** Drops the current request; a late reply is ignored. */
  cancel(): void {
    const pending = this.pending;
    this.pending = null;
    pending?.resolve(null);
  }

  dispose(): void {
    this.cancel();
    this.worker?.terminate();
    this.worker = null;
  }
}
