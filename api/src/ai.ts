/* ---------- AI port: deterministic mock (used in CI and when no key is set) ---------- */
import { fuse as mockFuse, cardTitle as mockTitle, TraitAgg } from './domain.js';
/** Bytes produced by a model (image or audio) plus their MIME type. */
export type GeneratedMedia = { body: Buffer; type: string };
export interface Ai { cardTitle(traits: string[], story?: string): Promise<string>; cardArt(prompt: string): Promise<GeneratedMedia | null>; polish(story: string, friend: string): Promise<string>; enrichCandidates(traits: TraitAgg[], avoid?: { tags: string[]; cards: number }): Promise<ReturnType<typeof mockFuse>>; provider: string }
export class MockAi implements Ai {
  provider = 'mock';
  async cardTitle(traits: string[]) { return mockTitle(traits); }
  async enrichCandidates(traits: TraitAgg[], avoid?: { tags: string[]; cards: number }) { return mockFuse(traits, 2, avoid); }
  async cardArt(_prompt: string): Promise<GeneratedMedia | null> { return null; }
  async polish(story: string, _friend?: string) { return story; }
}
