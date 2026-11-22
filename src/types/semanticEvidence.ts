/**
 * PAHAADSAATHI — SEMANTIC EVIDENCE & IMAGE OPTIMIZATION ENGINE
 * Standardized types, schemas, and evidence contracts.
 */

export type CompressionProfile = 'strong' | 'moderate' | 'weak';

export type ImageQualityRating = 'good' | 'acceptable' | 'poor' | 'unusable';

export type VerificationVerdict =
  | 'consistent'
  | 'partially_consistent'
  | 'inconsistent'
  | 'insufficient_evidence';

export interface ImageDimensions {
  width: number;
  height: number;
}

export interface ImageDerivative {
  uri: string;
  format: 'image/jpeg' | 'image/webp' | 'image/png';
  width: number;
  height: number;
  sizeBytes: number;
  sha256: string;
  base64?: string;
}

export interface ImageCompressionOptions {
  profile?: CompressionProfile;
  maxLongSide?: number;
  quality?: number;
  format?: 'jpeg' | 'webp';
}

export interface PerceptualHashResult {
  pHash: string; // 64-bit hexadecimal string (16 hex chars)
  algorithm: 'phash_dct_8x8' | 'block_mean_8x8';
}

export interface DuplicateCheckResult {
  exactSha256Match: boolean;
  perceptualMatch: boolean;
  hammingDistance: number;
  matchedHazardId?: string;
  isDuplicate: boolean;
}

export interface StructuredVisualAnalysis {
  detectedHazards: string[];
  visibleObjects: string[];
  visibleEvidence: string[];
  contradictions: string[];
  imageQuality: ImageQualityRating;
  verificationVerdict: VerificationVerdict;
  needsHumanReview: boolean;
  confidenceScore?: number;
  analyzedAt?: string;
  rawCaption?: string;
}

export interface ImageEmbeddingResult {
  provider: string;
  model: string;
  modelVersion: string;
  dimensions: number;
  values: number[]; // Normalized unit vector
  normalized: boolean;
}

export interface QuantizedEmbedding {
  scale: number;
  zeroPoint: number;
  dimensions: number;
  quantizedValues: number[]; // Int8: -128 to 127
}

export interface SemanticSimilarityResult {
  hazardId: string;
  similarity: number; // Cosine similarity: 0.0 to 1.0
  description?: string;
}

export interface SemanticEvidenceManifest {
  schemaVersion: 1;
  reportId: string;
  imageId: string;

  image: {
    mimeType: string;
    originalSizeBytes: number;
    evidenceSizeBytes: number;
    previewSizeBytes: number;

    originalWidth: number;
    originalHeight: number;

    evidenceWidth: number;
    evidenceHeight: number;

    originalSha256: string;
    evidenceSha256: string;
    previewSha256: string;
    perceptualHash: string;
    placeholderHash?: string;
  };

  compression: {
    format: 'image/jpeg' | 'image/webp' | 'image/png';
    quality: number;
    method: string;
    compressionRatio: number;
    profile: CompressionProfile;
  };

  visualAnalysis?: StructuredVisualAnalysis;

  embedding?: {
    provider: string;
    model: string;
    modelVersion: string;
    dimensions: number;
    normalized: boolean;
    storageReference?: string;
  };

  upload: {
    originalStatus: 'local_only' | 'pending' | 'uploaded' | 'deferred';
    evidenceStatus: 'pending' | 'uploading' | 'uploaded' | 'failed';
    previewStatus: 'pending' | 'uploaded' | 'failed' | 'not_required';
    evidenceUrl?: string;
    previewUrl?: string;
    uploadedAt?: string;
  };
}
