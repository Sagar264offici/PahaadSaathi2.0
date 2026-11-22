/**
 * PAHAADSAATHI — SEMANTIC EVIDENCE PIPELINE TEST SUITE
 * Comprehensive unit and integration tests for:
 * 1. Multi-tier Image Compression (Evidence 1280px, Preview 320px)
 * 2. Cryptographic SHA-256 & Perceptual Hashing (dHash / Hamming Distance)
 * 3. Semantic Evidence Manifest Schema Validation
 * 4. Vector Embedding Generation, Normalization & Cosine Similarity
 * 5. Int8 Vector Quantization and Dequantization Precision
 * 6. Duplicate Incident Detection & Similarity Retrieval
 * 7. Low-Bandwidth Network Profiles (Strong / Moderate / Weak)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { ImageCompressionService } from '../ImageCompression';
import { ImageHashService } from '../ImageHash';
import { ImagePlaceholderService } from '../ImagePlaceholder';
import { ImageManifestBuilder } from '../ImageManifest';
import { MockEmbeddingProvider } from '../../embeddings/MockEmbeddingProvider';
import { EmbeddingSimilarityService } from '../../embeddings/EmbeddingSimilarity';
import { SemanticEvidenceManifest } from '@/types/semanticEvidence';

describe('PSEP — Multi-Tier Image Compression & Derivative Strategy', () => {
  it('should resolve correct parameters for adaptive network profiles', () => {
    const strong = ImageCompressionService.getProfileParams('strong');
    assert.strictEqual(strong.evidenceMaxDimension, 1600);
    assert.strictEqual(strong.evidenceQuality, 0.82);

    const moderate = ImageCompressionService.getProfileParams('moderate');
    assert.strictEqual(moderate.evidenceMaxDimension, 1280);
    assert.strictEqual(moderate.evidenceQuality, 0.80);
    assert.strictEqual(moderate.previewMaxDimension, 320);

    const weak = ImageCompressionService.getProfileParams('weak');
    assert.strictEqual(weak.evidenceMaxDimension, 1024);
    assert.strictEqual(weak.evidenceQuality, 0.75);
  });

  it('should process simulated image and generate evidence and preview derivatives', async () => {
    const mockUri = 'data:image/jpeg;base64,' + 'A'.repeat(5000);
    const result = await ImageCompressionService.processImage(mockUri, { profile: 'moderate' });

    assert.ok(result.original.sizeBytes > 0);
    assert.ok(result.evidence.sizeBytes > 0);
    assert.ok(result.preview.sizeBytes > 0);
    assert.ok(result.evidence.width <= 1280);
    assert.ok(result.preview.width <= 320);
    assert.ok(result.compressionRatio >= 1.0);
    assert.strictEqual(result.evidence.format, 'image/jpeg');
    assert.strictEqual(result.preview.format, 'image/jpeg');
    assert.strictEqual(typeof result.perceptualHash, 'string');
    assert.strictEqual(result.perceptualHash.length, 16);
  });
});

describe('PSEP — Cryptographic & Perceptual Fingerprinting', () => {
  it('should compute deterministic SHA-256 cryptographic hashes', () => {
    const dataA = 'mountain_landslide_scene_sample_a';
    const dataB = 'mountain_landslide_scene_sample_b';

    const hashA1 = ImageHashService.computeSha256(dataA);
    const hashA2 = ImageHashService.computeSha256(dataA);
    const hashB = ImageHashService.computeSha256(dataB);

    assert.strictEqual(hashA1, hashA2, 'Identical data must produce identical SHA-256');
    assert.notStrictEqual(hashA1, hashB, 'Different data must produce different SHA-256');
    assert.strictEqual(hashA1.length, 64);
  });

  it('should compute 16-character hexadecimal perceptual hash and Hamming distance', () => {
    const pixelsA = new Uint8Array(64).fill(100);
    const pixelsB = new Uint8Array(64).fill(100);
    const pixelsC = new Uint8Array(64);
    for (let i = 0; i < 64; i++) pixelsC[i] = i * 4;

    const hashA = ImageHashService.computePerceptualHash(pixelsA, 320, 240);
    const hashB = ImageHashService.computePerceptualHash(pixelsB, 320, 240);
    const hashC = ImageHashService.computePerceptualHash(pixelsC, 320, 240);

    assert.strictEqual(hashA.pHash.length, 16);
    assert.strictEqual(hashA.pHash, hashB.pHash);

    const distIdentical = ImageHashService.calculateHammingDistance(hashA.pHash, hashB.pHash);
    assert.strictEqual(distIdentical, 0, 'Identical perceptual hashes must have 0 Hamming distance');

    const distDifferent = ImageHashService.calculateHammingDistance(hashA.pHash, hashC.pHash);
    assert.ok(distDifferent >= 0 && distDifferent <= 64);
  });

  it('should detect exact duplicates and perceptual near-duplicates', () => {
    const candidate = { sha256: 'sha_test_1', pHash: 'abcdef0123456789' };
    const exactMatch = { sha256: 'sha_test_1', pHash: 'abcdef0123456789', hazardId: 'HZ-1' };
    const nearMatch = { sha256: 'sha_test_2', pHash: 'abcdef0123456788', hazardId: 'HZ-2' }; // 1 bit diff
    const distinct = { sha256: 'sha_test_3', pHash: 'ffffffffffffffff', hazardId: 'HZ-3' };

    const checkExact = ImageHashService.evaluateDuplicate(candidate, exactMatch);
    assert.strictEqual(checkExact.exactSha256Match, true);
    assert.strictEqual(checkExact.isDuplicate, true);

    const checkNear = ImageHashService.evaluateDuplicate(candidate, nearMatch);
    assert.strictEqual(checkNear.exactSha256Match, false);
    assert.strictEqual(checkNear.perceptualMatch, true);
    assert.strictEqual(checkNear.isDuplicate, true);
    assert.strictEqual(checkNear.hammingDistance, 1);

    const checkDistinct = ImageHashService.evaluateDuplicate(candidate, distinct);
    assert.strictEqual(checkDistinct.isDuplicate, false);
    assert.ok(checkDistinct.hammingDistance > 8);
  });
});

describe('PSEP — Semantic Evidence Manifest Schema & Validation', () => {
  it('should construct and validate a compliant SemanticEvidenceManifest', async () => {
    const mockUri = 'data:image/jpeg;base64,' + 'B'.repeat(4000);
    const derivatives = await ImageCompressionService.processImage(mockUri, { profile: 'moderate' });

    const manifest = ImageManifestBuilder.createInitialManifest({
      reportId: 'rep-test-101',
      imageId: 'IMG-101',
      derivatives,
    });

    const validation = ImageManifestBuilder.validate(manifest);
    assert.strictEqual(validation.valid, true);
    assert.strictEqual(manifest.schemaVersion, 1);
    assert.strictEqual(manifest.reportId, 'rep-test-101');
    assert.strictEqual(manifest.image.perceptualHash.length, 16);
  });

  it('should attach structured visual analysis observations to manifest', async () => {
    const mockUri = 'data:image/jpeg;base64,' + 'C'.repeat(4000);
    const derivatives = await ImageCompressionService.processImage(mockUri);

    let manifest = ImageManifestBuilder.createInitialManifest({
      reportId: 'rep-test-102',
      imageId: 'IMG-102',
      derivatives,
    });

    manifest = ImageManifestBuilder.attachVisualAnalysis(manifest, {
      detectedHazards: ['Landslide', 'Rockfall'],
      visibleObjects: ['rocks', 'asphalt', 'boulder', 'guardrail'],
      visibleEvidence: ['large rocks blocking both lanes'],
      contradictions: [],
      imageQuality: 'good',
      verificationVerdict: 'consistent',
      needsHumanReview: false,
      confidenceScore: 0.94,
    });

    assert.ok(manifest.visualAnalysis);
    assert.strictEqual(manifest.visualAnalysis.verificationVerdict, 'consistent');
    assert.deepStrictEqual(manifest.visualAnalysis.detectedHazards, ['Landslide', 'Rockfall']);

    const validation = ImageManifestBuilder.validate(manifest);
    assert.strictEqual(validation.valid, true);
  });

  it('SECURITY: should reject invalid or malformed manifests', () => {
    const invalidManifest = {
      schemaVersion: 2, // Must be 1
      reportId: '',
    };
    const validation = ImageManifestBuilder.validate(invalidManifest);
    assert.strictEqual(validation.valid, false);
    assert.ok(validation.error?.includes('schemaVersion'));
  });
});

describe('PSEP — Vector Embedding Engine & Int8 Quantization', () => {
  const provider = new MockEmbeddingProvider();

  it('should generate normalized 512-dimensional vector embedding', async () => {
    const res = await provider.generateEmbedding('test_image_input_mountain');
    assert.strictEqual(res.dimensions, 512);
    assert.strictEqual(res.values.length, 512);
    assert.strictEqual(res.normalized, true);

    // Verify L2 unit norm (sum of squares ≈ 1.0)
    let sumSquares = 0;
    for (const v of res.values) sumSquares += v * v;
    assert.ok(Math.abs(sumSquares - 1.0) < 0.01, `Expected norm ~1.0, actual: ${sumSquares}`);
  });

  it('should compute exact cosine similarity between identical and orthogonal vectors', () => {
    const vecA = EmbeddingSimilarityService.normalize([1, 2, 3, 4]);
    const vecB = EmbeddingSimilarityService.normalize([1, 2, 3, 4]);
    const vecC = EmbeddingSimilarityService.normalize([-1, -2, -3, -4]);

    const simIdentical = EmbeddingSimilarityService.cosineSimilarity(vecA, vecB);
    assert.strictEqual(simIdentical, 1.0, 'Identical normalized vectors must have similarity 1.0');

    const simOpposite = EmbeddingSimilarityService.cosineSimilarity(vecA, vecC);
    assert.strictEqual(simOpposite, -1.0, 'Opposite vectors must have similarity -1.0');
  });

  it('should reject vectors with mismatched dimensions or invalid NaN/Infinity values', () => {
    assert.throws(() => {
      EmbeddingSimilarityService.cosineSimilarity([1, 2, 3], [1, 2]);
    }, /dimension mismatch/);

    assert.throws(() => {
      EmbeddingSimilarityService.cosineSimilarity([1, NaN, 3], [1, 2, 3]);
    }, /invalid NaN or infinite/);
  });

  it('should quantize float vectors to Int8 and dequantize with low reconstruction error', async () => {
    const embedding = await provider.generateEmbedding('test_quantization');
    const quantized = EmbeddingSimilarityService.quantizeToInt8(embedding.values);

    assert.strictEqual(quantized.dimensions, 512);
    assert.strictEqual(quantized.quantizedValues.length, 512);

    // Verify int8 bounds
    for (const q of quantized.quantizedValues) {
      assert.ok(q >= -128 && q <= 127, `Int8 value out of bounds: ${q}`);
    }

    // Dequantize and check fidelity
    const reconstructed = EmbeddingSimilarityService.dequantizeFromInt8(quantized);
    const fidelity = EmbeddingSimilarityService.cosineSimilarity(embedding.values, reconstructed);
    assert.ok(fidelity > 0.99, `Quantization reconstruction cosine similarity must exceed 0.99, actual: ${fidelity}`);
  });

  it('should find top-K visually similar reports using cosine similarity', async () => {
    const query = await provider.generateEmbedding('query_scene');
    const similar = await provider.generateEmbedding('query_scene'); // Identical
    const distinct = await provider.generateEmbedding('completely_different_valley');

    const candidates = [
      { hazardId: 'HZ-SIM-1', vector: similar.values, description: 'Landslide near bridge' },
      { hazardId: 'HZ-DIST-2', vector: distinct.values, description: 'Clear highway' },
    ];

    const results = EmbeddingSimilarityService.findTopSimilar(query.values, candidates, 1, 0.90);
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].hazardId, 'HZ-SIM-1');
    assert.ok(results[0].similarity > 0.95);
  });
});
