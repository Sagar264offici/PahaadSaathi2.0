import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Palette, Radii, Spacing, Typography } from '@/theme/tokens';
import { mqttClient } from '@/services/mqtt/MqttClient';
import { ackManager, AckRecord } from '@/services/mqtt/MqttAcknowledgement';
import { MqttConnectionState } from '@/types/mqtt';

export type ConnectivityStatus =
  | 'ONLINE'
  | 'LIMITED_CONNECTIVITY'
  | 'OFFLINE_WITH_CELLULAR'
  | 'OFFLINE_WITHOUT_CELLULAR'
  | 'SYNCING'
  | 'UNKNOWN';

interface NetworkIndicatorProps {
  status?: ConnectivityStatus;
  compact?: boolean;
}

export function NetworkIndicator({ status, compact = false }: NetworkIndicatorProps) {
  const [mqttState, setMqttState] = useState<MqttConnectionState>(mqttClient.getConnectionState());
  const [lastAck, setLastAck] = useState<AckRecord | null>(null);

  useEffect(() => {
    const unsubConn = mqttClient.onStateChange((state) => {
      setMqttState(state);
    });

    const unsubAck = ackManager.onAnyAck((rec) => {
      setLastAck({ ...rec });
    });

    return () => {
      unsubConn();
      unsubAck();
    };
  }, []);

  const getConfig = () => {
    // If MQTT is connected, reflect the high-speed live event transport
    if (mqttState === 'CONNECTED') {
      const ackDetail =
        lastAck?.currentStage === 'DATABASE_PERSISTED' || lastAck?.currentStage === 'CLIENT_CONFIRMED'
          ? `Last Report Confirmed in Database (${lastAck.dbPersistLatencyMs || 250}ms)`
          : 'MQTT 5.0 Real-Time Event Backbone Active (WSS / TLS)';

      return {
        label: 'MQTT Live Connected',
        detail: ackDetail,
        color: Palette.verifiedGreen,
        bg: Palette.verifiedGreenLight,
      };
    }

    if (mqttState === 'RECONNECTING') {
      return {
        label: 'Reconnecting to MQTT...',
        detail: 'Exponential backoff with jitter • SQLite Outbox Preserved',
        color: Palette.saffron,
        bg: Palette.saffronLight,
      };
    }

    // Default to the provided status or fallback
    switch (status) {
      case 'ONLINE':
        return {
          label: 'Online (HTTPS Fallback)',
          detail: 'Connected to Supabase Emergency Cloud',
          color: Palette.verifiedGreen,
          bg: Palette.verifiedGreenLight,
        };
      case 'LIMITED_CONNECTIVITY':
        return {
          label: 'Limited Connection (2G/3G)',
          detail: 'High latency network • Compact <2KB payloads enforced',
          color: Palette.saffron,
          bg: Palette.saffronLight,
        };
      case 'OFFLINE_WITH_CELLULAR':
        return {
          label: 'Cellular Only (SMS Ready)',
          detail: 'No IP Internet • GSM 03.38 SMS Emergency Fallback Active',
          color: Palette.pineForestMuted,
          bg: Palette.pineForestContainer,
        };
      case 'OFFLINE_WITHOUT_CELLULAR':
        return {
          label: 'Offline (No Signal)',
          detail: 'Local SQLite & Bluetooth Store-and-Forward Active',
          color: Palette.rescueRed,
          bg: Palette.rescueRedLight,
        };
      case 'SYNCING':
        return {
          label: 'Syncing Outbox',
          detail: 'Uploading pending priority events...',
          color: Palette.infoBlue,
          bg: Palette.infoBlueLight,
        };
      case 'UNKNOWN':
      default:
        return {
          label: 'Checking Network',
          detail: 'Verifying emergency broker reachability...',
          color: Palette.slateMuted,
          bg: Palette.stoneLight,
        };
    }
  };

  const config = getConfig();

  if (compact) {
    return (
      <View style={[styles.compactContainer, { backgroundColor: config.bg }]}>
        <View style={[styles.dot, { backgroundColor: config.color }]} />
        <Text style={[styles.compactText, { color: config.color }]}>{config.label}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.fullContainer, { backgroundColor: config.bg, borderColor: config.color }]}>
      <View style={[styles.dot, { backgroundColor: config.color }]} />
      <View style={styles.textColumn}>
        <Text style={[styles.labelTitle, { color: config.color }]}>{config.label}</Text>
        <Text style={styles.labelDetail}>{config.detail}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  compactContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    borderRadius: Radii.full,
  },
  fullContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radii.md,
    borderWidth: 1,
    marginHorizontal: Spacing.screenPadding,
    marginVertical: Spacing.xs,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: Spacing.sm,
  },
  compactText: {
    fontFamily: Typography.fontFamily.semibold,
    fontSize: Typography.fontSize.caption,
    textTransform: 'uppercase',
  },
  textColumn: {
    flex: 1,
  },
  labelTitle: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.bodySm,
  },
  labelDetail: {
    fontFamily: Typography.fontFamily.regular,
    fontSize: Typography.fontSize.caption,
    color: Palette.slate,
    marginTop: 1,
  },
});
