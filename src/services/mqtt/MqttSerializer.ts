/**
 * PAHAADSAATHI — MQTT MESSAGE SERIALIZER & RUNTIME VALIDATOR
 * Enforces message contract, schema versions, payload size limits, and security boundaries.
 */

import { MqttMessage, MqttEventType } from '@/types/mqtt';

export const MAX_SOS_PAYLOAD_BYTES = 1024;        // 1 KB
export const MAX_HAZARD_PAYLOAD_BYTES = 2048;     // 2 KB
export const MAX_GENERIC_PACKET_BYTES = 32768;    // 32 KB

const VALID_EVENT_TYPES: Set<MqttEventType> = new Set([
  'HAZARD_REPORTED',
  'HAZARD_UPDATED',
  'HAZARD_VERIFIED',
  'HAZARD_REJECTED',
  'REGIONAL_ALERT',
  'DEVICE_PRESENCE',
  'EMERGENCY_SOS',
  'REPORT_ACK',
  'AI_VERIFICATION_STATUS',
]);

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export class MqttSerializer {
  /**
   * Validates runtime schema compliance of an MQTT message.
   */
  static validate<T>(message: unknown): ValidationResult {
    if (!message || typeof message !== 'object') {
      return { valid: false, error: 'Message must be a non-null object' };
    }

    const msg = message as Partial<MqttMessage<T>>;

    if (typeof msg.schemaVersion !== 'number' || msg.schemaVersion < 1) {
      return { valid: false, error: 'Invalid or missing schemaVersion (expected >= 1)' };
    }

    if (!msg.eventId || typeof msg.eventId !== 'string' || msg.eventId.trim().length === 0) {
      return { valid: false, error: 'Invalid or missing eventId' };
    }

    if (!msg.correlationId || typeof msg.correlationId !== 'string') {
      return { valid: false, error: 'Invalid or missing correlationId' };
    }

    if (!msg.eventType || !VALID_EVENT_TYPES.has(msg.eventType as MqttEventType)) {
      return { valid: false, error: `Invalid eventType: ${String(msg.eventType)}` };
    }

    if (!msg.createdAt || typeof msg.createdAt !== 'string' || isNaN(Date.parse(msg.createdAt))) {
      return { valid: false, error: 'Invalid or missing createdAt ISO-8601 timestamp' };
    }

    if (!msg.producer || typeof msg.producer !== 'object') {
      return { valid: false, error: 'Invalid or missing producer block' };
    }

    if (!msg.producer.deviceId || typeof msg.producer.deviceId !== 'string') {
      return { valid: false, error: 'producer.deviceId is required' };
    }

    if (!['mobile', 'backend', 'moderator'].includes(msg.producer.type)) {
      return { valid: false, error: `Invalid producer.type: ${msg.producer.type}` };
    }

    if (!msg.payload || typeof msg.payload !== 'object') {
      return { valid: false, error: 'Message payload must be an object' };
    }

    // Inspect payload for forbidden binary/photo data
    const payloadStr = JSON.stringify(msg.payload);
    if (payloadStr.includes('data:image/') || payloadStr.length > MAX_GENERIC_PACKET_BYTES) {
      return {
        valid: false,
        error: 'Photographs and large binary data must NEVER be sent over MQTT. Use HTTPS Supabase Storage.',
      };
    }

    // Payload specific size bounds
    const payloadBytes = Buffer.byteLength(payloadStr, 'utf8');
    if (msg.eventType === 'EMERGENCY_SOS' && payloadBytes > MAX_SOS_PAYLOAD_BYTES) {
      return {
        valid: false,
        error: `Emergency SOS payload exceeds maximum allowed size of ${MAX_SOS_PAYLOAD_BYTES} bytes (actual: ${payloadBytes} bytes)`,
      };
    }

    if (msg.eventType === 'HAZARD_REPORTED' && payloadBytes > MAX_HAZARD_PAYLOAD_BYTES) {
      return {
        valid: false,
        error: `Hazard report payload exceeds maximum allowed size of ${MAX_HAZARD_PAYLOAD_BYTES} bytes (actual: ${payloadBytes} bytes)`,
      };
    }

    return { valid: true };
  }

  /**
   * Serializes message to JSON string with strict validation and size verification.
   */
  static serialize<T>(message: MqttMessage<T>): { json: string; byteLength: number } {
    const validation = this.validate<T>(message);
    if (!validation.valid) {
      throw new Error(`MQTT Message Serialization Error: ${validation.error}`);
    }

    const json = JSON.stringify(message);
    const byteLength = Buffer.byteLength(json, 'utf8');

    if (byteLength > MAX_GENERIC_PACKET_BYTES) {
      throw new Error(
        `MQTT Packet exceeds global maximum bound of ${MAX_GENERIC_PACKET_BYTES} bytes (actual: ${byteLength} bytes)`
      );
    }

    return { json, byteLength };
  }

  /**
   * Deserializes raw JSON string or Buffer into validated MqttMessage<T>.
   */
  static deserialize<T = unknown>(input: string | Buffer): MqttMessage<T> {
    const raw = typeof input === 'string' ? input : input.toString('utf8');

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error('MQTT Message Deserialization Error: Malformed JSON packet');
    }

    const validation = this.validate<T>(parsed);
    if (!validation.valid) {
      throw new Error(`MQTT Message Deserialization Error: ${validation.error}`);
    }

    return parsed as MqttMessage<T>;
  }

  /**
   * Generates a unique UUID v4 string.
   */
  static generateId(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
}
