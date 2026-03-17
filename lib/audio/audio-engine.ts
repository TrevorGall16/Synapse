// ── Web Audio API Engine (Singleton) ──────────────────────
// Lazy-initialized on first playback. Manages per-track node
// graphs: Source → clipGain → trackGain → panner → delay → reverb → master → destination.

interface TrackAudioChain {
  source: MediaElementAudioSourceNode;
  clipGain: GainNode;
  trackGain: GainNode;
  panner: StereoPannerNode;
  delay: DelayNode;
  delayFeedback: GainNode;
  reverbWet: GainNode;
  reverbDry: GainNode;
  convolver: ConvolverNode;
}

export interface TrackAudioState {
  volume: number;
  muted: boolean;
  solo: boolean;
  pan: number;
  clipLevel: number;
  reverbWet: number;
  reverbRoomSize: number;
  delayMs: number;
  delayFeedback: number;
}

function generateImpulseResponse(ctx: AudioContext, roomSize: number): AudioBuffer {
  const duration = Math.max(0.1, (roomSize / 100) * 3);
  const length = Math.round(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2);
    }
  }
  return buffer;
}

class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private trackChains = new Map<string, TrackAudioChain>();
  private soloTracks = new Set<string>();
  private storedVolumes = new Map<string, number>();
  private lastRoomSize = new Map<string, number>();

  init(): AudioContext {
    if (this.ctx) return this.ctx;
    this.ctx = new AudioContext();
    this.masterGain = this.ctx.createGain();
    this.masterGain.connect(this.ctx.destination);
    return this.ctx;
  }

  ensureResumed() {
    if (this.ctx?.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
  }

  connectSource(trackId: string, element: HTMLMediaElement): TrackAudioChain | null {
    if (!this.ctx || !this.masterGain) return null;
    if (this.trackChains.has(trackId)) return this.trackChains.get(trackId)!;

    const source = this.ctx.createMediaElementSource(element);
    const clipGain = this.ctx.createGain();
    const trackGain = this.ctx.createGain();
    const panner = this.ctx.createStereoPanner();
    const delay = this.ctx.createDelay(5);
    const delayFeedback = this.ctx.createGain();
    const reverbWet = this.ctx.createGain();
    const reverbDry = this.ctx.createGain();
    const convolver = this.ctx.createConvolver();

    delay.delayTime.value = 0;
    delayFeedback.gain.value = 0;
    reverbWet.gain.value = 0;
    reverbDry.gain.value = 1;
    convolver.buffer = generateImpulseResponse(this.ctx, 30);

    // Source → clipGain → trackGain → panner
    source.connect(clipGain);
    clipGain.connect(trackGain);
    trackGain.connect(panner);

    // Panner → dry path → master
    panner.connect(reverbDry);
    reverbDry.connect(this.masterGain);

    // Panner → wet path → convolver → master
    panner.connect(reverbWet);
    reverbWet.connect(convolver);
    convolver.connect(this.masterGain);

    // Panner → delay → feedback loop → master
    panner.connect(delay);
    delay.connect(this.masterGain);
    delay.connect(delayFeedback);
    delayFeedback.connect(delay);

    const chain: TrackAudioChain = {
      source, clipGain, trackGain, panner,
      delay, delayFeedback, reverbWet, reverbDry, convolver,
    };
    this.trackChains.set(trackId, chain);
    return chain;
  }

  /** Remove a track's audio chain (needed when video element is recreated) */
  disconnectTrack(trackId: string) {
    const chain = this.trackChains.get(trackId);
    if (!chain) return;
    try {
      chain.source.disconnect();
      chain.clipGain.disconnect();
      chain.trackGain.disconnect();
      chain.panner.disconnect();
      chain.delay.disconnect();
      chain.delayFeedback.disconnect();
      chain.reverbWet.disconnect();
      chain.reverbDry.disconnect();
      chain.convolver.disconnect();
    } catch { /* nodes may already be disconnected */ }
    this.trackChains.delete(trackId);
    this.storedVolumes.delete(trackId);
    this.lastRoomSize.delete(trackId);
    this.soloTracks.delete(trackId);
  }

  setMasterVolume(gain: number) {
    if (this.masterGain) {
      this.masterGain.gain.value = gain / 100;
    }
  }

  setTrackVolume(trackId: string, vol: number) {
    const chain = this.trackChains.get(trackId);
    if (!chain) return;
    this.storedVolumes.set(trackId, vol / 100);
    // Only apply if not muted and (no solo active, or this track is soloed)
    if (this.soloTracks.size > 0 && !this.soloTracks.has(trackId)) return;
    chain.trackGain.gain.value = vol / 100;
  }

  setClipLevel(trackId: string, level: number) {
    const chain = this.trackChains.get(trackId);
    if (chain) chain.clipGain.gain.value = level / 100;
  }

  setTrackMute(trackId: string, muted: boolean) {
    const chain = this.trackChains.get(trackId);
    if (!chain) return;
    if (muted) {
      chain.trackGain.gain.value = 0;
    } else {
      // Restore stored volume (unless solo state overrides)
      const stored = this.storedVolumes.get(trackId) ?? 1;
      if (this.soloTracks.size > 0 && !this.soloTracks.has(trackId)) {
        chain.trackGain.gain.value = 0;
      } else {
        chain.trackGain.gain.value = stored;
      }
    }
  }

  setTrackSolo(trackId: string, solo: boolean) {
    if (solo) this.soloTracks.add(trackId);
    else this.soloTracks.delete(trackId);
    this.updateSoloState();
  }

  private updateSoloState() {
    for (const [id, chain] of this.trackChains) {
      if (this.soloTracks.size === 0) {
        // No solo active — restore all to stored volume
        chain.trackGain.gain.value = this.storedVolumes.get(id) ?? 1;
      } else {
        // Solo active — only soloed tracks get their volume
        chain.trackGain.gain.value = this.soloTracks.has(id)
          ? (this.storedVolumes.get(id) ?? 1)
          : 0;
      }
    }
  }

  setTrackPan(trackId: string, pan: number) {
    const chain = this.trackChains.get(trackId);
    if (chain) chain.panner.pan.value = Math.max(-1, Math.min(1, pan / 100));
  }

  setTrackDelay(trackId: string, delayMs: number, feedback: number) {
    const chain = this.trackChains.get(trackId);
    if (!chain) return;
    chain.delay.delayTime.value = Math.max(0, delayMs / 1000);
    chain.delayFeedback.gain.value = Math.min(0.95, feedback / 100);
  }

  setTrackReverb(trackId: string, wet: number, roomSize: number) {
    const chain = this.trackChains.get(trackId);
    if (!chain || !this.ctx) return;
    chain.reverbWet.gain.value = wet / 100;
    chain.reverbDry.gain.value = 1 - wet / 100;
    // Only regenerate impulse if room size changed (expensive)
    const prev = this.lastRoomSize.get(trackId);
    if (prev !== roomSize) {
      chain.convolver.buffer = generateImpulseResponse(this.ctx, roomSize);
      this.lastRoomSize.set(trackId, roomSize);
    }
  }

  /** Sync all audio params for a track in one call */
  syncTrackState(trackId: string, state: TrackAudioState) {
    this.setTrackVolume(trackId, state.volume);
    this.setClipLevel(trackId, state.clipLevel);
    this.setTrackPan(trackId, state.pan);
    if (state.muted) {
      this.setTrackMute(trackId, true);
    } else if (this.soloTracks.size > 0 && !this.soloTracks.has(trackId)) {
      // Keep muted by solo logic
    } else {
      this.setTrackMute(trackId, false);
    }
    this.setTrackSolo(trackId, state.solo);
    this.setTrackDelay(trackId, state.delayMs, state.delayFeedback);
    this.setTrackReverb(trackId, state.reverbWet, state.reverbRoomSize);
  }

  hasTrack(trackId: string): boolean {
    return this.trackChains.has(trackId);
  }

  destroy() {
    this.trackChains.clear();
    this.soloTracks.clear();
    this.storedVolumes.clear();
    this.lastRoomSize.clear();
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
      this.masterGain = null;
    }
  }
}

export const audioEngine = new AudioEngine();
