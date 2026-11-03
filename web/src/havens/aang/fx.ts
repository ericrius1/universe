// What a move does to the air this frame (aang/air.ts draws it; play/powers.ts sets it for Aang as the player): wind off
// each hand's path, a strike's gust off each palm (peaking at the hit), a whirlwind round him (its turn), the air
// scooter's ball (its centre, body frame), the marbles' ring between his palms (its middle, its axis in the body frame,
// its radius), a burst of air at his feet (taking off, landing), leaves and dust lifted round him. (boulder's
// aang/moves.ts MoveFx, without his dances.)
import type { V3 } from '../hero/math';

export interface MoveFx {
  trail: [number, number]; gust: [number, number]; whirl: number; spin: number;
  ball: number; ballAt: V3; ballR: number; marbles: number; marblesAt: V3; marblesN: V3; marblesR: number; puff: number; lift: number;
}
export const noFx = (o: Partial<MoveFx> = {}): MoveFx => ({
  trail: [0, 0], gust: [0, 0], whirl: 0, spin: 1, ball: 0, ballAt: [0, 0, 0], ballR: 0.3, marbles: 0, marblesAt: [0, 0, 0], marblesN: [0, 1, 0], marblesR: 0.065,
  puff: 0, lift: 0, ...o,
});
