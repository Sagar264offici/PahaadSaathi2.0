/**
 * PAHAADSAATHI — Deterministic Mock Embedding Provider
 * Generates 512-dimensional normalized unit vectors for offline testing and benchmarking.
 */

import { ImageEmbeddingProvider } from './ImageEmbeddingProvider';
import { ImageEmbeddingResult } from '@/types/semanticEvidence';
import { EmbeddingSimilarityService } from './EmbeddingSimilarity';
import { ImageHashService } from '../media/ImageHash';

export class MockEmbeddingProvider implements ImageEmbeddingProvider {
  readonly providerName = 'mock_offline';
  readonly modelName = 'pahaadsaathi_vis_embed';
  readonly modelVersion = '1.0.0';
  readonly dimensions = 512;

  async generateEmbedding(imageUriOrBase64: string): Promise<ImageEmbeddingResult> {
    const hash = ImageHashService.computeSha256(imageUriOrBase64);
    const rawVector: number[] = new Array(this.dimensions);

    // Deterministically seed 512 floating point coordinates from hash bytes
    for (let i = 0; i < this.dimensions; i++) {
      const charCodeA = hash.charCodeAt(i % hash.length);
      const charCodeB = hash.charCodeAt((i * 3 + 7) % hash.length);
      const rawVal = Math.sin((charCodeA * 100 + charCodeB + i) * 0.1);
      rawVector[i] = rawVal;
    }

    const normalized = EmbeddingSimilarityService.normalize(rawVector);

    return {
      provider: this.providerName,
      model: this.modelName,
      modelVersion: this.modelVersion,
      dimensions: this.dimensions,
      values: normalized,
      normalized: true,
    };
  }
}
