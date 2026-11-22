/**
 * PAHAADSAATHI — MQTT NETWORK MONITOR
 * Observes network state transitions (2G/3G/4G/WiFi/Offline) and triggers reconnection/outbox flushes.
 */

import NetInfo, { NetInfoState } from '@react-native-community/netinfo';

export type NetworkChangeCallback = (isOnline: boolean, netState: NetInfoState) => void;

export class MqttNetworkMonitor {
  private static instance: MqttNetworkMonitor;
  private isOnline = true;
  private listeners: Set<NetworkChangeCallback> = new Set();
  private unsubscribeNetInfo: (() => void) | null = null;

  private constructor() {
    this.init();
  }

  static getInstance(): MqttNetworkMonitor {
    if (!this.instance) {
      this.instance = new MqttNetworkMonitor();
    }
    return this.instance;
  }

  private init(): void {
    try {
      this.unsubscribeNetInfo = NetInfo.addEventListener((state: NetInfoState) => {
        const online = Boolean(state.isConnected && state.isInternetReachable !== false);
        const changed = online !== this.isOnline;
        this.isOnline = online;

        if (changed) {
          for (const callback of this.listeners) {
            try {
              callback(online, state);
            } catch (err) {
              console.warn('[MqttNetworkMonitor] Listener callback error:', err);
            }
          }
        }
      });
    } catch {
      // In non-native or testing environments where NetInfo is mocked
      if (typeof window !== 'undefined') {
        window.addEventListener('online', () => this.handleWebState(true));
        window.addEventListener('offline', () => this.handleWebState(false));
        this.isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
      }
    }
  }

  private handleWebState(online: boolean): void {
    this.isOnline = online;
    for (const callback of this.listeners) {
      callback(online, {
        isConnected: online,
        isInternetReachable: online,
        type: 'other' as any,
        details: null,
      });
    }
  }

  public getIsOnline(): boolean {
    return this.isOnline;
  }

  public onNetworkChange(callback: NetworkChangeCallback): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  public destroy(): void {
    if (this.unsubscribeNetInfo) {
      this.unsubscribeNetInfo();
      this.unsubscribeNetInfo = null;
    }
    this.listeners.clear();
  }
}

export const networkMonitor = MqttNetworkMonitor.getInstance();
