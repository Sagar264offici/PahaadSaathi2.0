/**
 * PAHAADSAATHI — MQTT NETWORK CORE
 * Type definitions, contracts, payloads, and acknowledgement stages.
 */

export type MqttEnvironment = 'production' | 'staging' | 'development' | 'test';

export type MqttQoS = 0 | 1 | 2;

export type MqttEventType =
  | 'HAZARD_REPORTED'
  | 'HAZARD_UPDATED'
  | 'HAZARD_VERIFIED'
  | 'HAZARD_REJECTED'
  | 'REGIONAL_ALERT'
  | 'DEVICE_PRESENCE'
  | 'EMERGENCY_SOS'
  | 'REPORT_ACK'
  | 'AI_VERIFICATION_STATUS'
  | 'HAZARD_METADATA_CREATED'
  | 'IMAGE_UPLOAD_STARTED'
  | 'IMAGE_UPLOAD_COMPLETED'
  | 'IMAGE_ANALYSIS_STARTED'
  | 'IMAGE_ANALYSIS_COMPLETED'
  | 'SEMANTIC_EVIDENCE_READY'
  | 'DUPLICATE_CHECK_COMPLETED'
  | 'MODERATOR_REVIEW_REQUIRED';

export type ProducerType = 'mobile' | 'backend' | 'moderator';

export interface MqttProducer {
  type: ProducerType;
  deviceId: string;
  userId?: string;
  appVersion?: string;
}

export interface MqttMessage<T = unknown> {
  schemaVersion: number;
  eventId: string;
  correlationId: string;
  eventType: MqttEventType;
  createdAt: string;
  producer: MqttProducer;
  payload: T;
}

/**
 * 5-Stage Application-Level Acknowledgement Model
 */
export type MqttAckStage =
  | 'LOCALLY_QUEUED'       // Stage 1: Saved in local SQLite outbox
  | 'BROKER_RECEIVED'      // Stage 2: Broker PUBACK received
  | 'BACKEND_RECEIVED'     // Stage 3: Backend ingress worker received event
  | 'DATABASE_PERSISTED'    // Stage 4: Record committed to Supabase PostgreSQL
  | 'CLIENT_CONFIRMED';    // Stage 5: Originating device received durable ack

/**
 * Outbox Priority Levels
 */
export type MqttPriority =
  | 'P0' // Emergency SOS (Highest priority)
  | 'P1' // Serious hazards / Road blockages / Flash floods (High severity)
  | 'P2' // Regular hazard reports (Low / Medium severity)
  | 'P3' // Non-critical sync / Status updates
  | 'P4'; // Diagnostics / Analytics

/**
 * Payload: Hazard Reported
 */
export interface HazardReportPayload {
  hazardId: string;
  hazardType: string;
  district: string;
  severity: 'Low' | 'Medium' | 'High' | 'Critical';
  status: 'reported' | 'under_review' | 'corroborated' | 'verified' | 'confirmed_closure' | 'resolved' | 'rejected' | 'dismissed';
  description: string;
  latitude: number | null;
  longitude: number | null;
  hasPhoto: boolean;
  photoUrl?: string | null;
  reportedBy?: string;
  reporterPhone?: string | null;
  reportedByRole?: string;
  localTimestamp: string;
}

/**
 * Payload: Hazard Updated
 */
export interface HazardUpdatePayload {
  hazardId: string;
  status: 'reported' | 'under_review' | 'corroborated' | 'verified' | 'confirmed_closure' | 'resolved' | 'rejected' | 'dismissed';
  updatedBy: string;
  updatedRole: string;
  reason?: string;
  corroborationCount?: number;
  updatedAt: string;
}

/**
 * Payload: Regional Alert
 */
export interface RegionalAlertPayload {
  alertId: string;
  regionId: string;
  headlineEn: string;
  headlineHi: string;
  severity: 'advisory' | 'warning' | 'emergency';
  hazardType: string;
  affectedDistricts: string[];
  issuedAt: string;
  expiresAt?: string;
}

/**
 * Payload: Device Presence
 */
export interface DevicePresencePayload {
  deviceId: string;
  userId?: string;
  status: 'online' | 'offline' | 'reconnecting';
  networkType: 'wifi' | 'cellular_4g' | 'cellular_3g' | 'cellular_2g' | 'unknown';
  appVersion: string;
  timestamp: string;
}

/**
 * Payload: Emergency SOS
 */
export interface EmergencySosPayload {
  sosId: string;
  userId?: string;
  deviceId: string;
  latitude: number | null;
  longitude: number | null;
  timestamp: string;
  batteryLevel?: number;
  emergencyType: 'medical' | 'trapped' | 'landslide_blockage' | 'flood' | 'general';
  message?: string;
}

/**
 * Payload: Report Application Acknowledgement
 */
export interface ReportAckPayload {
  eventId: string;
  correlationId: string;
  hazardId?: string;
  stage: MqttAckStage;
  status: 'accepted' | 'persisted' | 'rejected' | 'duplicate';
  persistedAt?: string;
  rejectionReason?: string;
}

/**
 * Payload: AI Image Verification Status Event
 */
export interface AiVerificationStatusPayload {
  hazardId: string;
  status: 'IMAGE_UPLOAD_COMPLETED' | 'AI_VERIFICATION_STARTED' | 'AI_VERIFICATION_COMPLETED' | 'AI_VERIFICATION_FAILED';
  verdict?: 'consistent' | 'partially_consistent' | 'inconsistent' | 'insufficient_evidence';
  confidence?: number;
  timestamp: string;
}

/**
 * Client Connection Status
 */
export type MqttConnectionState =
  | 'DISCONNECTED'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'RECONNECTING'
  | 'WEAK_CONNECTION'
  | 'OFFLINE'
  | 'FALLBACK_SMS'
  | 'FALLBACK_BLE';

export interface MqttConnectionMetrics {
  connectionState: MqttConnectionState;
  reconnectAttempts: number;
  lastConnectedAt: string | null;
  lastDisconnectedAt: string | null;
  brokerAckLatencyMs: number | null;
  backendAckLatencyMs: number | null;
  messagesPublished: number;
  messagesReceived: number;
  duplicatesDropped: number;
  pendingOutboxCount: number;
}
