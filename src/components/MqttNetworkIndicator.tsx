/**
 * PAHAADSAATHI — MQTT NETWORK STATUS INDICATOR
 * Non-intrusive telemetry pill and status banner displaying real-time MQTT connectivity,
 * pending local reports, delivery acknowledgement stages, and emergency fallback availability.
 */

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Wifi, WifiOff, RefreshCw, Radio, CheckCircle, AlertTriangle, ShieldCheck } from 'lucide-react-native';
import { mqttClient } from '@/services/mqtt/MqttClient';
import { ackManager, AckRecord } from '@/services/mqtt/MqttAcknowledgement';
import { outboxRepository } from '@/lib/sqlite/outboxRepository';
import { MqttConnectionMetrics, MqttConnectionState } from '@/types/mqtt';
import { Palette } from '@/theme/tokens';

interface MqttNetworkIndicatorProps {
  language?: 'en' | 'hi';
}

export function MqttNetworkIndicator({ language = 'en' }: MqttNetworkIndicatorProps) {
  const [connectionState, setConnectionState] = useState<MqttConnectionState>('DISCONNECTED');
  const [metrics, setMetrics] = useState<MqttConnectionMetrics>(mqttClient.getMetrics());
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [lastAck, setLastAck] = useState<AckRecord | null>(null);
  const [expanded, setExpanded] = useState<boolean>(false);

  useEffect(() => {
    // 1. Listen to MQTT connection state
    const unsubscribeConn = mqttClient.onStateChange((state, m) => {
      setConnectionState(state);
      setMetrics(m);
    });

    // 2. Listen to acknowledgements
    const unsubscribeAck = ackManager.onAnyAck((rec) => {
      setLastAck({ ...rec });
    });

    // 3. Periodic pending count check
    const checkPending = async () => {
      try {
        const count = await outboxRepository.getPendingCount();
        setPendingCount(count);
      } catch {}
    };
    checkPending();
    const interval = setInterval(checkPending, 3000);

    return () => {
      unsubscribeConn();
      unsubscribeAck();
      clearInterval(interval);
    };
  }, []);

  const getStatusColor = () => {
    switch (connectionState) {
      case 'CONNECTED':
        return Palette.verifiedGreen;
      case 'CONNECTING':
      case 'RECONNECTING':
        return Palette.saffron;
      case 'WEAK_CONNECTION':
        return Palette.saffronMuted;
      case 'OFFLINE':
      case 'DISCONNECTED':
        return Palette.rescueRed;
      default:
        return Palette.slateMuted;
    }
  };

  const getStatusLabel = () => {
    const isHindi = language === 'hi';
    switch (connectionState) {
      case 'CONNECTED':
        return isHindi ? 'एमक्यूटीटी लाइव जुड़ा है' : 'MQTT Real-Time Live';
      case 'CONNECTING':
        return isHindi ? 'कनेक्ट हो रहा है...' : 'Connecting to MQTT...';
      case 'RECONNECTING':
        return isHindi ? 'पुनः प्रयास जारी...' : 'Reconnecting...';
      case 'WEAK_CONNECTION':
        return isHindi ? 'धीमा नेटवर्क (2G)' : 'Weak 2G Network';
      case 'OFFLINE':
        return isHindi ? 'ऑफलाइन (एसएमएस/ब्लूटूथ सक्रिय)' : 'Offline (SMS/BLE Active)';
      case 'DISCONNECTED':
        return isHindi ? 'डिस्कनेक्ट (लोकल सुरक्षित)' : 'Local Outbox Ready';
      default:
        return isHindi ? 'नेटवर्क स्थिति' : 'Network Mode';
    }
  };

  const getAckSummary = () => {
    if (!lastAck) return null;
    const isHindi = language === 'hi';
    switch (lastAck.currentStage) {
      case 'LOCALLY_QUEUED':
        return isHindi ? 'रिपोर्ट डिवाइस पर सुरक्षित' : 'Report saved on device (Stage 1)';
      case 'BROKER_RECEIVED':
        return isHindi ? 'ब्रोकर को भेजा गया' : 'Broker received (Stage 2)';
      case 'BACKEND_RECEIVED':
        return isHindi ? 'सर्वर को प्राप्त हुआ' : 'Server processing (Stage 3)';
      case 'DATABASE_PERSISTED':
      case 'CLIENT_CONFIRMED':
        return isHindi ? 'डेटाबेस में स्थायी सुरक्षित' : 'Confirmed in Database (Stage 4/5)';
      default:
        return null;
    }
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={[styles.pill, { borderColor: getStatusColor() }]}
        onPress={() => setExpanded(!expanded)}
        activeOpacity={0.8}
      >
        <View style={[styles.statusDot, { backgroundColor: getStatusColor() }]} />

        {connectionState === 'CONNECTED' ? (
          <Radio size={14} color={Palette.verifiedGreen} style={styles.icon} />
        ) : connectionState === 'OFFLINE' || connectionState === 'DISCONNECTED' ? (
          <WifiOff size={14} color={Palette.rescueRed} style={styles.icon} />
        ) : (
          <RefreshCw size={14} color={Palette.saffron} style={styles.icon} />
        )}

        <Text style={[styles.label, { color: Palette.alpineInk }]}>{getStatusLabel()}</Text>

        {pendingCount > 0 && (
          <View style={styles.pendingBadge}>
            <Text style={styles.pendingBadgeText}>
              {pendingCount} {language === 'hi' ? 'लंबित' : 'pending'}
            </Text>
          </View>
        )}
      </TouchableOpacity>

      {expanded && (
        <View style={styles.detailCard}>
          <View style={styles.detailRow}>
            <Text style={styles.detailKey}>{language === 'hi' ? 'कनेक्शन प्रोटोकॉल:' : 'Protocol:'}</Text>
            <Text style={styles.detailVal}>MQTT 5.0 (WSS / TLS)</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailKey}>{language === 'hi' ? 'ब्रोकर लैटेंसी:' : 'Broker Latency:'}</Text>
            <Text style={styles.detailVal}>
              {metrics.brokerAckLatencyMs ? `${metrics.brokerAckLatencyMs} ms` : 'N/A'}
            </Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailKey}>{language === 'hi' ? 'डेटाबेस पुष्टि:' : 'DB Ack Latency:'}</Text>
            <Text style={styles.detailVal}>
              {metrics.backendAckLatencyMs ? `${metrics.backendAckLatencyMs} ms` : 'Immediate'}
            </Text>
          </View>

          {lastAck && (
            <View style={styles.ackBanner}>
              <CheckCircle size={14} color={Palette.verifiedGreen} style={{ marginRight: 6 }} />
              <Text style={styles.ackText}>{getAckSummary()}</Text>
            </View>
          )}

          <View style={styles.fallbackNotice}>
            <ShieldCheck size={14} color={Palette.pineForestMuted} style={{ marginRight: 6 }} />
            <Text style={styles.fallbackText}>
              {language === 'hi'
                ? 'नेटवर्क विफलता पर रिपोर्ट कभी नष्ट नहीं होगी। एसएमएस और ब्लूटूथ रिले तैयार हैं।'
                : 'Zero-loss guarantee: Offline reports stored in SQLite with SMS & BLE fallback.'}
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 16,
    marginVertical: 6,
    alignItems: 'center',
    zIndex: 10,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 2,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    marginRight: 6,
  },
  icon: {
    marginRight: 6,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
  },
  pendingBadge: {
    backgroundColor: Palette.saffronLight,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
    marginLeft: 8,
  },
  pendingBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: Palette.saffronMuted,
  },
  detailCard: {
    marginTop: 8,
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: Palette.slateBorder,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 3,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  detailKey: {
    fontSize: 11,
    color: Palette.slateMuted,
  },
  detailVal: {
    fontSize: 11,
    fontWeight: '600',
    color: Palette.alpineInk,
  },
  ackBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Palette.verifiedGreenLight,
    borderRadius: 8,
    padding: 8,
    marginTop: 6,
  },
  ackText: {
    fontSize: 11,
    color: Palette.verifiedGreen,
    fontWeight: '600',
  },
  fallbackNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Palette.stoneLight,
    borderRadius: 8,
    padding: 8,
    marginTop: 6,
  },
  fallbackText: {
    fontSize: 11,
    color: Palette.pineForestMuted,
    flex: 1,
  },
});
