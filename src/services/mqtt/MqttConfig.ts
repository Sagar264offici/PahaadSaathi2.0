/**
 * PAHAADSAATHI — MQTT BROKER CONFIGURATION
 * Loads configuration securely from environment variables with fallback defaults.
 */

import { MqttEnvironment } from '@/types/mqtt';

export interface MqttBrokerConfig {
  brokerUrl: string;
  wsUrl: string;
  port: number;
  username?: string;
  password?: string;
  clientIdPrefix: string;
  keepAlive: number;
  sessionExpiryInterval: number;
  environment: MqttEnvironment;
  connectTimeoutMs: number;
  maxReconnectIntervalMs: number;
  cleanSession: boolean;
}

/**
 * Returns current MQTT environment.
 */
export function getMqttEnvironment(): MqttEnvironment {
  const env =
    process.env.EXPO_PUBLIC_MQTT_ENVIRONMENT ||
    process.env.MQTT_ENVIRONMENT ||
    process.env.NODE_ENV ||
    'development';

  if (env === 'production') return 'production';
  if (env === 'staging') return 'staging';
  if (env === 'test') return 'test';
  return 'development';
}

/**
 * Loads broker configuration.
 * Uses EMQX Cloud / Serverless or public WSS fallback broker for zero-cost operation.
 * Default WSS endpoint: wss://broker.emqx.io:8084/mqtt (port 8084 over TLS/WSS)
 */
export function getMqttConfig(): MqttBrokerConfig {
  const environment = getMqttEnvironment();

  const wsUrl =
    process.env.EXPO_PUBLIC_MQTT_WS_URL ||
    process.env.MQTT_WS_URL ||
    'wss://broker.emqx.io:8084/mqtt';

  const brokerUrl =
    process.env.EXPO_PUBLIC_MQTT_BROKER_URL ||
    process.env.MQTT_BROKER_URL ||
    'broker.emqx.io';

  const port = parseInt(
    process.env.EXPO_PUBLIC_MQTT_PORT ||
      process.env.MQTT_PORT ||
      '8084',
    10
  );

  const username =
    process.env.EXPO_PUBLIC_MQTT_USERNAME ||
    process.env.MQTT_USERNAME ||
    undefined;

  const password =
    process.env.EXPO_PUBLIC_MQTT_PASSWORD ||
    process.env.MQTT_PASSWORD ||
    undefined;

  const clientIdPrefix =
    process.env.EXPO_PUBLIC_MQTT_CLIENT_ID_PREFIX ||
    process.env.MQTT_CLIENT_ID_PREFIX ||
    'ps';

  const keepAlive = parseInt(
    process.env.EXPO_PUBLIC_MQTT_KEEP_ALIVE ||
      process.env.MQTT_KEEP_ALIVE ||
      '30',
    10
  );

  const sessionExpiryInterval = parseInt(
    process.env.EXPO_PUBLIC_MQTT_SESSION_EXPIRY ||
      process.env.MQTT_SESSION_EXPIRY ||
      '3600',
    10
  );

  return {
    brokerUrl,
    wsUrl,
    port,
    username,
    password,
    clientIdPrefix,
    keepAlive,
    sessionExpiryInterval,
    environment,
    connectTimeoutMs: 10000,
    maxReconnectIntervalMs: 30000,
    cleanSession: false, // Persistent session for session recovery where supported
  };
}
