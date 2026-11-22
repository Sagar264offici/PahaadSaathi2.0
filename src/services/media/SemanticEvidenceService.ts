/**
 * PAHAADSAATHI — Semantic Evidence Pipeline Service
 * Master coordinator for image compression, duplicate detection,
 * structured visual JSON analysis, and optional vector embeddings.
 */

import {
  SemanticEvidenceManifest,
  DuplicateCheckResult,
  StructuredVisualAnalysis,
  ImageCompressionOptions,
} from '@/types/semanticEvidence';
import { ImageCompressionService, ProcessedDerivativesResult } from './ImageCompression';
import { ImageManifestBuilder } from './ImageManifest';
import { ImageHashService } from './ImageHash';
import { evidenceUploadManager } from './EvidenceUploadManager';
import { MockEmbeddingProvider } from '../embeddings/MockEmbeddingProvider';
import { EmbeddingSimilarityService } from '../embeddings/EmbeddingSimilarity';

export interface ProcessEvidenceRequest {
  reportId: string;
  photoUri: string;
  hazardType: string;
  description: string;
  existingHashes?: Array<{ hazardId: string; sha256: string; pHash: string }>;
  options?: ImageCompressionOptions;
}

export interface ProcessEvidenceResult {
  manifest: SemanticEvidenceManifest;
  derivatives: ProcessedDerivativesResult;
  duplicateCheck: DuplicateCheckResult;
  evidenceUrl: string;
}

export class SemanticEvidenceService {
  private static instance: SemanticEvidenceService;
  private embeddingProvider = new MockEmbeddingProvider();

  private constructor() {}

  static getInstance(): SemanticEvidenceService {
    if (!this.instance) {
      this.instance = new SemanticEvidenceService();
    }
    return this.instance;
  }

  /**
   * Processes a hazard photograph through the complete 5-stage evidence pipeline.
   */
  async processEvidence(request: ProcessEvidenceRequest): Promise<ProcessEvidenceResult> {
    const { reportId, photoUri, hazardType, description, existingHashes, options } = request;
    const imageId = `IMG-${reportId.replace(/[^a-zA-Z0-9]/g, '').slice(-8) || Date.now().toString(36)}`;

    // 1. Multi-tier Image Compression & Fingerprint Generation
    const derivatives = await ImageCompressionService.processImage(photoUri, options);

    // 2. Duplicate Detection (Cryptographic SHA-256 and Perceptual pHash)
    let duplicateCheck: DuplicateCheckResult = {
      exactSha256Match: false,
      perceptualMatch: false,
      hammingDistance: 64,
      isDuplicate: false,
    };

    if (existingHashes && existingHashes.length > 0) {
      for (const ex of existingHashes) {
        const check = ImageHashService.evaluateDuplicate(
          { sha256: derivatives.evidence.sha256, pHash: derivatives.perceptualHash },
          ex
        );
        if (check.isDuplicate) {
          duplicateCheck = check;
          break;
        }
      }
    }

    // 3. Upload Evidence Derivative to Supabase Storage
    const uploadRes = await evidenceUploadManager.uploadEvidence(derivatives, reportId);

    // 4. Build Initial Manifest
    let manifest = ImageManifestBuilder.createInitialManifest({
      reportId,
      imageId,
      derivatives,
      uploadStatus: {
        evidenceStatus: 'uploaded',
        previewStatus: 'uploaded',
      },
    });
    manifest.upload.evidenceUrl = uploadRes.evidenceUrl;
    manifest.upload.previewUrl = uploadRes.previewUrl;

    // 5. Optional Vector Embedding Generation (Feature-Flagged)
    if (EmbeddingSimilarityService.isEmbeddingsEnabled()) {
      try {
        const embedding = await this.embeddingProvider.generateEmbedding(derivatives.evidence.uri);
        manifest = ImageManifestBuilder.attachEmbedding(manifest, embedding);
      } catch (err: any) {
        console.warn('[SemanticEvidenceService] Embedding generation notice (skipped):', err.message);
      }
    }

    return {
      manifest,
      derivatives,
      duplicateCheck,
      evidenceUrl: uploadRes.evidenceUrl,
    };
  }

  /**
   * Attaches confirmed NVIDIA PaliGemma visual observations to the manifest.
   */
  attachVisualAnalysis(
    manifest: SemanticEvidenceManifest,
    analysis: StructuredVisualAnalysis
  ): SemanticEvidenceManifest {
    return ImageManifestBuilder.attachVisualAnalysis(manifest, analysis);
  }
}

export const semanticEvidenceService = SemanticEvidenceService.getInstance();
