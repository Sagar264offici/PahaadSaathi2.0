/**
 * PAHAADSAATHI — MQTT TOPIC REGISTRY & ACL ENGINE
 * Versioned namespace: ps/v1/{environment}/...
 * Topic builders, topic matching, and topic-level ACL security checks.
 */

import { MqttEnvironment, ProducerType } from '@/types/mqtt';

export class MqttTopics {
  /**
   * Generates root topic namespace.
   */
  static root(env: MqttEnvironment): string {
    return `ps/v1/${env}`;
  }

  /**
   * Public Hazard Events: ps/v1/{env}/hazards/events
   */
  static hazardEvents(env: MqttEnvironment): string {
    return `${this.root(env)}/hazards/events`;
  }

  /**
   * Specific Hazard Updates: ps/v1/{env}/hazards/{hazardId}/updates
   */
  static hazardUpdates(env: MqttEnvironment, hazardId: string): string {
    return `${this.root(env)}/hazards/${hazardId}/updates`;
  }

  /**
   * Wildcard Hazard Updates Subscription: ps/v1/{env}/hazards/+/updates
   */
  static allHazardUpdates(env: MqttEnvironment): string {
    return `${this.root(env)}/hazards/+/updates`;
  }

  /**
   * Regional Alerts: ps/v1/{env}/regions/{regionId}/alerts
   */
  static regionalAlerts(env: MqttEnvironment, regionId: string): string {
    return `${this.root(env)}/regions/${regionId}/alerts`;
  }

  /**
   * Moderator Inbox: ps/v1/{env}/moderators/{regionId}/inbox
   */
  static moderatorInbox(env: MqttEnvironment, regionId: string): string {
    return `${this.root(env)}/moderators/${regionId}/inbox`;
  }

  /**
   * User Direct Inbox: ps/v1/{env}/users/{userId}/inbox
   */
  static userInbox(env: MqttEnvironment, userId: string): string {
    return `${this.root(env)}/users/${userId}/inbox`;
  }

  /**
   * Device Presence: ps/v1/{env}/devices/{deviceId}/presence
   */
  static devicePresence(env: MqttEnvironment, deviceId: string): string {
    return `${this.root(env)}/devices/${deviceId}/presence`;
  }

  /**
   * Report Ingress: ps/v1/{env}/ingress/reports/{userId}
   */
  static reportIngress(env: MqttEnvironment, userId: string): string {
    return `${this.root(env)}/ingress/reports/${userId}`;
  }

  /**
   * Wildcard Ingress (for Backend ingestion worker only): ps/v1/{env}/ingress/reports/+
   */
  static allReportIngress(env: MqttEnvironment): string {
    return `${this.root(env)}/ingress/reports/+`;
  }

  /**
   * User Report Acknowledgements: ps/v1/{env}/users/{userId}/ack
   */
  static userAck(env: MqttEnvironment, userId: string): string {
    return `${this.root(env)}/users/${userId}/ack`;
  }

  /**
   * Emergency SOS Events: ps/v1/{env}/emergency/events
   */
  static emergencyEvents(env: MqttEnvironment): string {
    return `${this.root(env)}/emergency/events`;
  }

  /**
   * System Health: ps/v1/{env}/system/health
   */
  static systemHealth(env: MqttEnvironment): string {
    return `${this.root(env)}/system/health`;
  }

  /**
   * Checks whether an MQTT topic matches a subscription pattern (with '+' wildcard support).
   */
  static match(pattern: string, topic: string): boolean {
    if (pattern === topic) return true;
    if (pattern === '#') return true;

    const patternParts = pattern.split('/');
    const topicParts = topic.split('/');

    for (let i = 0; i < patternParts.length; i++) {
      const p = patternParts[i];
      if (p === '#') {
        return true;
      }
      if (p === '+') {
        if (i >= topicParts.length) return false;
        continue;
      }
      if (p !== topicParts[i]) {
        return false;
      }
    }

    return patternParts.length === topicParts.length;
  }

  /**
   * Topic-Level ACL Check: Determines if client is authorized to PUBLISH to target topic.
   */
  static canPublish(
    topic: string,
    role: ProducerType,
    userId?: string,
    deviceId?: string
  ): { allowed: boolean; reason?: string } {
    // Backend can publish to any valid topic
    if (role === 'backend') {
      return { allowed: true };
    }

    // No client may publish using wildcard characters
    if (topic.includes('+') || topic.includes('#')) {
      return { allowed: false, reason: 'Wildcard publication forbidden' };
    }

    // Validate prefix
    if (!topic.startsWith('ps/v1/')) {
      return { allowed: false, reason: 'Invalid topic namespace' };
    }

    const parts = topic.split('/');
    // Format: ps / v1 / {env} / {resource} / ...
    if (parts.length < 4) {
      return { allowed: false, reason: 'Malformed topic structure' };
    }

    const resource = parts[3];

    // Mobile clients can publish:
    // 1. Report Ingress: ps/v1/{env}/ingress/reports/{userId}
    if (resource === 'ingress') {
      if (parts[4] === 'reports') {
        const topicUserId = parts[5];
        if (!topicUserId) {
          return { allowed: false, reason: 'Missing user ID in ingress topic' };
        }
        if (userId && topicUserId !== userId) {
          return { allowed: false, reason: 'Cannot publish to other users ingress topic' };
        }
        return { allowed: true };
      }
    }

    // 2. Device Presence: ps/v1/{env}/devices/{deviceId}/presence
    if (resource === 'devices') {
      const topicDeviceId = parts[4];
      if (parts[5] === 'presence') {
        if (deviceId && topicDeviceId !== deviceId) {
          return { allowed: false, reason: 'Cannot publish presence for another device' };
        }
        return { allowed: true };
      }
    }

    // 3. Emergency SOS: ps/v1/{env}/emergency/events
    if (resource === 'emergency' && parts[4] === 'events') {
      return { allowed: true };
    }

    // 4. Moderator updates: ps/v1/{env}/hazards/{id}/updates (moderators only)
    if (resource === 'hazards' && parts[5] === 'updates') {
      if (role === 'moderator') {
        return { allowed: true };
      }
      return { allowed: false, reason: 'Only authorized moderators may publish hazard updates' };
    }

    // Regular users cannot publish directly to public hazard events or acks
    return { allowed: false, reason: `Unauthorized publication to ${resource}` };
  }

  /**
   * Topic-Level ACL Check: Determines if client is authorized to SUBSCRIBE to target topic.
   */
  static canSubscribe(
    pattern: string,
    role: ProducerType,
    userId?: string,
    authorizedRegions: string[] = []
  ): { allowed: boolean; reason?: string } {
    // Backend can subscribe to all topics
    if (role === 'backend') {
      return { allowed: true };
    }

    // Unrestricted root wildcard '#' is strictly forbidden for mobile clients
    if (pattern === '#' || pattern === 'ps/#' || pattern === 'ps/v1/#') {
      return { allowed: false, reason: 'Unrestricted wildcard subscription is forbidden' };
    }

    if (!pattern.startsWith('ps/v1/')) {
      return { allowed: false, reason: 'Invalid topic namespace' };
    }

    const parts = pattern.split('/');
    if (parts.length < 4) {
      return { allowed: false, reason: 'Malformed topic pattern' };
    }

    const resource = parts[3];

    // 1. Public hazard events: ps/v1/{env}/hazards/events
    if (resource === 'hazards') {
      if (parts[4] === 'events') return { allowed: true };
      if (parts[4] === '+' && parts[5] === 'updates') return { allowed: true };
      if (parts[5] === 'updates') return { allowed: true };
    }

    // 2. Regional alerts: ps/v1/{env}/regions/{regionId}/alerts
    if (resource === 'regions') {
      const regionId = parts[4];
      if (parts[5] === 'alerts') {
        if (regionId === '+' || authorizedRegions.length === 0 || authorizedRegions.includes(regionId)) {
          return { allowed: true };
        }
      }
    }

    // 3. Moderator inbox: ps/v1/{env}/moderators/{regionId}/inbox
    if (resource === 'moderators') {
      if (role !== 'moderator') {
        return { allowed: false, reason: 'Only moderators can subscribe to moderator inbox' };
      }
      return { allowed: true };
    }

    // 4. User Inbox: ps/v1/{env}/users/{userId}/inbox
    if (resource === 'users' && parts[5] === 'inbox') {
      const targetUserId = parts[4];
      if (targetUserId === '+') {
        return { allowed: false, reason: 'Wildcard user inbox subscription forbidden' };
      }
      if (userId && targetUserId !== userId) {
        return { allowed: false, reason: 'Cannot subscribe to another users private inbox' };
      }
      return { allowed: true };
    }

    // 5. User Report Acks: ps/v1/{env}/users/{userId}/ack
    if (resource === 'users' && parts[5] === 'ack') {
      const targetUserId = parts[4];
      if (targetUserId === '+') {
        return { allowed: false, reason: 'Wildcard user ack subscription forbidden' };
      }
      if (userId && targetUserId !== userId) {
        return { allowed: false, reason: 'Cannot subscribe to another users private ack' };
      }
      return { allowed: true };
    }

    // 6. System health: ps/v1/{env}/system/health
    if (resource === 'system' && parts[4] === 'health') {
      return { allowed: true };
    }

    // Ingress topics are restricted to backend workers
    if (resource === 'ingress') {
      return { allowed: false, reason: 'Only backend processors may subscribe to ingress topics' };
    }

    return { allowed: false, reason: `Subscription to ${resource} not permitted` };
  }
}
