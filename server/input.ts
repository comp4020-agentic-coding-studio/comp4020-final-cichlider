// What a player is allowed to send. The server is the only thing that moves
// rollers, so all a client can say is which of the five actions it wants.

import type { Move, Turn } from "./world.ts";

const STEPS = [-1, 0, 1];

// Returns the cleaned input, or a string saying what's wrong with it.
export function parseInput(body: unknown): { move: Move; turn: Turn } | string {
  if (!body || typeof body !== "object") return "input must be an object";
  const b = body as Record<string, unknown>;
  if (!STEPS.includes(b.move as number)) return "move must be -1 (back), 0 (still) or 1 (forward)";
  if (!STEPS.includes(b.turn as number)) return "turn must be -1 (left), 0 (straight) or 1 (right)";
  return { move: b.move as Move, turn: b.turn as Turn };
}

// A visitor's tag: what other people see over their roller.
export function cleanName(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const name = v.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 24);
  return name.length > 0 ? name : null;
}
