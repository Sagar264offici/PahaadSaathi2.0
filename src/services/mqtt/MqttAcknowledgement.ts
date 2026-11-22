/**
 * PAHAADSAATHI — MQTT 5-STAGE APPLICATION ACKNOWLEDGEMENT ENGINE
 * Coordinates acknowledgement lifecycle:
 * LOCALLY_QUEUED -> BROKER_RECEIVED -> BACKEND_RECEIVED -> DATABASE_PERSISTED -> CLIENT_CONFIRMED
 */

import { MqttAckStage, ReportAckPayload } from '@/types/mqtt';

export interface AckRecord {
  eventId: string;
  correlationId: string;
  hazardId?: string;
  currentStage: MqttAckStage;
  publishedAt: number;
  brokerAckAt?: number;
  backendReceivedAt?: number;
  dbPersistedAt?: number;
  clientConfirmedAt?: number;
  brokerLatencyMs?: number;
  dbPersistLatencyMs?: number;
  error?: string;
}

export type AckStageListener = (record: AckRecord) => void;

export class MqttAcknowledgementManager {
  private static instance: MqttAcknowledgementManager;
  private pendingAcks: Map<string, AckRecord> = new Map();
  private correlationToEvent: Map<string, string> = new Map();
  private listeners: Map<string, Set<AckStageListener>> = new Map();
  private globalListeners: Set<AckStageListener> = new Set();

  private constructor() {}

  static getInstance(): MqttAcknowledgementManager {
    if (!this.instance) {
      this.instance = new MqttAcknowledgementManager();
    }
    return this.instance;
  }

  /**
   * Stage 1: Report is persisted in local SQLite outbox.
   */
  public registerLocallyQueued(eventId: string, correlationId: string): AckRecord {
    const record: AckRecord = {
      eventId,
      correlationId,
      currentStage: 'LOCALLY_QUEUED',
      publishedAt: Date.now(),
    };
    this.pendingAcks.set(eventId, record);
    this.correlationToEvent.set(correlationId, eventId);
    this.notify(record);
    return record;
  }

  /**
   * Stage 2: Broker PUBACK received.
   */
  public markBrokerReceived(eventId: string): AckRecord | undefined {
    const record = this.pendingAcks.get(eventId);
    if (!record) return undefined;

    const now = Date.now();
    record.currentStage = 'BROKER_RECEIVED';
    record.brokerAckAt = now;
    record.brokerLatencyMs = now - record.publishedAt;
    this.notify(record);
    return record;
  }

  /**
   * Stage 3: Backend received event from ingress topic.
   */
  public markBackendReceived(eventId: string): AckRecord | undefined {
    const record = this.pendingAcks.get(eventId);
    if (!record) return undefined;

    record.currentStage = 'BACKEND_RECEIVED';
    record.backendReceivedAt = Date.now();
    this.notify(record);
    return record;
  }

  /**
   * Stage 4: Backend confirmed record committed to Supabase PostgreSQL.
   */
  public markDatabasePersisted(eventId: string, dbTimestamp?: string): AckRecord | undefined {
    const record = this.pendingAcks.get(eventId);
    if (!record) return undefined;

    const now = Date.now();
    record.currentStage = 'DATABASE_PERSISTED';
    record.dbPersistedAt = dbTimestamp ? new Date(dbTimestamp).getTime() : now;
    record.dbPersistLatencyMs = now - record.publishedAt;
    this.notify(record);
    return record;
  }

  /**
   * Stage 5: Originating client confirmed receipt of durable server ACK.
   */
  public markClientConfirmed(eventId: string): AckRecord | undefined {
    const record = this.pendingAcks.get(eventId);
    if (!record) return undefined;

    record.currentStage = 'CLIENT_CONFIRMED';
    record.clientConfirmedAt = Date.now();
    this.notify(record);

    // Keep completed ack records for 5 minutes before clearing from memory
    const timer = setTimeout(() => {
      this.pendingAcks.delete(eventId);
      this.correlationToEvent.delete(record.correlationId);
      this.listeners.delete(eventId);
    }, 5 * 60 * 1000);
    if (timer && typeof (timer as any).unref === 'function') {
      (timer as any).unref();
    }

    return record;
  }

  /**
   * Processes incoming server ACK message (from ps/v1/{env}/users/{userId}/ack).
   */
  public processIncomingAck(ackPayload: ReportAckPayload): AckRecord | undefined {
    const eventId = ackPayload.eventId || this.correlationToEvent.get(ackPayload.correlationId);
    if (!eventId) return undefined;

    const record = this.pendingAcks.get(eventId);
    if (!record) return undefined;

    if (ackPayload.hazardId) {
      record.hazardId = ackPayload.hazardId;
    }

    if (ackPayload.stage === 'BACKEND_RECEIVED') {
      this.markBackendReceived(eventId);
    } else if (ackPayload.stage === 'DATABASE_PERSISTED') {
      this.markDatabasePersisted(eventId, ackPayload.persistedAt);
      this.markClientConfirmed(eventId);
    }

    return record;
  }

  /**
   * Retrieves current ack record for an event.
   */
  public getRecord(eventId: string): AckRecord | undefined {
    return this.pendingAcks.get(eventId);
  }

  /**
   * Awaits completion of Stage 4 (DATABASE_PERSISTED) or Stage 5 (CLIENT_CONFIRMED).
   */
  public async waitForConfirmation(eventId: string, timeoutMs = 15000): Promise<AckRecord> {
    const existing = this.pendingAcks.get(eventId);
    if (existing && (existing.currentStage === 'DATABASE_PERSISTED' || existing.currentStage === 'CLIENT_CONFIRMED')) {
      return existing;
    }

    return new Promise((resolve, reject) => {
      let timer: NodeJS.Timeout;

      const listener: AckStageListener = (record) => {
        if (record.currentStage === 'DATABASE_PERSISTED' || record.currentStage === 'CLIENT_CONFIRMED') {
          clearTimeout(timer);
          this.removeListener(eventId, listener);
          resolve(record);
        }
      };

      timer = setTimeout(() => {
        this.removeListener(eventId, listener);
        const latest = this.pendingAcks.get(eventId);
        if (latest && (latest.currentStage === 'DATABASE_PERSISTED' || latest.currentStage === 'CLIENT_CONFIRMED')) {
          resolve(latest);
        } else {
          reject(new Error(`Timeout waiting for database persistence acknowledgement for event ${eventId}`));
        }
      }, timeoutMs);

      this.addListener(eventId, listener);
    });
  }

  public addListener(eventId: string, listener: AckStageListener): void {
    if (!this.listeners.has(eventId)) {
      this.listeners.set(eventId, new Set());
    }
    this.listeners.get(eventId)!.add(listener);
  }

  public removeListener(eventId: string, listener: AckStageListener): void {
    this.listeners.get(eventId)?.delete(listener);
  }

  public onAnyAck(listener: AckStageListener): () => void {
    this.globalListeners.add(listener);
    return () => {
      this.globalListeners.delete(listener);
    };
  }

  private notify(record: AckRecord): void {
    const eventListeners = this.listeners.get(record.eventId);
    if (eventListeners) {
      for (const listener of eventListeners) {
        try {
          listener(record);
        } catch (err) {
          console.warn('[MqttAcknowledgementManager] Listener error:', err);
        }
      }
    }

    for (const listener of this.globalListeners) {
      try {
        listener(record);
      } catch (err) {
        console.warn('[MqttAcknowledgementManager] Global listener error:', err);
      }
    }
  }

  public clear(): void {
    this.pendingAcks.clear();
    this.correlationToEvent.clear();
    this.listeners.clear();
    this.globalListeners.clear();
  }
}

export const ackManager = MqttAcknowledgementManager.getInstance();
