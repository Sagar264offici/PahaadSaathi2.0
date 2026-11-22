/**
 * PAHAADSAATHI — Embedding Similarity & Serialization
 * Computes cosine similarities, validates dimensions, and provides Int8 quantization.
 */

import { QuantizedEmbedding, SemanticSimilarityResult } from '@/types/semanticEvidence';

export class EmbeddingSimilarityService {
  /**
   * Checks whether vector embeddings are enabled in environment.
   */
  static isEmbeddingsEnabled(): boolean {
    const val =
      process.env.EXPO_PUBLIC_IMAGE_EMBEDDINGS_ENABLED ||
      process.env.IMAGE_EMBEDDINGS_ENABLED ||
      'false';
    return val === 'true';
  }

  /**
   * Computes cosine similarity between two numeric vectors.
   * Assumes normalized unit vectors: dot product u · v
   */
  static cosineSimilarity(a: number[], b: number[]): number {
    if (!a || !b || a.length === 0 || b.length === 0) {
      throw new Error('Vectors cannot be empty');
    }
    if (a.length !== b.length) {
      throw new Error(`Vector dimension mismatch: vector A (${a.length}) vs vector B (${b.length})`);
    }

    let dot = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      const valA = a[i];
      const valB = b[i];

      if (isNaN(valA) || !isFinite(valA) || isNaN(valB) || !isFinite(valB)) {
        throw new Error('Vector contains invalid NaN or infinite numeric values');
      }

      dot += valA * valB;
      normA += valA * valA;
      normB += valB * valB;
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    if (denominator === 0) return 0;

    const similarity = dot / denominator;
    return Math.max(-1, Math.min(1, Number(similarity.toFixed(4))));
  }

  /**
   * Normalizes a vector to unit length (L2 norm = 1.0).
   */
  static normalize(vector: number[]): number[] {
    let sumSquares = 0;
    for (const v of vector) {
      if (isNaN(v) || !isFinite(v)) {
        throw new Error('Cannot normalize vector with NaN or infinite values');
      }
      sumSquares += v * v;
    }
    const magnitude = Math.sqrt(sumSquares);
    if (magnitude === 0) return vector.map(() => 0);
    return vector.map((v) => Number((v / magnitude).toFixed(6)));
  }

  /**
   * Quantizes float32 array to int8 representation (1 byte per dimension).
   */
  static quantizeToInt8(values: number[]): QuantizedEmbedding {
    if (!values || values.length === 0) {
      throw new Error('Cannot quantize empty vector');
    }

    let min = Infinity;
    let max = -Infinity;
    for (const v of values) {
      if (v < min) min = v;
      if (v > max) max = v;
    }

    // Edge case: all identical values
    if (min === max) {
      return {
        scale: 1,
        zeroPoint: 0,
        dimensions: values.length,
        quantizedValues: new Array(values.length).fill(0),
      };
    }

    const scale = (max - min) / 255;
    const zeroPoint = Math.round(-min / scale) - 128;

    const quantizedValues = values.map((v) => {
      const q = Math.round(v / scale) + zeroPoint;
      return Math.max(-128, Math.min(127, q));
    });

    return {
      scale,
      zeroPoint,
      dimensions: values.length,
      quantizedValues,
    };
  }

  /**
   * Dequantizes int8 array back to float array.
   */
  static dequantizeFromInt8(quantized: QuantizedEmbedding): number[] {
    const { scale, zeroPoint, quantizedValues } = quantized;
    return quantizedValues.map((q) => Number(((q - zeroPoint) * scale).toFixed(6)));
  }

  /**
   * Finds top K similar reports based on cosine similarity.
   */
  static findTopSimilar(
    queryVector: number[],
    candidates: Array<{ hazardId: string; vector: number[]; description?: string }>,
    topK: number = 3,
    minThreshold: number = 0.70
  ): SemanticSimilarityResult[] {
    const results: SemanticSimilarityResult[] = [];

    for (const c of candidates) {
      try {
        const sim = this.cosineSimilarity(queryVector, c.vector);
        if (sim >= minThreshold) {
          results.push({
            hazardId: c.hazardId,
            similarity: sim,
            description: c.description,
          });
        }
      } catch {}
    }

    return results.sort((a, b) => b.similarity - a.similarity).slice(0, topK);
  }
}
