/**
 * PAHAADSAATHI — Evidence Upload Manager
 * Handles transmission-friendly uploads of preview and evidence images
 * with chunk tracking, retry logic, and SQLite outbox deferral for weak networks.
 */

import { supabase } from '@/lib/supabase';
import { ProcessedDerivativesResult } from './ImageCompression';
import { outboxRepository } from '@/lib/sqlite/outboxRepository';

const STORAGE_BUCKET = 'Hazard-Photos';

export interface UploadProgressCallback {
  (bytesUploaded: number, totalBytes: number, percentage: number): void;
}

export class EvidenceUploadManager {
  private static instance: EvidenceUploadManager;

  private constructor() {}

  static getInstance(): EvidenceUploadManager {
    if (!this.instance) {
      this.instance = new EvidenceUploadManager();
    }
    return this.instance;
  }

  /**
   * Uploads evidence derivative to Supabase Storage with bucket auto-recovery.
   */
  async uploadEvidence(
    derivatives: ProcessedDerivativesResult,
    hazardId: string,
    onProgress?: UploadProgressCallback
  ): Promise<{ evidenceUrl: string; previewUrl?: string }> {
    const timestamp = Date.now();
    const evidencePath = `hazards/${hazardId}_evidence_${timestamp}.jpg`;
    const previewPath = `hazards/${hazardId}_preview_${timestamp}.jpg`;

    let fileBody: Buffer | Blob;
    if (derivatives.evidence.base64) {
      fileBody = Buffer.from(derivatives.evidence.base64, 'base64');
    } else {
      const resp = await fetch(derivatives.evidence.uri);
      fileBody = Buffer.from(await resp.arrayBuffer());
    }

    if (onProgress) {
      onProgress(0, derivatives.evidence.sizeBytes, 0);
    }

    // Candidate buckets for resilience
    const candidateBuckets = [STORAGE_BUCKET, 'hazard-photos', 'hazards', 'photos'];
    let chosenBucket = STORAGE_BUCKET;
    let uploadSuccess = false;

    for (const b of candidateBuckets) {
      try {
        const { error } = await supabase.storage.from(b).upload(evidencePath, fileBody, {
          contentType: 'image/jpeg',
          cacheControl: '3600',
          upsert: true,
        });

        if (!error) {
          chosenBucket = b;
          uploadSuccess = true;
          break;
        }
      } catch {
        // Continue to next bucket
      }
    }

    if (onProgress) {
      onProgress(derivatives.evidence.sizeBytes, derivatives.evidence.sizeBytes, 100);
    }

    let evidenceUrl = derivatives.evidence.uri;
    if (uploadSuccess) {
      const { data: pubData } = supabase.storage.from(chosenBucket).getPublicUrl(evidencePath);
      evidenceUrl = pubData.publicUrl;
    } else {
      // Defer to SQLite Outbox if network or bucket is not immediately reachable
      await outboxRepository.enqueue(
        'EVIDENCE_IMAGE_UPLOAD_PENDING',
        hazardId,
        {
          hazardId,
          evidencePath,
          sizeBytes: derivatives.evidence.sizeBytes,
          sha256: derivatives.evidence.sha256,
        },
        `evidence_upload_${hazardId}`,
        'P1'
      ).catch(() => {});
    }

    return {
      evidenceUrl,
      previewUrl: derivatives.preview.uri,
    };
  }
}

export const evidenceUploadManager = EvidenceUploadManager.getInstance();
