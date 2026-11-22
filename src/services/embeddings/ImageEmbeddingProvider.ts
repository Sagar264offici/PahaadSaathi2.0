/**
 * PAHAADSAATHI — Vector Embedding Provider Abstraction
 * Supports pluggable models (MobileCLIP, NV-CLIP, or mock) for visual similarity retrieval.
 */

import { ImageEmbeddingResult } from '@/types/semanticEvidence';

export interface ImageEmbeddingProvider {
  readonly providerName: string;
  readonly modelName: string;
  readonly modelVersion: string;
  readonly dimensions: number;

  generateEmbedding(imageUriOrBase64: string): Promise<ImageEmbeddingResult>;
}
