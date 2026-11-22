/**
 * PAHAADSAATHI — MQTT CLIENT FACADE
 * Unified interface for mobile MQTT communication, event publishing,
 * topic subscriptions, and application-level delivery confirmations.
 */

import { connectionManager, MqttConnectionManager } from './MqttConnectionManager';
import { publisher, MqttPublisher } from './MqttPublisher';
import { subscriber, MqttSubscriber, MessageHandler } from './MqttSubscriber';
import { ackManager, MqttAcknowledgementManager, AckRecord } from './MqttAcknowledgement';
import { MqttTopics } from './MqttTopics';
import { MqttSerializer } from './MqttSerializer';
import { getMqttConfig } from './MqttConfig';
import {
  MqttMessage,
  MqttConnectionState,
  MqttConnectionMetrics,
  HazardReportPayload,
  HazardUpdatePayload,
  EmergencySosPayload,
  AiVerificationStatusPayload,
  ReportAckPayload,
} from '@/types/mqtt';

export class MqttClient {
  private static instance: MqttClient;
  private conn: MqttConnectionManager = connectionManager;
  private pub: MqttPublisher = publisher;
  private sub: MqttSubscriber = subscriber;
  private ack: MqttAcknowledgementManager = ackManager;

  private constructor() {}

  static getInstance(): MqttClient {
    if (!this.instance) {
      this.instance = new MqttClient();
    }
    return this.instance;
  }

  /**
   * Initializes connection and sets user credentials/context.
   */
  public async init(userId?: string): Promise<void> {
    if (userId) {
      this.conn.setUserContext(userId);
    }
    await this.conn.connect();

    // Automatically subscribe to user's private ACK topic
    const env = getMqttConfig().environment;
    const effectiveUserId = this.conn.getUserId();
    if (effectiveUserId) {
      const ackTopic = MqttTopics.userAck(env, effectiveUserId);
      try {
        await this.sub.subscribe<ReportAckPayload>(ackTopic, (msg) => {
          this.ack.processIncomingAck(msg.payload);
        });
      } catch (err: any) {
        console.warn('[MqttClient] Could not auto-subscribe to ACK topic:', err.message);
      }
    }
  }

  public disconnect(): void {
    this.conn.disconnect();
  }

  public getConnectionState(): MqttConnectionState {
    return this.conn.getConnectionState();
  }

  public isConnected(): boolean {
    return this.conn.isConnected();
  }

  public getMetrics(): MqttConnectionMetrics {
    return this.conn.getMetrics();
  }

  public onStateChange(listener: (state: MqttConnectionState, metrics: MqttConnectionMetrics) => void): () => void {
    return this.conn.onStateChange(listener);
  }

  /**
   * Generic publish helper.
   */
  public async publish<T>(topic: string, message: MqttMessage<T>): Promise<{ eventId: string; latencyMs: number }> {
    return this.pub.publish(topic, message);
  }

  /**
   * Generic subscribe helper.
   */
  public async subscribe<T>(pattern: string, handler: MessageHandler<T>): Promise<string> {
    return this.sub.subscribe<T>(pattern, handler);
  }

  public unsubscribe(subId: string): void {
    this.sub.unsubscribe(subId);
  }

  /**
   * High-Level: Publish Hazard Report Event (Ingress)
   * Enforces 5-stage delivery:
   * 1. Caller enqueues locally (Stage 1).
   * 2. This method publishes over MQTT and records Stage 2 (BROKER_RECEIVED).
   * 3. Awaits Stage 4 (DATABASE_PERSISTED) from backend ack topic.
   */
  public async publishHazardReport(
    payload: HazardReportPayload,
    options?: { correlationId?: string; waitForDbAck?: boolean; timeoutMs?: number }
  ): Promise<{ eventId: string; record: AckRecord }> {
    const env = getMqttConfig().environment;
    const userId = this.conn.getUserId();
    const deviceId = this.conn.getDeviceId();
    const eventId = MqttSerializer.generateId();
    const correlationId = options?.correlationId || MqttSerializer.generateId();

    const topic = MqttTopics.reportIngress(env, userId);

    const message: MqttMessage<HazardReportPayload> = {
      schemaVersion: 1,
      eventId,
      correlationId,
      eventType: 'HAZARD_REPORTED',
      createdAt: new Date().toISOString(),
      producer: {
        type: 'mobile',
        deviceId,
        userId,
      },
      payload,
    };

    // Stage 1: Register in Acknowledgement Manager
    const record = this.ack.registerLocallyQueued(eventId, correlationId);

    // Stage 2: Publish over MQTT with QoS 1 -> Brokered PUBACK
    await this.pub.publish(topic, message, { qos: 1 });

    if (options?.waitForDbAck) {
      const confirmed = await this.ack.waitForConfirmation(eventId, options.timeoutMs ?? 15000);
      return { eventId, record: confirmed };
    }

    return { eventId, record };
  }

  /**
   * High-Level: Publish Emergency SOS (P0 priority)
   */
  public async publishEmergencySos(
    payload: EmergencySosPayload
  ): Promise<{ eventId: string; latencyMs: number }> {
    const env = getMqttConfig().environment;
    const eventId = MqttSerializer.generateId();
    const topic = MqttTopics.emergencyEvents(env);

    const message: MqttMessage<EmergencySosPayload> = {
      schemaVersion: 1,
      eventId,
      correlationId: payload.sosId,
      eventType: 'EMERGENCY_SOS',
      createdAt: new Date().toISOString(),
      producer: {
        type: 'mobile',
        deviceId: this.conn.getDeviceId(),
        userId: this.conn.getUserId(),
      },
      payload,
    };

    return this.pub.publish(topic, message, { qos: 1 });
  }

  /**
   * High-Level: Publish Hazard Update (Moderator action)
   */
  public async publishHazardUpdate(
    hazardId: string,
    payload: HazardUpdatePayload
  ): Promise<{ eventId: string; latencyMs: number }> {
    const env = getMqttConfig().environment;
    const eventId = MqttSerializer.generateId();
    const topic = MqttTopics.hazardUpdates(env, hazardId);

    const message: MqttMessage<HazardUpdatePayload> = {
      schemaVersion: 1,
      eventId,
      correlationId: hazardId,
      eventType: 'HAZARD_UPDATED',
      createdAt: new Date().toISOString(),
      producer: {
        type: 'moderator',
        deviceId: this.conn.getDeviceId(),
        userId: this.conn.getUserId(),
      },
      payload,
    };

    return this.pub.publish(topic, message, { qos: 1 });
  }

  /**
   * High-Level: Publish AI Image Verification Event
   */
  public async publishAiVerificationStatus(
    hazardId: string,
    payload: AiVerificationStatusPayload
  ): Promise<{ eventId: string; latencyMs: number }> {
    const env = getMqttConfig().environment;
    const eventId = MqttSerializer.generateId();
    const topic = MqttTopics.hazardUpdates(env, hazardId);

    const message: MqttMessage<AiVerificationStatusPayload> = {
      schemaVersion: 1,
      eventId,
      correlationId: hazardId,
      eventType: 'AI_VERIFICATION_STATUS',
      createdAt: new Date().toISOString(),
      producer: {
        type: 'backend',
        deviceId: this.conn.getDeviceId(),
      },
      payload,
    };

    return this.pub.publish(topic, message, { qos: 1 });
  }

  /**
   * Subscribes to live public hazard events feed.
   */
  public async subscribeToHazardEvents(
    handler: MessageHandler<HazardReportPayload>
  ): Promise<string> {
    const env = getMqttConfig().environment;
    const topic = MqttTopics.hazardEvents(env);
    return this.sub.subscribe<HazardReportPayload>(topic, handler, { qos: 1 });
  }

  /**
   * Subscribes to live updates for all hazards.
   */
  public async subscribeToAllHazardUpdates(
    handler: MessageHandler<HazardUpdatePayload>
  ): Promise<string> {
    const env = getMqttConfig().environment;
    const topic = MqttTopics.allHazardUpdates(env);
    return this.sub.subscribe<HazardUpdatePayload>(topic, handler, { qos: 1 });
  }

  /**
   * Subscribes to regional emergency alerts.
   */
  public async subscribeToRegionalAlerts(
    regionId: string,
    handler: MessageHandler<any>
  ): Promise<string> {
    const env = getMqttConfig().environment;
    const topic = MqttTopics.regionalAlerts(env, regionId);
    return this.sub.subscribe(topic, handler, { qos: 1 });
  }
}

export const mqttClient = MqttClient.getInstance();
