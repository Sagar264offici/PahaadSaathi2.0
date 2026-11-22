/**
 * PAHAADSAATHI — MQTT SUBSCRIBER
 * Handles topic subscriptions, message deserialization, duplicate filtering (idempotency),
 * and dispatches typed messages to registered application listeners.
 */

import { MqttConnectionManager, connectionManager } from './MqttConnectionManager';
import { MqttTopics } from './MqttTopics';
import { MqttSerializer } from './MqttSerializer';
import { ackManager } from './MqttAcknowledgement';
import { MqttMessage, MqttQoS, ProducerType, ReportAckPayload } from '@/types/mqtt';

export type MessageHandler<T = unknown> = (message: MqttMessage<T>, topic: string) => void;

interface SubscriptionEntry {
  id: string;
  pattern: string;
  handler: MessageHandler<any>;
  qos: MqttQoS;
}

export class MqttSubscriber {
  private static instance: MqttSubscriber;
  private conn: MqttConnectionManager;
  private subscriptions: Map<string, SubscriptionEntry> = new Map();
  private patternCounts: Map<string, number> = new Map();
  private processedEventIds: Set<string> = new Set();
  private eventIdTimestamps: Map<string, number> = new Map();
  private isListeningToClient = false;

  private constructor() {
    this.conn = connectionManager;
    this.cleanExpiredDeduplicationKeys();
  }

  static getInstance(): MqttSubscriber {
    if (!this.instance) {
      this.instance = new MqttSubscriber();
    }
    return this.instance;
  }

  private cleanExpiredDeduplicationKeys(): void {
    // Purge seen event IDs older than 10 minutes every 5 minutes
    const timer = setInterval(() => {
      const now = Date.now();
      const cutoff = now - 10 * 60 * 1000;
      for (const [id, time] of this.eventIdTimestamps.entries()) {
        if (time < cutoff) {
          this.eventIdTimestamps.delete(id);
          this.processedEventIds.delete(id);
        }
      }
    }, 5 * 60 * 1000);
    if (timer && typeof (timer as any).unref === 'function') {
      (timer as any).unref();
    }
  }

  private ensureClientListener(): void {
    if (this.isListeningToClient) return;

    const rawClient = this.conn.getRawClient();
    if (rawClient) {
      rawClient.on('message', (topic: string, payload: Buffer) => {
        this.handleIncomingRawMessage(topic, payload);
      });
      this.isListeningToClient = true;
    }
  }

  public handleIncomingRawMessage(topic: string, payload: Buffer | string): void {
    let message: MqttMessage<any>;
    try {
      message = MqttSerializer.deserialize(payload);
    } catch (err: any) {
      console.warn(`[MqttSubscriber] Dropped invalid packet on ${topic}:`, err.message);
      return;
    }

    // Deduplication check: drop duplicate at-least-once deliveries
    if (this.processedEventIds.has(message.eventId)) {
      this.conn.incrementDuplicatesDropped();
      return;
    }

    this.processedEventIds.add(message.eventId);
    this.eventIdTimestamps.set(message.eventId, Date.now());
    this.conn.incrementReceived();

    // If this is a report acknowledgement event, dispatch to acknowledgement manager
    if (message.eventType === 'REPORT_ACK') {
      ackManager.processIncomingAck(message.payload as ReportAckPayload);
    }

    // Dispatch to all matching subscriptions
    for (const sub of this.subscriptions.values()) {
      if (MqttTopics.match(sub.pattern, topic)) {
        try {
          sub.handler(message, topic);
        } catch (err) {
          console.error(`[MqttSubscriber] Error in handler for pattern ${sub.pattern}:`, err);
        }
      }
    }
  }

  /**
   * Subscribes to an authorized topic pattern.
   */
  public async subscribe<T = unknown>(
    pattern: string,
    handler: MessageHandler<T>,
    options: { qos?: MqttQoS; role?: ProducerType; authorizedRegions?: string[] } = {}
  ): Promise<string> {
    const role = options.role || 'mobile';
    const qos = options.qos ?? 1;

    // 1. ACL validation
    const acl = MqttTopics.canSubscribe(
      pattern,
      role,
      this.conn.getUserId(),
      options.authorizedRegions || []
    );

    if (!acl.allowed) {
      throw new Error(`MQTT Subscription Forbidden: ${acl.reason || 'Unauthorized pattern'}`);
    }

    const subId = `sub_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    this.subscriptions.set(subId, {
      id: subId,
      pattern,
      handler,
      qos,
    });

    const currentCount = this.patternCounts.get(pattern) || 0;
    this.patternCounts.set(pattern, currentCount + 1);

    // Register with connection manager for automatic reconnect restoration
    this.conn.registerSubscription(pattern, qos);

    // Subscribe on live client if connected
    const client = this.conn.getRawClient();
    this.ensureClientListener();

    if (client && client.connected && currentCount === 0) {
      await new Promise<void>((resolve, reject) => {
        client.subscribe(pattern, { qos }, (err) => {
          if (err) {
            reject(new Error(`MQTT Subscription Error for ${pattern}: ${err.message}`));
          } else {
            resolve();
          }
        });
      });
    }

    return subId;
  }

  /**
   * Unsubscribes a listener by subscription ID.
   */
  public unsubscribe(subId: string): void {
    const sub = this.subscriptions.get(subId);
    if (!sub) return;

    this.subscriptions.delete(subId);

    const count = (this.patternCounts.get(sub.pattern) || 1) - 1;
    if (count <= 0) {
      this.patternCounts.delete(sub.pattern);
      this.conn.unregisterSubscription(sub.pattern);

      const client = this.conn.getRawClient();
      if (client && client.connected) {
        client.unsubscribe(sub.pattern);
      }
    } else {
      this.patternCounts.set(sub.pattern, count);
    }
  }

  public clear(): void {
    this.subscriptions.clear();
    this.patternCounts.clear();
    this.processedEventIds.clear();
    this.eventIdTimestamps.clear();
  }
}

export const subscriber = MqttSubscriber.getInstance();
