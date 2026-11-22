/**
 * PAHAADSAATHI — Semantic Evidence Manifest Builder & Validator
 * Enforces versioned schema compliance for visual evidence metadata.
 */

import {
  SemanticEvidenceManifest,
  StructuredVisualAnalysis,
  ImageEmbeddingResult,
} from '@/types/semanticEvidence';
import { ProcessedDerivativesResult } from './ImageCompression';

export class ImageManifestBuilder {
  /**
   * Constructs a validated SemanticEvidenceManifest from compression results.
   */
  static createInitialManifest(params: {
    reportId: string;
    imageId: string;
    derivatives: ProcessedDerivativesResult;
    uploadStatus?: {
      originalStatus?: 'local_only' | 'pending' | 'uploaded' | 'deferred';
      evidenceStatus?: 'pending' | 'uploading' | 'uploaded' | 'failed';
      previewStatus?: 'pending' | 'uploaded' | 'failed' | 'not_required';
    };
  }): SemanticEvidenceManifest {
    const { reportId, imageId, derivatives, uploadStatus } = params;

    const manifest: SemanticEvidenceManifest = {
      schemaVersion: 1,
      reportId,
      imageId,
      image: {
        mimeType: derivatives.original.mimeType,
        originalSizeBytes: derivatives.original.sizeBytes,
        evidenceSizeBytes: derivatives.evidence.sizeBytes,
        previewSizeBytes: derivatives.preview.sizeBytes,
        originalWidth: derivatives.original.width,
        originalHeight: derivatives.original.height,
        evidenceWidth: derivatives.evidence.width,
        evidenceHeight: derivatives.evidence.height,
        originalSha256: derivatives.original.sha256,
        evidenceSha256: derivatives.evidence.sha256,
        previewSha256: derivatives.preview.sha256,
        perceptualHash: derivatives.perceptualHash,
        placeholderHash: derivatives.placeholderHash,
      },
      compression: {
        format: derivatives.evidence.format,
        quality: derivatives.profile === 'strong' ? 0.82 : derivatives.profile === 'weak' ? 0.75 : 0.80,
        method: 'expo_image_manipulator_jpeg',
        compressionRatio: derivatives.compressionRatio,
        profile: derivatives.profile,
      },
      upload: {
        originalStatus: uploadStatus?.originalStatus || 'local_only',
        evidenceStatus: uploadStatus?.evidenceStatus || 'pending',
        previewStatus: uploadStatus?.previewStatus || 'pending',
      },
    };

    return manifest;
  }

  /**
   * Attaches AI visual analysis outcome to manifest.
   */
  static attachVisualAnalysis(
    manifest: SemanticEvidenceManifest,
    analysis: StructuredVisualAnalysis
  ): SemanticEvidenceManifest {
    return {
      ...manifest,
      visualAnalysis: { ...analysis },
    };
  }

  /**
   * Attaches optional embedding to manifest.
   */
  static attachEmbedding(
    manifest: SemanticEvidenceManifest,
    embedding: ImageEmbeddingResult
  ): SemanticEvidenceManifest {
    return {
      ...manifest,
      embedding: {
        provider: embedding.provider,
        model: embedding.model,
        modelVersion: embedding.modelVersion,
        dimensions: embedding.dimensions,
        normalized: embedding.normalized,
      },
    };
  }

  /**
   * Runtime validator for SemanticEvidenceManifest.
   */
  static validate(manifest: unknown): { valid: boolean; error?: string } {
    if (!manifest || typeof manifest !== 'object') {
      return { valid: false, error: 'Manifest must be a non-null object' };
    }

    const m = manifest as Partial<SemanticEvidenceManifest>;

    if (m.schemaVersion !== 1) {
      return { valid: false, error: 'schemaVersion must equal 1' };
    }

    if (!m.reportId || typeof m.reportId !== 'string') {
      return { valid: false, error: 'reportId is required' };
    }

    if (!m.imageId || typeof m.imageId !== 'string') {
      return { valid: false, error: 'imageId is required' };
    }

    if (!m.image || typeof m.image !== 'object') {
      return { valid: false, error: 'image block is required' };
    }

    if (!m.image.originalSha256 || !m.image.evidenceSha256 || !m.image.perceptualHash) {
      return { valid: false, error: 'Cryptographic and perceptual hashes are required in image block' };
    }

    if (!m.compression || typeof m.compression.compressionRatio !== 'number') {
      return { valid: false, error: 'Valid compression metadata is required' };
    }

    if (m.visualAnalysis) {
      const v = m.visualAnalysis;
      if (!Array.isArray(v.detectedHazards) || !Array.isArray(v.visibleObjects)) {
        return { valid: false, error: 'visualAnalysis arrays must be valid lists' };
      }
      const validVerdicts = ['consistent', 'partially_consistent', 'inconsistent', 'insufficient_evidence'];
      if (!validVerdicts.includes(v.verificationVerdict)) {
        return { valid: false, error: `Invalid verificationVerdict: ${v.verificationVerdict}` };
      }
    }

    return { valid: true };
  }
}
