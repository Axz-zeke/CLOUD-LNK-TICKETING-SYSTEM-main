/**
 * Web Audio API synthesized dual-tone notification chime for 100% air-gapped environments.
 * Ramps frequency from 440Hz to 880Hz over 150ms with a clean exponential envelope.
 * Zero external audio files or network requests required.
 */
export function playNotificationChime(): void {
  try {
    if (typeof window === 'undefined') return;

    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    // Dual-tone frequency ramp: 440Hz to 880Hz across 150ms
    osc.frequency.setValueAtTime(440, now);
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.15);

    // Audio envelope to avoid clicks
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.25, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.15);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.15);

    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 300);
  } catch {
    // Gracefully handle restricted audio environments
  }
}
