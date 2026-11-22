/**
 * PAHAADSAATHI — MQTT CONNECTION MANAGER
 * Centralized, lifecycle-aware WSS connection manager with automatic backoff,
 * network recovery, subscription restoration, and connection state observability.
 */

import mqtt, { MqttClient as RawMqttClient, IClientOptions } from 'mqtt';
import { getMqttConfig, MqttBrokerConfig } from './MqttConfig';
import { networkMonitor } from './MqttNetworkMonitor';
import { MqttConnectionMetrics, MqttConnectionState } from '@/types/mqtt';
import { SafeStorage } from '@/lib/storageHelper';

const DEVICE_ID_STORAGE_KEY = 'pahaadsaathi:mqtt:device_id';

export type ConnectionStateListener = (state: MqttConnectionState, metrics: MqttConnectionMetrics) => void;

export class MqttConnectionManager {
  private static instance: MqttConnectionManager;
  private client: RawMqttClient | null = null;
  private config: MqttBrokerConfig;
  private deviceId: string = 'device-default';
  private userId: string = 'anon';
  private connectionState: MqttConnectionState = 'DISCONNECTED';
  private reconnectAttempts = 0;
  private lastConnectedAt: string | null = null;
  private lastDisconnectedAt: string | null = null;
  private activeSubscriptions: Map<string, { qos: 0 | 1 | 2 }> = new Map();
  private stateListeners: Set<ConnectionStateListener> = new Set();
  private isConnecting = false;
  private isManualDisconnect = false;
  private backoffTimer: NodeJS.Timeout | null = null;

  // Metrics
  private messagesPublished = 0;
  private messagesReceived = 0;
  private duplicatesDropped = 0;
  private brokerAckLatencyMs: number | null = null;
  private backendAckLatencyMs: number | null = null;

  private constructor() {
    this.config = getMqttConfig();
    this.initDeviceId();
    this.listenToNetworkChanges();
  }

  static getInstance(): MqttConnectionManager {
    if (!this.instance) {
      this.instance = new MqttConnectionManager();
    }
    return this.instance;
  }

  private async initDeviceId(): Promise<void> {
    try {
      let stored = await SafeStorage.getItem(DEVICE_ID_STORAGE_KEY);
      if (!stored) {
        stored = `dev-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;
        await SafeStorage.setItem(DEVICE_ID_STORAGE_KEY, stored);
      }
      this.deviceId = stored;
    } catch {
      this.deviceId = `dev-${Date.now().toString(36)}`;
    }
  }

  private listenToNetworkChanges(): void {
    networkMonitor.onNetworkChange((isOnline) => {
      if (isOnline && (this.connectionState === 'OFFLINE' || this.connectionState === 'DISCONNECTED')) {
        this.reconnect();
      } else if (!isOnline) {
        this.setState('OFFLINE');
      }
    });
  }

  public setUserContext(userId?: string): void {
    this.userId = userId || 'anon';
  }

  public getDeviceId(): string {
    return this.deviceId;
  }

  public getUserId(): string {
    return this.userId;
  }

  public getConnectionState(): MqttConnectionState {
    return this.connectionState;
  }

  public getMetrics(): MqttConnectionMetrics {
    return {
      connectionState: this.connectionState,
      reconnectAttempts: this.reconnectAttempts,
      lastConnectedAt: this.lastConnectedAt,
      lastDisconnectedAt: this.lastDisconnectedAt,
      brokerAckLatencyMs: this.brokerAckLatencyMs,
      backendAckLatencyMs: this.backendAckLatencyMs,
      messagesPublished: this.messagesPublished,
      messagesReceived: this.messagesReceived,
      duplicatesDropped: this.duplicatesDropped,
      pendingOutboxCount: 0,
    };
  }

  public recordBrokerLatency(latencyMs: number): void {
    this.brokerAckLatencyMs = latencyMs;
  }

  public recordBackendLatency(latencyMs: number): void {
    this.backendAckLatencyMs = latencyMs;
  }

  public incrementPublished(): void {
    this.messagesPublished++;
  }

  public incrementReceived(): void {
    this.messagesReceived++;
  }

  public incrementDuplicatesDropped(): void {
    this.duplicatesDropped++;
  }

  /**
   * Generates secure unique client ID.
   */
  public generateClientId(): string {
    const cleanPrefix = this.config.clientIdPrefix;
    const cleanEnv = this.config.environment;
    const cleanUser = this.userId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 8);
    const cleanDevice = this.deviceId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 12);
    return `${cleanPrefix}-${cleanEnv}-${cleanUser}-${cleanDevice}`;
  }

  /**
   * Establishes MQTT connection over WSS.
   */
  public async connect(): Promise<RawMqttClient> {
    if (this.client && this.client.connected) {
      return this.client;
    }

    if (this.isConnecting && this.client) {
      return this.client;
    }

    this.isManualDisconnect = false;
    this.isConnecting = true;
    this.setState('CONNECTING');

    const clientId = this.generateClientId();

    const options: IClientOptions = {
      clientId,
      clean: this.config.cleanSession,
      keepalive: this.config.keepAlive,
      connectTimeout: this.config.connectTimeoutMs,
      reconnectPeriod: 0, // Managed manually with exponential backoff & jitter
      protocolVersion: 5, // MQTT 5.0
      properties: {
        sessionExpiryInterval: this.config.sessionExpiryInterval,
      },
    };

    if (this.config.username) {
      options.username = this.config.username;
    }
    if (this.config.password) {
      options.password = this.config.password;
    }

    try {
      this.client = mqtt.connect(this.config.wsUrl, options);
      this.attachEventListeners(this.client);
      return this.client;
    } catch (err) {
      this.isConnecting = false;
      this.setState('DISCONNECTED');
      this.scheduleReconnect();
      throw err;
    }
  }

  private attachEventListeners(client: RawMqttClient): void {
    client.on('connect', () => {
      this.isConnecting = false;
      this.reconnectAttempts = 0;
      this.lastConnectedAt = new Date().toISOString();
      this.setState('CONNECTED');

      // Resubscribe to all registered topics
      this.restoreSubscriptions();
    });

    client.on('reconnect', () => {
      this.setState('RECONNECTING');
    });

    client.on('close', () => {
      this.lastDisconnectedAt = new Date().toISOString();
      if (!this.isManualDisconnect) {
        this.setState('RECONNECTING');
        this.scheduleReconnect();
      } else {
        this.setState('DISCONNECTED');
      }
    });

    client.on('offline', () => {
      this.setState('OFFLINE');
    });

    client.on('error', (err) => {
      console.warn('[MqttConnectionManager] MQTT Client Error:', err.message);
      if (!client.connected) {
        this.setState('DISCONNECTED');
        this.scheduleReconnect();
      }
    });
  }

  private scheduleReconnect(): void {
    if (this.isManualDisconnect || this.backoffTimer) return;

    this.reconnectAttempts++;
    // Exponential backoff with jitter: min(30000, 2000 * 2^attempts) +/- 20%
    const base = Math.min(30000, 2000 * Math.pow(1.5, Math.min(this.reconnectAttempts, 8)));
    const jitter = base * 0.2 * (Math.random() * 2 - 1);
    const delay = Math.max(1000, Math.floor(base + jitter));

    this.backoffTimer = setTimeout(() => {
      this.backoffTimer = null;
      if (!this.isManualDisconnect && networkMonitor.getIsOnline()) {
        this.reconnect();
      }
    }, delay);
  }

  public reconnect(): void {
    if (this.backoffTimer) {
      clearTimeout(this.backoffTimer);
      this.backoffTimer = null;
    }

    if (this.client) {
      try {
        this.client.end(true);
      } catch {}
      this.client = null;
    }

    this.connect().catch(() => {});
  }

  public disconnect(): void {
    this.isManualDisconnect = true;
    if (this.backoffTimer) {
      clearTimeout(this.backoffTimer);
      this.backoffTimer = null;
    }

    if (this.client) {
      try {
        this.client.end();
      } catch {}
      this.client = null;
    }

    this.setState('DISCONNECTED');
  }

  public getRawClient(): RawMqttClient | null {
    return this.client;
  }

  public isConnected(): boolean {
    return Boolean(this.client && this.client.connected && this.connectionState === 'CONNECTED');
  }

  public registerSubscription(topic: string, qos: 0 | 1 | 2): void {
    this.activeSubscriptions.set(topic, { qos });
  }

  public unregisterSubscription(topic: string): void {
    this.activeSubscriptions.delete(topic);
  }

  private restoreSubscriptions(): void {
    if (!this.client || !this.client.connected) return;

    for (const [topic, opts] of this.activeSubscriptions.entries()) {
      this.client.subscribe(topic, { qos: opts.qos }, (err) => {
        if (err) {
          console.warn(`[MqttConnectionManager] Resubscription failed for ${topic}:`, err.message);
        }
      });
    }
  }

  public onStateChange(listener: ConnectionStateListener): () => void {
    this.stateListeners.add(listener);
    // Emit immediate current state
    listener(this.connectionState, this.getMetrics());
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  public setState(newState: MqttConnectionState): void {
    if (this.connectionState !== newState) {
      this.connectionState = newState;
      const metrics = this.getMetrics();
      for (const listener of this.stateListeners) {
        try {
          listener(newState, metrics);
        } catch (err) {
          console.warn('[MqttConnectionManager] State listener error:', err);
        }
      }
    }
  }
}

export const connectionManager = MqttConnectionManager.getInstance();
