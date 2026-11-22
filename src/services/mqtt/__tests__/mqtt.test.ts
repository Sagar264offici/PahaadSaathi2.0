/**
 * PAHAADSAATHI — MQTT NETWORK CORE TEST SUITE
 * Comprehensive tests for:
 * 1. Topic architecture & ACL authorization rules
 * 2. Message schema serialization, validation, and payload size bounds
 * 3. 5-Stage application delivery guarantee and acknowledgements
 * 4. Priority-driven offline outbox queue (P0 > P1 > P2 > P3 > P4)
 * 5. Backend event processor, idempotency, and database persistence
 * 6. Security tests (unauthorized topics, wildcards, forged identity, replay attacks)
 * 7. Low-bandwidth performance benchmarks and payload measurements
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { MqttTopics } from '../MqttTopics';
import { MqttSerializer, MAX_HAZARD_PAYLOAD_BYTES, MAX_SOS_PAYLOAD_BYTES } from '../MqttSerializer';
import { MqttAcknowledgementManager } from '../MqttAcknowledgement';
import { MqttBackendProcessor } from '../backend/MqttBackendProcessor';
import {
  createOutboxEvent,
  compareOutboxEventsByPriority,
  isEventEligibleForSync,
} from '@/lib/sqlite/outboxLogic';
import {
  MqttMessage,
  HazardReportPayload,
  EmergencySosPayload,
  ReportAckPayload,
} from '@/types/mqtt';

describe('MQTT Network Core — Topic Architecture & ACL Enforcement', () => {
  const env = 'development';

  it('should generate standardized versioned topic paths', () => {
    assert.strictEqual(MqttTopics.hazardEvents(env), 'ps/v1/development/hazards/events');
    assert.strictEqual(MqttTopics.hazardUpdates(env, 'HZ-101'), 'ps/v1/development/hazards/HZ-101/updates');
    assert.strictEqual(MqttTopics.regionalAlerts(env, 'Chamoli'), 'ps/v1/development/regions/Chamoli/alerts');
    assert.strictEqual(MqttTopics.moderatorInbox(env, 'Rudraprayag'), 'ps/v1/development/moderators/Rudraprayag/inbox');
    assert.strictEqual(MqttTopics.userInbox(env, 'usr-999'), 'ps/v1/development/users/usr-999/inbox');
    assert.strictEqual(MqttTopics.userAck(env, 'usr-999'), 'ps/v1/development/users/usr-999/ack');
    assert.strictEqual(MqttTopics.reportIngress(env, 'usr-999'), 'ps/v1/development/ingress/reports/usr-999');
    assert.strictEqual(MqttTopics.emergencyEvents(env), 'ps/v1/development/emergency/events');
  });

  it('should accurately match MQTT topic patterns with single-level (+) wildcard', () => {
    const pattern = 'ps/v1/development/hazards/+/updates';
    assert.strictEqual(MqttTopics.match(pattern, 'ps/v1/development/hazards/HZ-101/updates'), true);
    assert.strictEqual(MqttTopics.match(pattern, 'ps/v1/development/hazards/HZ-999/updates'), true);
    assert.strictEqual(MqttTopics.match(pattern, 'ps/v1/development/hazards/events'), false);
    assert.strictEqual(MqttTopics.match(pattern, 'ps/v1/development/hazards/HZ-101/comments'), false);
  });

  it('should allow regular mobile users to publish ONLY to authorized ingress and presence topics', () => {
    const validIngress = MqttTopics.reportIngress(env, 'usr-alice');
    const checkIngress = MqttTopics.canPublish(validIngress, 'mobile', 'usr-alice', 'dev-01');
    assert.strictEqual(checkIngress.allowed, true);

    const validPresence = MqttTopics.devicePresence(env, 'dev-01');
    const checkPresence = MqttTopics.canPublish(validPresence, 'mobile', 'usr-alice', 'dev-01');
    assert.strictEqual(checkPresence.allowed, true);

    const validSos = MqttTopics.emergencyEvents(env);
    const checkSos = MqttTopics.canPublish(validSos, 'mobile', 'usr-alice', 'dev-01');
    assert.strictEqual(checkSos.allowed, true);
  });

  it('SECURITY: should prevent users from publishing to unauthorized or other users topics', () => {
    // 1. Publishing to another user's ingress topic
    const otherUserIngress = MqttTopics.reportIngress(env, 'usr-bob');
    const checkSpoof = MqttTopics.canPublish(otherUserIngress, 'mobile', 'usr-alice', 'dev-01');
    assert.strictEqual(checkSpoof.allowed, false);

    // 2. Publishing directly to public hazard feed
    const publicFeed = MqttTopics.hazardEvents(env);
    const checkPublic = MqttTopics.canPublish(publicFeed, 'mobile', 'usr-alice', 'dev-01');
    assert.strictEqual(checkPublic.allowed, false);

    // 3. Publishing to moderator inbox
    const modInbox = MqttTopics.moderatorInbox(env, 'Chamoli');
    const checkMod = MqttTopics.canPublish(modInbox, 'mobile', 'usr-alice', 'dev-01');
    assert.strictEqual(checkMod.allowed, false);

    // 4. Publishing using wildcard
    const wildcardPublish = 'ps/v1/development/ingress/reports/+';
    const checkWildcard = MqttTopics.canPublish(wildcardPublish, 'mobile', 'usr-alice', 'dev-01');
    assert.strictEqual(checkWildcard.allowed, false);
  });

  it('SECURITY: should prevent users from subscribing to other users private inboxes and root wildcards', () => {
    // 1. Root wildcard subscription '#' must be strictly forbidden
    const checkRootWildcard = MqttTopics.canSubscribe('#', 'mobile', 'usr-alice');
    assert.strictEqual(checkRootWildcard.allowed, false);

    const checkNamespaceWildcard = MqttTopics.canSubscribe('ps/v1/#', 'mobile', 'usr-alice');
    assert.strictEqual(checkNamespaceWildcard.allowed, false);

    // 2. Snooping on another user's inbox
    const otherInbox = MqttTopics.userInbox(env, 'usr-bob');
    const checkInbox = MqttTopics.canSubscribe(otherInbox, 'mobile', 'usr-alice');
    assert.strictEqual(checkInbox.allowed, false);

    // 3. Snooping on another user's ack topic
    const otherAck = MqttTopics.userAck(env, 'usr-bob');
    const checkAck = MqttTopics.canSubscribe(otherAck, 'mobile', 'usr-alice');
    assert.strictEqual(checkAck.allowed, false);

    // 4. Own ack topic is allowed
    const ownAck = MqttTopics.userAck(env, 'usr-alice');
    const checkOwnAck = MqttTopics.canSubscribe(ownAck, 'mobile', 'usr-alice');
    assert.strictEqual(checkOwnAck.allowed, true);
  });
});

describe('MQTT Network Core — Message Contract & Low-Bandwidth Serialization', () => {
  it('should validate and serialize a valid Hazard Report message', () => {
    const report: MqttMessage<HazardReportPayload> = {
      schemaVersion: 1,
      eventId: 'ev-test-101',
      correlationId: 'corr-101',
      eventType: 'HAZARD_REPORTED',
      createdAt: new Date().toISOString(),
      producer: {
        type: 'mobile',
        deviceId: 'device-test-01',
        userId: 'usr-01',
      },
      payload: {
        hazardId: 'HZ-1024',
        hazardType: 'Landslide',
        district: 'Rudraprayag',
        severity: 'High',
        status: 'reported',
        description: 'Large boulder fall near Badrinath Highway KM 42.',
        latitude: 30.5564,
        longitude: 79.5638,
        hasPhoto: false,
        reportedBy: 'Kailash Joshi',
        localTimestamp: new Date().toISOString(),
      },
    };

    const { json, byteLength } = MqttSerializer.serialize(report);
    assert.ok(json.length > 0);
    assert.ok(byteLength < MAX_HAZARD_PAYLOAD_BYTES);

    const deserialized = MqttSerializer.deserialize<HazardReportPayload>(json);
    assert.strictEqual(deserialized.eventId, 'ev-test-101');
    assert.strictEqual(deserialized.payload.hazardType, 'Landslide');
    assert.strictEqual(deserialized.payload.district, 'Rudraprayag');
  });

  it('LOW-BANDWIDTH: Emergency SOS payload should remain strictly under 1 KB', () => {
    const sosMessage: MqttMessage<EmergencySosPayload> = {
      schemaVersion: 1,
      eventId: 'ev-sos-01',
      correlationId: 'sos-01',
      eventType: 'EMERGENCY_SOS',
      createdAt: new Date().toISOString(),
      producer: {
        type: 'mobile',
        deviceId: 'device-test-sos',
        userId: 'usr-sos',
      },
      payload: {
        sosId: 'sos-01',
        deviceId: 'device-test-sos',
        latitude: 30.5564,
        longitude: 79.5638,
        emergencyType: 'landslide_blockage',
        batteryLevel: 42,
        message: 'Vehicle trapped between two rockfalls.',
        timestamp: new Date().toISOString(),
      },
    };

    const { byteLength } = MqttSerializer.serialize(sosMessage);
    assert.ok(byteLength < MAX_SOS_PAYLOAD_BYTES, `Expected < 1024 bytes, actual: ${byteLength} bytes`);
  });

  it('SECURITY: should strictly reject payloads containing binary/base64 photographs over MQTT', () => {
    const fakePhotoBase64 = 'data:image/jpeg;base64,' + 'A'.repeat(5000);
    const forbiddenMessage = {
      schemaVersion: 1,
      eventId: 'ev-invalid',
      correlationId: 'corr-invalid',
      eventType: 'HAZARD_REPORTED',
      createdAt: new Date().toISOString(),
      producer: {
        type: 'mobile',
        deviceId: 'device-01',
      },
      payload: {
        hazardId: 'HZ-999',
        rawPhotoBinary: fakePhotoBase64,
      },
    };

    assert.throws(() => {
      MqttSerializer.serialize(forbiddenMessage as any);
    }, /Photographs and large binary data must NEVER be sent over MQTT/);
  });

  it('SECURITY: should reject malformed JSON and invalid schema versions', () => {
    assert.throws(() => {
      MqttSerializer.deserialize('{ invalid_json_syntax');
    }, /Malformed JSON packet/);

    const invalidVersion = {
      schemaVersion: 0,
      eventId: 'ev-1',
      correlationId: 'c-1',
      eventType: 'HAZARD_REPORTED',
      createdAt: new Date().toISOString(),
      producer: { type: 'mobile', deviceId: 'd-1' },
      payload: {},
    };

    assert.throws(() => {
      MqttSerializer.serialize(invalidVersion as any);
    }, /Invalid or missing schemaVersion/);
  });
});

describe('MQTT Network Core — 5-Stage Delivery Guarantee & Acknowledgements', () => {
  const ackMgr = MqttAcknowledgementManager.getInstance();

  beforeEach(() => {
    ackMgr.clear();
  });

  it('should transition through all 5 acknowledgement stages sequentially', () => {
    const eventId = 'ev-ack-test-01';
    const correlationId = 'corr-ack-01';

    // STAGE 1: LOCALLY_QUEUED
    const rec1 = ackMgr.registerLocallyQueued(eventId, correlationId);
    assert.strictEqual(rec1.currentStage, 'LOCALLY_QUEUED');

    // STAGE 2: BROKER_RECEIVED (PUBACK returned)
    const rec2 = ackMgr.markBrokerReceived(eventId);
    assert.ok(rec2);
    assert.strictEqual(rec2?.currentStage, 'BROKER_RECEIVED');
    assert.ok(typeof rec2?.brokerLatencyMs === 'number');

    // STAGE 3: BACKEND_RECEIVED (Ingress consumer received event)
    const rec3 = ackMgr.markBackendReceived(eventId);
    assert.ok(rec3);
    assert.strictEqual(rec3?.currentStage, 'BACKEND_RECEIVED');

    // STAGE 4: DATABASE_PERSISTED (Committed to PostgreSQL)
    const rec4 = ackMgr.markDatabasePersisted(eventId, new Date().toISOString());
    assert.ok(rec4);
    assert.strictEqual(rec4?.currentStage, 'DATABASE_PERSISTED');

    // STAGE 5: CLIENT_CONFIRMED (Originating client received server ACK)
    const rec5 = ackMgr.markClientConfirmed(eventId);
    assert.ok(rec5);
    assert.strictEqual(rec5?.currentStage, 'CLIENT_CONFIRMED');
  });

  it('should process incoming ReportAckPayload from ps/v1/{env}/users/{userId}/ack', () => {
    const eventId = 'ev-ack-test-02';
    const correlationId = 'corr-ack-02';

    ackMgr.registerLocallyQueued(eventId, correlationId);
    ackMgr.markBrokerReceived(eventId);

    const incomingAck: ReportAckPayload = {
      eventId,
      correlationId,
      hazardId: 'HZ-PERSISTED-100',
      stage: 'DATABASE_PERSISTED',
      status: 'persisted',
      persistedAt: new Date().toISOString(),
    };

    const updated = ackMgr.processIncomingAck(incomingAck);
    assert.ok(updated);
    assert.strictEqual(updated?.currentStage, 'CLIENT_CONFIRMED');
  });
});

describe('MQTT Network Core — Priority-Driven Offline Outbox Engine', () => {
  it('should prioritize Emergency SOS (P0) over Critical Hazard (P1) and Regular Hazard (P2)', () => {
    const now = Date.now();
    const p2Regular = createOutboxEvent('HAZARD_REPORTED', 'HZ-2', { val: 2 }, 'idem-2', 'P2');
    const p0Emergency = createOutboxEvent('EMERGENCY_SOS', 'SOS-1', { val: 0 }, 'idem-0', 'P0');
    const p1Critical = createOutboxEvent('HAZARD_REPORTED', 'HZ-1', { val: 1 }, 'idem-1', 'P1');

    const queue = [p2Regular, p0Emergency, p1Critical];
    queue.sort(compareOutboxEventsByPriority);

    assert.strictEqual(queue[0].priority, 'P0', 'Emergency SOS must be first in outbox queue');
    assert.strictEqual(queue[1].priority, 'P1', 'Critical hazard must be second');
    assert.strictEqual(queue[2].priority, 'P2', 'Regular hazard must be third');
  });

  it('should evaluate event sync eligibility based on status and backoff timestamp', () => {
    const now = Date.now();
    const queuedEvent = createOutboxEvent('TEST', '1', {}, 'id-1', 'P2');
    assert.strictEqual(isEventEligibleForSync(queuedEvent, now), true);

    // Event currently publishing or processing is NOT eligible for duplicate sync
    queuedEvent.status = 'publishing';
    assert.strictEqual(isEventEligibleForSync(queuedEvent, now), false);

    // Event with future retry timestamp is NOT eligible until time has passed
    queuedEvent.status = 'pending';
    queuedEvent.nextRetryAt = new Date(now + 10000).toISOString();
    assert.strictEqual(isEventEligibleForSync(queuedEvent, now), false);
    assert.strictEqual(isEventEligibleForSync(queuedEvent, now + 10001), true);
  });
});

describe('MQTT Network Core — Backend Event Processor & Idempotency Engine', () => {
  const processor = MqttBackendProcessor.getInstance();

  beforeEach(() => {
    processor.clearProcessedIds();
  });

  it('should successfully process a valid incoming hazard report and return persisted ACK', async () => {
    const testMessage: MqttMessage<HazardReportPayload> = {
      schemaVersion: 1,
      eventId: 'ev-proc-01',
      correlationId: 'corr-proc-01',
      eventType: 'HAZARD_REPORTED',
      createdAt: new Date().toISOString(),
      producer: {
        type: 'mobile',
        deviceId: 'dev-proc-01',
        userId: 'usr-proc-01',
      },
      payload: {
        hazardId: 'HZ-PROC-1',
        hazardType: 'Flash Flood',
        district: 'Chamoli',
        severity: 'High',
        status: 'reported',
        description: 'Rising water levels near bridge.',
        latitude: 30.5,
        longitude: 79.5,
        hasPhoto: false,
        reportedBy: 'Devendra Singh',
        localTimestamp: new Date().toISOString(),
      },
    };

    const res = await processor.processHazardReportIngress(testMessage);
    assert.strictEqual(res.status, 'persisted');
    assert.strictEqual(res.ack.stage, 'DATABASE_PERSISTED');
    assert.strictEqual(res.ack.status, 'persisted');
  });

  it('IDEMPOTENCY: should detect duplicate QoS 1 deliveries and prevent duplicate database writes', async () => {
    const testMessage: MqttMessage<HazardReportPayload> = {
      schemaVersion: 1,
      eventId: 'ev-duplicate-test',
      correlationId: 'corr-dup-01',
      eventType: 'HAZARD_REPORTED',
      createdAt: new Date().toISOString(),
      producer: {
        type: 'mobile',
        deviceId: 'dev-dup-01',
        userId: 'usr-dup-01',
      },
      payload: {
        hazardId: 'HZ-DUP-1',
        hazardType: 'Road Damage',
        district: 'Pauri',
        severity: 'Medium',
        status: 'reported',
        description: 'Potholes and cracked asphalt.',
        latitude: 30.1,
        longitude: 78.8,
        hasPhoto: false,
        reportedBy: 'Mohit',
        localTimestamp: new Date().toISOString(),
      },
    };

    // First arrival: persisted
    const firstAttempt = await processor.processHazardReportIngress(testMessage);
    assert.strictEqual(firstAttempt.status, 'persisted');

    // Second arrival (simulated QoS 1 duplicate delivery): duplicate detected
    const secondAttempt = await processor.processHazardReportIngress(testMessage);
    assert.strictEqual(secondAttempt.status, 'duplicate');
    assert.strictEqual(secondAttempt.ack.status, 'duplicate');
    assert.strictEqual(secondAttempt.ack.stage, 'DATABASE_PERSISTED');
  });
});
