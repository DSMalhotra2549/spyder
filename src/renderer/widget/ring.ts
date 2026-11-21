// Ring: a 3-note chime (~1 s) via WebAudio (plan §12).
let ac: AudioContext | null = null;

export function playChime(): void {
  ac ??= new AudioContext();
  void ac.resume();
  const t0 = ac.currentTime + 0.02;
  [1046.5, 1318.5, 1568].forEach((freq, i) => {
    const osc = ac!.createOscillator();
    const gain = ac!.createGain();
    const t = t0 + i * 0.22;
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.25, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
    osc.connect(gain).connect(ac!.destination);
    osc.start(t);
    osc.stop(t + 0.6);
  });
}
