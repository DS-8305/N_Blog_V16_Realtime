export type TypingSpeedName = 'fast' | 'normal' | 'slow';
export interface TypingSpeedProfile {
  keyDelayMs: number;
  linePauseMs: number;
  blockPauseMs: number;
}
export const typingSpeeds: Record<TypingSpeedName, TypingSpeedProfile> = {
  fast: { keyDelayMs: 20, linePauseMs: 120, blockPauseMs: 260 },
  normal: { keyDelayMs: 45, linePauseMs: 220, blockPauseMs: 450 },
  slow: { keyDelayMs: 85, linePauseMs: 420, blockPauseMs: 800 },
};
