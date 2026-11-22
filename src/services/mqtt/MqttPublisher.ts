/**
 * PAHAADSAATHI — MQTT PUBLISHER
 * QoS 1 publication engine with ACL enforcement, serialization validation,
 * and Stage 2 (BROKER_RECEIVED) acknowledgement tracking.
 */

import { MqttConnectionManager, connectionManager } from './MqttConnectionManager';
import { MqttTopics } from './MqttTopics';
import { MqttSerializer } from './MqttSerializer';
import { ackManager } from './MqttAcknowledgement';
import { MqttMessage, MqttQoS } from '@/types/mqtt';

export interface PublishOptions {
  qos?: MqttQoS;
  retain?: boolean;
}

export class MqttPublisher {
  private static instance: MqttPublisher;
  private conn: MqttConnectionManager;

  private constructor() {
    this.conn = connectionManager;
  }

  static getInstance(): MqttPublisher {
    if (!this.instance) {
      this.instance = new MqttPublisher();
    }
    return this.instance;
  }

  /**
   * Publishes a validated typed message to an authorized topic with QoS 1.
   * Resolves when the MQTT broker returns PUBACK (Stage 2: BROKER_RECEIVED).
   */
  public async publish<T>(
    topic: string,
    message: MqttMessage<T>,
    options: PublishOptions = { qos: 1, retain: false }
  ): Promise<{ eventId: string; latencyMs: number }> {
    // 1. Topic ACL enforcement
    const acl = MqttTopics.canPublish(
      topic,
      message.producer.type,
      this.conn.getUserId(),
      this.conn.getDeviceId()
    );
    if (!acl.allowed) {
      throw new Error(`MQTT Publishing Forbidden: ${acl.reason || 'Unauthorized topic'}`);
    }

    // 2. Schema serialization & payload size boundary checks
    const { json, byteLength } = MqttSerializer.serialize(message);

    // 3. Ensure client is connected
    const client = this.conn.getRawClient();
    if (!client || !client.connected) {
      throw new Error('MQTT Publishing Failed: Client is not connected to broker');
    }

    const qos = options.qos ?? 1;
    const startMs = Date.now();

    return new Promise<{ eventId: string; latencyMs: number }>((resolve, reject) => {
      client.publish(
        topic,
        json,
        { qos, retain: options.retain ?? false },
        (err) => {
          const latencyMs = Date.now() - startMs;
          if (err) {
            reject(new Error(`MQTT Broker PUBACK Error: ${err.message}`));
          } else {
            // Stage 2: Broker PUBACK received
            this.conn.recordBrokerLatency(latencyMs);
            this.conn.incrementPublished();
            ackManager.markBrokerReceived(message.eventId);

            resolve({
              eventId: message.eventId,
              latencyMs,
            });
          }
        }
      );
    });
  }
}

export const publisher = MqttPublisher.getInstance();
