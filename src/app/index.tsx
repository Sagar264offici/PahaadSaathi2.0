import { AppPressable as Pressable } from '@/components/ui/AppPressable';
import { AppText as Text } from '@/components/ui/AppText';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Link, useRouter, type Href } from 'expo-router';
import * as Location from 'expo-location';
import {
  ActivityIndicator, Alert, Linking, RefreshControl, Share,
  StyleSheet, Vibration, View, useWindowDimensions, ScrollView as NativeScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  AlertTriangle, ArrowUpRight, Bell, BookOpen, Building2, ChevronRight,
  ClipboardPlus, Clock, Eye, Map, MapPin, Phone, Radio, RefreshCw, Share2, Shield,
  ShieldCheck, ThumbsUp, UserRound, Users, Wifi, WifiOff, X,
} from 'lucide-react-native';
import { useTheme } from '@/hooks/useTheme';
import { useConnectivity } from '@/hooks/useConnectivity';
import { useDesktopNavigation } from '@/components/AppNavigation';
import { ThemeToggle } from '@/components/ThemeToggle';
import { SmoothScrollView as ScrollView } from '@/components/SmoothScrollView';
import { BottomNavigation } from '@/components/BottomNavigation';
import { StatusLabel } from '@/components/ui/StatusLabel';
import { Palette, Radii } from '@/theme/tokens';
import {
  type Hazard, getHazards, subscribe, getOfflineQueue, syncOfflineQueue, corroborateHazard,
  initRealtimeHazardSubscription, simulateNearbyHazardUpload, refreshHazards, isDemoHazard,
} from '@/data/hazardStore';
import { calculateHaversineDistanceMeters } from '@/lib/incidents/deduplication';
import { communityStore } from '@/data/communityStore';
import { UTTARAKHAND_EMERGENCY_DIRECTORY } from '@/lib/sms/directory';

const SECTOR_LOCATION = { latitude: 30.5564, longitude: 79.5638 };
const actions = [
  { title: 'Report a hazard', detail: 'Share a road or weather hazard', href: '/report', icon: ClipboardPlus },
  { title: 'Hazard map', detail: 'Check routes and closures', href: '/map', icon: Map },
  { title: 'Community aid', detail: 'Request or offer local help', href: '/community', icon: Users },
  { title: 'Safety guides', detail: 'Read offline safety guidance', href: '/explore', icon: BookOpen },
] as const;

const resources = [
  { title: 'Resident alerts', href: '/resident/alerts', icon: Bell },
  { title: 'Offline relay', href: '/relay', icon: Radio },
  { title: 'Control room', href: '/control-room', icon: Building2 },
] as const;

type FeedFilter = 'all' | 'landslide' | 'road' | 'weather' | 'critical' | 'verified' | 'nearby';

export default function HomeScreen() {
  const router = useRouter();
  const { theme, isDark } = useTheme();
  const { isConnected } = useConnectivity();
  const desktop = useDesktopNavigation();
  const { width } = useWindowDimensions();
  const twoColumns = width >= 820;

  const [hazards, setHazards] = useState<Hazard[]>(getHazards());
  const [queueCount, setQueueCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [activeFilter, setActiveFilter] = useState<FeedFilter>('all');
  const [corroboratedIds, setCorroboratedIds] = useState<Record<string, boolean>>({});

  // Active user location (defaults to Joshimath, Chamoli Sector coordinates)
  const [gpsLocation, setGpsLocation] = useState<typeof SECTOR_LOCATION | null>(null);
  const userLocation = gpsLocation ?? SECTOR_LOCATION;

  // Range-based Heads-Up In-App Notification Banner
  const [activeNotification, setActiveNotification] = useState<{
    hazard: Hazard;
    distanceKm: number;
  } | null>(null);

  const triggerProximityNotification = useCallback((hazard: Hazard, distanceKm: number) => {
    if (distanceKm > 50) return;
    setActiveNotification({ hazard, distanceKm });
    try {
      Vibration.vibrate([0, 250, 100, 250]);
    } catch { /* Vibration is optional on this device. */ }
  }, []);

  const dismissNotification = () => setActiveNotification(null);

  const activeCommunity = communityStore.getCommunities()[0];
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState(false);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    setRefreshError(false);
    try {
      await refreshHazards();
    } catch {
      setRefreshError(true);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const loc = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          setGpsLocation({
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
          });
        }
      } catch {
        // Keeps default Joshimath sector coordinates
      }
    })();
  }, []);

  useEffect(() => {
    const unsubHazards = subscribe((items) => setHazards(items));
    refreshHazards().catch(() => {});

    const pollInterval = setInterval(() => {
      refreshHazards().catch(() => {});
    }, 15000);

    const unsubRealtime = initRealtimeHazardSubscription((incomingHazard, dist) => {
      let distance = dist;
      if (typeof distance !== 'number' && incomingHazard.latitude && incomingHazard.longitude && userLocation) {
        const meters = calculateHaversineDistanceMeters(
          userLocation.latitude,
          userLocation.longitude,
          incomingHazard.latitude,
          incomingHazard.longitude
        );
        distance = Math.round((meters / 1000) * 10) / 10;
      }
      if (typeof distance === 'number') {
        if (distance > 50) return;
        triggerProximityNotification(incomingHazard, distance);
      }
    }, userLocation);

    (async () => {
      try {
        const queued = await getOfflineQueue();
        setQueueCount(queued.length);
      } catch {
        setQueueCount(0);
      }
    })();

    return () => {
      clearInterval(pollInterval);
      unsubHazards();
      unsubRealtime();
    };
  }, [userLocation, triggerProximityNotification]);

  const handleSyncQueue = useCallback(async () => {
    setSyncing(true);
    try {
      await syncOfflineQueue();
      const queued = await getOfflineQueue();
      setQueueCount(queued.length);
      Alert.alert('Sync Successful', 'Offline reports synchronized with emergency server.');
    } catch {
      Alert.alert('Sync Failed', 'Could not connect to emergency server. Stored safely locally.');
    } finally {
      setSyncing(false);
    }
  }, []);

  const handleCorroborate = useCallback(async (hazardId: string) => {
    if (corroboratedIds[hazardId]) return;
    setCorroboratedIds((prev) => ({ ...prev, [hazardId]: true }));
    try {
      Vibration.vibrate(50);
    } catch { /* Optional */ }
    await corroborateHazard(hazardId);
  }, [corroboratedIds]);

  const handleShareHazard = useCallback(async (hazard: Hazard) => {
    try {
      await Share.share({
        title: `PahaadSaathi Hazard Alert: ${hazard.type}`,
        message: `PahaadSaathi · ${isDemoHazard(hazard) ? "Demo report" : "Hazard alert"}\n${hazard.type} at ${hazard.location}\n${hazard.description}\nhttps://pahaadsaathi-app.vercel.app`,
      });
    } catch { /* Cancelled */ }
  }, []);

  const handleSimulateRemoteUpload = useCallback(() => {
    const { hazard, distanceKm } = simulateNearbyHazardUpload(userLocation);
    triggerProximityNotification(hazard, distanceKm);
  }, [userLocation, triggerProximityNotification]);

  const hazardsWithDistance = useMemo(() => {
    return hazards
      .filter(
        (item) =>
          item.status !== 'rejected' &&
          item.status !== 'dismissed' &&
          item.ai_verification_verdict?.toLowerCase() !== 'inconsistent'
      )
      .map((item) => {
        const distanceKm = item.latitude != null && item.longitude != null
          ? calculateHaversineDistanceMeters(
              userLocation.latitude, userLocation.longitude, item.latitude, item.longitude,
            ) / 1000
          : null;
        return { ...item, distanceKm };
      });
  }, [hazards, userLocation]);

  const filteredFeed = useMemo(() => {
    switch (activeFilter) {
      case 'nearby':
        return hazardsWithDistance.filter((h) => !isDemoHazard(h) && h.distanceKm != null && h.distanceKm <= 15);
      case 'critical':
        return hazardsWithDistance.filter((h) => !isDemoHazard(h) && h.severity === 'High');
      case 'landslide':
        return hazardsWithDistance.filter((h) => !isDemoHazard(h) && h.type.toLowerCase().includes('landslide'));
      case 'road':
        return hazardsWithDistance.filter((h) => !isDemoHazard(h) && (h.type.toLowerCase().includes('road') || h.status === 'confirmed_closure'));
      case 'weather':
        return hazardsWithDistance.filter((h) => !isDemoHazard(h) && (h.type.toLowerCase().includes('water') || h.type.toLowerCase().includes('flood') || h.type.toLowerCase().includes('rain')));
      case 'verified':
        return hazardsWithDistance.filter(
          (h) => !isDemoHazard(h) && (h.status === 'corroborated' || h.status === 'confirmed_closure')
        );
      case 'all':
      default:
        return hazardsWithDistance;
    }
  }, [hazardsWithDistance, activeFilter]);

  const nearbyCount = useMemo(() => {
    return hazardsWithDistance.filter((h) => !isDemoHazard(h) && h.distanceKm != null && h.distanceKm <= 15).length;
  }, [hazardsWithDistance]);

  const filters: { value: FeedFilter; label: string }[] = [
    { value: 'all', label: 'All Alerts' },
    { value: 'landslide', label: 'Landslides' },
    { value: 'road', label: 'Road Blocks' },
    { value: 'weather', label: 'Weather & Rain' },
    { value: 'critical', label: 'High Risk' },
    { value: 'verified', label: 'Verified Reports' },
    { value: 'nearby', label: `Nearby (<15km) · ${nearbyCount}` },
  ];

  const networkLabel = isConnected === null ? 'Checking connection' : isConnected ? 'Online' : 'Offline';
  const networkColor = isConnected === null ? theme.textTertiary : isConnected ? theme.success : theme.warning;
  const NetworkIcon = isConnected === false ? WifiOff : Wifi;
  const cardStyle = { backgroundColor: theme.surface, borderColor: theme.border };
  const sector = `${activeCommunity.name}, ${activeCommunity.district}`;

  const featuredHazard = filteredFeed[0];
  const secondaryHazards = filteredFeed.slice(1);

  const actionPanel = (
    <View style={[styles.panel, cardStyle]}>
      <View style={[styles.panelHeader, { borderColor: theme.border }]}>
        <Text accessibilityRole="header" style={[styles.panelTitle, { color: theme.textPrimary }]}>Quick actions</Text>
      </View>
      <View style={!twoColumns && styles.actionsGrid}>
        {actions.map(({ title, detail, href, icon: Icon }) => (
          <Link key={href} href={href} asChild>
            <Pressable accessibilityRole="link" style={StyleSheet.flatten([
              styles.panelRow, !twoColumns && styles.actionCell, { borderColor: theme.border },
            ])}>
              <Icon size={19} color={Palette.cobalt} strokeWidth={1.8} />
              <View style={styles.flex}>
                <Text style={[styles.actionTitle, { color: theme.textPrimary }]}>{title}</Text>
                {twoColumns && <Text style={[styles.small, { color: theme.textSecondary }]}>{detail}</Text>}
              </View>
              {twoColumns && <ChevronRight size={15} color={theme.textTertiary} />}
            </Pressable>
          </Link>
        ))}
      </View>
    </View>
  );

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: isDark ? '#080C14' : '#F9F8F6' }]}>
      {/* SHIELD-INSPIRED MODERN APP HEADER */}
      <View style={[styles.header, { backgroundColor: isDark ? 'rgba(8, 12, 20, 0.95)' : 'rgba(249, 248, 246, 0.95)', borderColor: theme.border }]}>
        <View style={styles.headerInner}>
          <View style={styles.headerBrand}>
            <View style={styles.shieldBadge}>
              <Shield size={20} color="#FFFFFF" strokeWidth={2.4} />
            </View>
            <View style={styles.flex}>
              <Text accessibilityRole="header" style={[styles.headerBrandTitle, { color: theme.textPrimary }]}>
                PAHAADSAATHI
              </Text>
              <Text style={[styles.headerBrandSub, { color: theme.textSecondary }]}>
                Mountain Safety Network · Chamoli
              </Text>
            </View>
          </View>
          <View style={styles.controls}>
            {desktop && (
              <View style={[styles.headerLocation, { borderColor: theme.border }]}>
                <MapPin size={15} color={Palette.cobalt} />
                <Text style={[styles.small, { color: theme.textSecondary }]}>{sector}</Text>
              </View>
            )}
            <View accessibilityLabel={networkLabel} style={[styles.networkPill, { backgroundColor: isDark ? '#1E293B' : '#EFF6FF' }]}>
              <NetworkIcon size={13} color={networkColor} />
              {width > 360 && <Text style={[styles.networkText, { color: networkColor }]}>{networkLabel}</Text>}
            </View>
            <Link href="/account" asChild>
              <Pressable accessibilityRole="link" accessibilityLabel="User profile" style={styles.avatarBtn}>
                <View style={[styles.avatarInner, { backgroundColor: isDark ? '#1E293B' : '#E2E8F0' }]}>
                  <UserRound size={17} color={Palette.cobalt} strokeWidth={2.2} />
                </View>
                <View style={styles.avatarOnlineDot} />
              </Pressable>
            </Link>
            <ThemeToggle />
          </View>
        </View>
      </View>

      {/* Heads-up alert banner if notification active */}
      {activeNotification && (
        <View accessibilityLiveRegion="polite" style={[
          styles.notification, cardStyle, { borderLeftColor: theme.error },
        ]}>
          <Bell size={19} color={theme.error} />
          <View style={styles.flex}>
            <Text style={[styles.actionTitle, { color: theme.textPrimary }]}>
              {isDemoHazard(activeNotification.hazard) ? 'Demo proximity alert' : 'Nearby hazard alert'}
            </Text>
            <Text style={[styles.small, { color: theme.textSecondary }]}>
              {activeNotification.hazard.type} · {activeNotification.hazard.location} · {activeNotification.distanceKm} km
            </Text>
            <Pressable accessibilityRole="button" onPress={() => {
              const id = activeNotification.hazard.id;
              dismissNotification();
              router.push({ pathname: '/hazard/[id]', params: { id } });
            }}>
              <Text style={[styles.linkText, { color: Palette.cobalt }]}>View report</Text>
            </Pressable>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Dismiss alert" onPress={dismissNotification} hitSlop={10}>
            <X size={18} color={theme.textSecondary} />
          </Pressable>
        </View>
      )}

      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.content, desktop && styles.desktopGutter]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={Palette.cobalt} />}
      >
        {/* SHIELD-INSPIRED HERO GREETING */}
        <View style={styles.headlineSection}>
          <Text style={[styles.headlineMain, { color: theme.textPrimary }]}>
            What&apos;s Happening Nearby,{'\n'}
            <Text style={{ color: Palette.terracotta }}>Get Safety Alerts</Text>
          </Text>
        </View>

        {/* SHIELD-INSPIRED LIVE TICKER PILL */}
        <Pressable
          style={[
            styles.tickerBanner,
            {
              backgroundColor: isDark ? 'rgba(245, 158, 11, 0.12)' : '#FFFBEB',
              borderColor: isDark ? 'rgba(245, 158, 11, 0.3)' : '#FDE68A',
            },
          ]}
          onPress={() => {
            if (featuredHazard) {
              router.push({ pathname: '/hazard/[id]', params: { id: featuredHazard.id } });
            }
          }}
        >
          <View style={styles.tickerIconWrap}>
            <AlertTriangle size={15} color="#D97706" />
          </View>
          <View style={styles.tickerContent}>
            <Text style={[styles.tickerTitle, { color: isDark ? '#FDE68A' : '#92400E' }]} numberOfLines={1}>
              {featuredHazard ? `${featuredHazard.type}: ${featuredHazard.location}` : 'BRO Road Clearance: NH-07 Live'}
            </Text>
            <View style={styles.tickerLiveSub}>
              <View style={styles.tickerPulseDot} />
              <Text style={[styles.tickerSubText, { color: isDark ? '#FCD34D' : '#B45309' }]}>
                Live update
              </Text>
            </View>
          </View>
          <View style={styles.tickerActionBtn}>
            <Text style={styles.tickerActionText}>Live</Text>
          </View>
        </Pressable>

        {/* SHIELD-INSPIRED HORIZONTAL CATEGORY PILL TABS */}
        <NativeScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterScroll}
        >
          {filters.map(({ value, label }) => {
            const selected = activeFilter === value;
            return (
              <Pressable
                key={value}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => setActiveFilter(value)}
                style={[
                  styles.filterPill,
                  selected
                    ? { backgroundColor: isDark ? Palette.cobalt : '#0F172A', borderColor: isDark ? Palette.cobalt : '#0F172A' }
                    : { backgroundColor: isDark ? '#1E293B' : '#FFFFFF', borderColor: isDark ? '#334155' : '#E2E8F0' },
                ]}
              >
                <Text
                  style={[
                    styles.filterPillText,
                    {
                      color: selected
                        ? '#FFFFFF'
                        : isDark ? '#CBD5E1' : '#475569',
                      fontWeight: selected ? '700' : '500',
                    },
                  ]}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </NativeScrollView>

        {/* SPOTLIGHT HERO INCIDENT CARD */}
        {featuredHazard && (
          <View style={styles.spotlightCard}>
            <Image
              source={
                featuredHazard.photo_url
                  ? { uri: featuredHazard.photo_url }
                  : require('@/assets/images/garhwal-terrain.webp')
              }
              style={styles.spotlightImage}
              contentFit="cover"
            />
            <LinearGradient
              colors={['rgba(0,0,0,0.2)', 'rgba(11,18,30,0.5)', 'rgba(11,18,30,0.96)']}
              locations={[0, 0.45, 1]}
              style={styles.spotlightGradient}
            >
              <View style={styles.spotlightTopRow}>
                <View style={styles.spotlightCategoryBadge}>
                  <AlertTriangle size={13} color="#FFFFFF" strokeWidth={2.4} />
                  <Text style={styles.spotlightCategoryText}>{featuredHazard.type.toUpperCase()}</Text>
                </View>
                <View style={[
                  styles.spotlightSeverityBadge,
                  { backgroundColor: featuredHazard.severity === 'High' ? Palette.rescueRed : Palette.amberGold }
                ]}>
                  <Text style={styles.spotlightSeverityText}>
                    {featuredHazard.severity === 'High' ? 'CRITICAL RISK' : 'MEDIUM RISK'}
                  </Text>
                </View>
              </View>

              <View style={styles.spotlightBottom}>
                <Text style={styles.spotlightLocation} numberOfLines={2}>
                  {featuredHazard.location}
                </Text>
                <Text style={styles.spotlightDesc} numberOfLines={2}>
                  {featuredHazard.description}
                </Text>

                <View style={styles.spotlightMetaRow}>
                  <View style={styles.metaItem}>
                    <Clock size={12} color="#94A3B8" />
                    <Text style={styles.metaText}>{featuredHazard.time || 'Live'}</Text>
                  </View>
                  {featuredHazard.distanceKm != null && (
                    <View style={styles.metaItem}>
                      <MapPin size={12} color="#94A3B8" />
                      <Text style={styles.metaText}>{featuredHazard.distanceKm.toFixed(1)} km away</Text>
                    </View>
                  )}
                  {featuredHazard.area && (
                    <View style={styles.metaItem}>
                      <Building2 size={12} color="#94A3B8" />
                      <Text style={styles.metaText}>{featuredHazard.area}</Text>
                    </View>
                  )}
                </View>

                <View style={styles.spotlightActionsBar}>
                  <View style={styles.spotlightStatsGroup}>
                    <View style={styles.statPill}>
                      <Eye size={13} color="#CBD5E1" />
                      <Text style={styles.statPillText}>18.4K</Text>
                    </View>
                    <Pressable
                      style={styles.statPill}
                      onPress={() => handleCorroborate(featuredHazard.id)}
                    >
                      <ThumbsUp
                        size={13}
                        color={corroboratedIds[featuredHazard.id] ? '#4ADE80' : '#CBD5E1'}
                      />
                      <Text style={[styles.statPillText, corroboratedIds[featuredHazard.id] && { color: '#4ADE80' }]}>
                        {(featuredHazard.corroborationCount ?? 0) + (corroboratedIds[featuredHazard.id] ? 1 : 0)}
                      </Text>
                    </Pressable>
                    <Pressable
                      style={styles.statPill}
                      onPress={() => handleShareHazard(featuredHazard)}
                    >
                      <Share2 size={13} color="#CBD5E1" />
                    </Pressable>
                  </View>

                  <Link href={{ pathname: '/hazard/[id]', params: { id: featuredHazard.id } }} asChild>
                    <Pressable style={styles.spotlightViewBtn}>
                      <Text style={styles.spotlightViewBtnText}>View Details</Text>
                      <ChevronRight size={14} color="#FFFFFF" />
                    </Pressable>
                  </Link>
                </View>
              </View>
            </LinearGradient>
          </View>
        )}

        {/* SHIELD-INSPIRED: VERIFIED REPORTS AND SAFETY UPDATES 2-COLUMN GRID */}
        <View style={styles.verifiedSection}>
          <View style={styles.verifiedHeader}>
            <Text style={[styles.verifiedTitle, { color: theme.textPrimary }]}>
              Verified Reports, and Safety Updates
            </Text>
            <Text style={[styles.verifiedSub, { color: theme.textSecondary }]}>
              Official Uttarakhand DDMA & BRO road status
            </Text>
          </View>

          <View style={styles.verifiedGrid}>
            <Pressable
              style={styles.verifiedCard}
              onPress={() => setActiveFilter('landslide')}
            >
              <LinearGradient
                colors={['rgba(234, 88, 12, 0.45)', 'rgba(15, 23, 42, 0.95)']}
                style={styles.verifiedCardGrad}
              >
                <View style={[styles.verifiedBadge, { backgroundColor: '#EA580C' }]}>
                  <AlertTriangle size={11} color="#FFFFFF" />
                  <Text style={styles.verifiedBadgeText}>Rockfall</Text>
                </View>
                <View style={styles.verifiedCardBottom}>
                  <Text style={styles.verifiedCardTitle}>Active Rockfall</Text>
                  <Text style={styles.verifiedCardMeta}>NH-07 Helang Pass</Text>
                </View>
              </LinearGradient>
            </Pressable>

            <Pressable
              style={styles.verifiedCard}
              onPress={() => setActiveFilter('weather')}
            >
              <LinearGradient
                colors={['rgba(2, 132, 199, 0.45)', 'rgba(15, 23, 42, 0.95)']}
                style={styles.verifiedCardGrad}
              >
                <View style={[styles.verifiedBadge, { backgroundColor: '#0284C7' }]}>
                  <Radio size={11} color="#FFFFFF" />
                  <Text style={styles.verifiedBadgeText}>Weather</Text>
                </View>
                <View style={styles.verifiedCardBottom}>
                  <Text style={styles.verifiedCardTitle}>Heavy Rain Warning</Text>
                  <Text style={styles.verifiedCardMeta}>Chamoli High Passes</Text>
                </View>
              </LinearGradient>
            </Pressable>

            <Link href="/control-room" asChild>
              <Pressable style={styles.verifiedCard}>
                <LinearGradient
                  colors={['rgba(16, 185, 129, 0.45)', 'rgba(15, 23, 42, 0.95)']}
                  style={styles.verifiedCardGrad}
                >
                  <View style={[styles.verifiedBadge, { backgroundColor: '#10B981' }]}>
                    <ShieldCheck size={11} color="#FFFFFF" />
                    <Text style={styles.verifiedBadgeText}>BRO Units</Text>
                  </View>
                  <View style={styles.verifiedCardBottom}>
                    <Text style={styles.verifiedCardTitle}>Clearance Units</Text>
                    <Text style={styles.verifiedCardMeta}>Bulldozers Active</Text>
                  </View>
                </LinearGradient>
              </Pressable>
            </Link>

            <Link href="/community" asChild>
              <Pressable style={styles.verifiedCard}>
                <LinearGradient
                  colors={['rgba(99, 102, 241, 0.45)', 'rgba(15, 23, 42, 0.95)']}
                  style={styles.verifiedCardGrad}
                >
                  <View style={[styles.verifiedBadge, { backgroundColor: '#6366F1' }]}>
                    <Building2 size={11} color="#FFFFFF" />
                    <Text style={styles.verifiedBadgeText}>Shelters</Text>
                  </View>
                  <View style={styles.verifiedCardBottom}>
                    <Text style={styles.verifiedCardTitle}>Relief Shelters</Text>
                    <Text style={styles.verifiedCardMeta}>Joshimath & Helang</Text>
                  </View>
                </LinearGradient>
              </Pressable>
            </Link>
          </View>
        </View>

        {/* OFFLINE QUEUE NOTICE */}
        {queueCount > 0 && (
          <View style={[styles.queue, cardStyle]}>
            <View style={styles.flex}>
              <Text style={[styles.actionTitle, { color: theme.textPrimary }]}>{queueCount} pending {queueCount === 1 ? 'report' : 'reports'}</Text>
              <Text style={[styles.small, { color: theme.textSecondary }]}>Saved on this device and waiting to sync.</Text>
            </View>
            <Pressable accessibilityRole="button" onPress={handleSyncQueue} disabled={syncing} style={styles.utilityButton}>
              <Text style={[styles.linkText, { color: Palette.cobalt }]}>{syncing ? 'Syncing…' : 'Sync now'}</Text>
            </Pressable>
          </View>
        )}

        {!twoColumns && actionPanel}

        {/* FEED LIST FOR ALL REPORTS */}
        <View style={[styles.lower, twoColumns && styles.lowerWide]}>
          <View style={[styles.feed, { minWidth: 0 }]}>
            <View style={styles.sectionHeading}>
              <View style={styles.flex}>
                <Text accessibilityRole="header" style={[styles.sectionTitle, { color: theme.textPrimary }]}>Live Mountain Reports</Text>
                <Text style={[styles.small, { color: theme.textSecondary }]}>Real-time citizen & authority updates</Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="Refresh incident reports" onPress={handleRefresh}
                accessibilityState={{ busy: refreshing }} disabled={refreshing} style={[styles.iconButton, cardStyle]}>
                {refreshing ? <ActivityIndicator size="small" color={Palette.cobalt} /> : <RefreshCw size={16} color={Palette.cobalt} />}
              </Pressable>
            </View>

            {(refreshError || isConnected === false || filteredFeed.some((item) => item.fromCache)) && (
              <View style={[styles.feedNotice, { backgroundColor: isDark ? '#1E293B' : '#EFF6FF' }]} accessibilityLiveRegion="polite">
                <WifiOff size={16} color={Palette.cobalt} />
                <Text style={[styles.small, styles.flex, { color: theme.textPrimary }]}>
                  {refreshError ? 'Could not refresh reports. Try again.' : 'Saved reports may be out of date.'}
                </Text>
              </View>
            )}

            {filteredFeed.length === 0 && (
              <View style={[styles.empty, cardStyle]}>
                <AlertTriangle size={25} color={theme.textTertiary} />
                <Text style={[styles.actionTitle, { color: theme.textPrimary }]}>No reports for this view</Text>
                <Text style={[styles.small, { color: theme.textSecondary }]}>Change the filter or refresh for updates.</Text>
              </View>
            )}

            {secondaryHazards.length > 0 && (
              <View style={styles.feedCardsContainer}>
                {secondaryHazards.map((item) => {
                  const demo = isDemoHazard(item);
                  const confirmed = corroboratedIds[item.id];
                  const severityColor = item.severity === 'High' ? Palette.rescueRed : item.severity === 'Medium' ? Palette.amberGold : Palette.verifiedGreen;
                  const locationText = item.distanceKm == null ? '' : `${item.distanceKm.toFixed(1)} km away`;

                  return (
                    <View key={item.id} style={[styles.modernFeedCard, { backgroundColor: isDark ? '#111827' : '#FFFFFF', borderColor: isDark ? '#1F2937' : '#E2E8F0' }]}>
                      <View style={styles.feedCardTop}>
                        <View style={styles.feedBadgesRow}>
                          <View style={[styles.categoryBadge, { backgroundColor: isDark ? '#1E293B' : '#F1F5F9' }]}>
                            <Text style={[styles.categoryBadgeText, { color: isDark ? '#93C5FD' : Palette.cobalt }]}>{item.type}</Text>
                          </View>
                          <View style={[styles.severityBadge, { backgroundColor: item.severity === 'High' ? '#FEE2E2' : '#FEF3C7' }]}>
                            <Text style={[styles.severityBadgeText, { color: severityColor }]}>{item.severity} Risk</Text>
                          </View>
                          {!demo && <StatusLabel status={item.status} />}
                        </View>
                        {item.time && (
                          <Text style={[styles.feedCardTime, { color: theme.textTertiary }]}>{item.time}</Text>
                        )}
                      </View>

                      <Link href={{ pathname: '/hazard/[id]', params: { id: item.id } }} asChild>
                        <Pressable style={styles.feedCardContentLink}>
                          <Text style={[styles.feedCardTitle, { color: theme.textPrimary }]}>{item.location}</Text>
                          <Text style={[styles.feedCardDesc, { color: theme.textSecondary }]} numberOfLines={2}>{item.description}</Text>
                        </Pressable>
                      </Link>

                      {item.photo_url && (
                        <Link href={{ pathname: '/hazard/[id]', params: { id: item.id } }} asChild>
                          <Pressable style={styles.feedCardPhotoWrap}>
                            <Image source={{ uri: item.photo_url }} contentFit="cover" style={styles.feedCardPhoto} />
                          </Pressable>
                        </Link>
                      )}

                      <View style={styles.feedCardFooter}>
                        <View style={styles.feedCardMeta}>
                          {item.area && (
                            <View style={styles.metaItem}>
                              <MapPin size={12} color={theme.textTertiary} />
                              <Text style={[styles.metaText, { color: theme.textSecondary }]}>{item.area}</Text>
                            </View>
                          )}
                          {locationText ? (
                            <Text style={[styles.metaText, { color: Palette.cobalt, fontWeight: '600' }]}>{locationText}</Text>
                          ) : null}
                        </View>

                        <View style={styles.feedCardActions}>
                          {!demo && (
                            <Pressable
                              style={[styles.feedActionBtn, confirmed && { backgroundColor: isDark ? '#064E3B' : '#DCFCE7' }]}
                              onPress={() => handleCorroborate(item.id)}
                            >
                              <ThumbsUp size={14} color={confirmed ? Palette.verifiedGreen : theme.textSecondary} />
                              <Text style={[styles.feedActionBtnText, { color: confirmed ? Palette.verifiedGreen : theme.textSecondary }]}>
                                {(item.corroborationCount ?? 0) + (confirmed ? 1 : 0)}
                              </Text>
                            </Pressable>
                          )}
                          <Pressable style={styles.feedActionBtn} onPress={() => handleShareHazard(item)}>
                            <Share2 size={14} color={theme.textSecondary} />
                          </Pressable>
                        </View>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </View>

          {/* SIDEBAR RAIL FOR WIDE / DESKTOP SCREENS */}
          <View style={[styles.rail, twoColumns && styles.railWide]}>
            {twoColumns && actionPanel}
            <View style={[styles.panel, cardStyle]}>
              <View style={[styles.panelHeader, { borderColor: theme.border }]}>
                <Phone size={17} color={theme.error} />
                <Text accessibilityRole="header" style={[styles.panelTitle, { color: theme.textPrimary }]}>Emergency contacts</Text>
              </View>
              {UTTARAKHAND_EMERGENCY_DIRECTORY.slice(0, 4).map((contact) => (
                <Pressable key={contact.contactId} accessibilityRole="button"
                  accessibilityLabel={`Call ${contact.authorityName} at ${contact.phoneNumber}`}
                  onPress={() => Linking.openURL(`tel:${contact.phoneNumber}`)}
                  style={[styles.panelRow, { borderColor: theme.border }]}>
                  <View style={styles.flex}>
                    <Text style={[styles.contactName, { color: theme.textSecondary }]}>{contact.authorityName.replace(/\s*\(\d+\)$/, '')}</Text>
                    <Text style={[styles.contactNumber, { color: theme.textPrimary }]}>{contact.phoneNumber}</Text>
                  </View>
                  <ArrowUpRight size={16} color={theme.textTertiary} />
                </Pressable>
              ))}
            </View>
            <View style={[styles.panel, cardStyle]}>
              <View style={[styles.panelHeader, { borderColor: theme.border }]}>
                <Radio size={17} color={Palette.cobalt} />
                <Text accessibilityRole="header" style={[styles.panelTitle, { color: theme.textPrimary }]}>Response resources</Text>
              </View>
              {resources.map(({ title, href, icon: Icon }) => (
                <Link key={href} href={href as Href} asChild>
                  <Pressable accessibilityRole="link" style={StyleSheet.flatten([styles.panelRow, { borderColor: theme.border }])}>
                    <Icon size={17} color={Palette.cobalt} />
                    <Text style={[styles.contactName, styles.flex, { color: theme.textPrimary }]}>{title}</Text>
                    <ChevronRight size={16} color={theme.textTertiary} />
                  </Pressable>
                </Link>
              ))}
            </View>
            {__DEV__ && (
              <Pressable accessibilityRole="button" onPress={handleSimulateRemoteUpload} style={styles.utilityButton}>
                <Text style={[styles.small, { color: theme.textSecondary }]}>Test a demo proximity alert</Text>
              </Pressable>
            )}
          </View>
        </View>
      </ScrollView>

      {/* FLOATING MODERN DOCK */}
      <BottomNavigation />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1, minWidth: 0 },
  header: { borderBottomWidth: 1 },
  headerInner: {
    width: '100%',
    maxWidth: 1376,
    alignSelf: 'center',
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 8,
  },
  headerBrand: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  shieldBadge: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: Palette.cobalt,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Palette.cobalt,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  headerBrandTitle: { fontSize: 16, fontWeight: '900', letterSpacing: 0.6 },
  headerBrandSub: { fontSize: 11, fontWeight: '500' },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerLocation: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRightWidth: 1, paddingRight: 12, marginRight: 4 },
  networkPill: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 30, borderRadius: 15, paddingHorizontal: 9 },
  networkText: { fontSize: 11, fontWeight: '600' },
  avatarBtn: { position: 'relative', width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  avatarInner: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: '#CBD5E1' },
  avatarOnlineDot: { position: 'absolute', bottom: 1, right: 1, width: 8, height: 8, borderRadius: 4, backgroundColor: '#10B981', borderWidth: 1.5, borderColor: '#FFFFFF' },
  iconButton: { width: 38, height: 38, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  content: { width: '100%', maxWidth: 1376, alignSelf: 'center', padding: 16, paddingBottom: 110, gap: 18 },
  desktopGutter: { paddingHorizontal: 32, paddingTop: 24, gap: 24 },

  // Headline
  headlineSection: { paddingTop: 4, paddingBottom: 2 },
  headlineMain: { fontSize: 26, fontWeight: '800', letterSpacing: -0.6, lineHeight: 34 },

  // Ticker Banner
  tickerBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 9999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 9,
    gap: 10,
  },
  tickerIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#FEF3C7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tickerContent: { flex: 1, minWidth: 0 },
  tickerTitle: { fontSize: 12, fontWeight: '700' },
  tickerLiveSub: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 1 },
  tickerPulseDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Palette.rescueRed },
  tickerSubText: { fontSize: 10, fontWeight: '600' },
  tickerActionBtn: {
    backgroundColor: Palette.cobalt,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 9999,
  },
  tickerActionText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },

  // Filter Pills Scroll
  filterScroll: { flexDirection: 'row', gap: 8, paddingVertical: 2 },
  filterPill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 9999,
    borderWidth: 1,
  },
  filterPillText: { fontSize: 12 },

  // Spotlight Hero Card
  spotlightCard: {
    width: '100%',
    height: 350,
    borderRadius: Radii.cardLg,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#0F172A',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 18,
    elevation: 8,
  },
  spotlightImage: { width: '100%', height: '100%', position: 'absolute' },
  spotlightGradient: {
    width: '100%',
    height: '100%',
    justifyContent: 'space-between',
    padding: 20,
  },
  spotlightTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  spotlightCategoryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 9999,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  spotlightCategoryText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  spotlightSeverityBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 9999,
  },
  spotlightSeverityText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  spotlightBottom: { gap: 6 },
  spotlightLocation: { color: '#FFFFFF', fontSize: 20, fontWeight: '800', letterSpacing: -0.3, lineHeight: 26 },
  spotlightDesc: { color: '#E2E8F0', fontSize: 13, lineHeight: 18 },
  spotlightMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { color: '#94A3B8', fontSize: 11 },
  spotlightActionsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.15)',
    marginTop: 6,
  },
  spotlightStatsGroup: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  statPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 9999,
  },
  statPillText: { color: '#FFFFFF', fontSize: 11, fontWeight: '600' },
  spotlightViewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Palette.cobalt,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 9999,
  },
  spotlightViewBtnText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },

  // Verified 2-Column Grid
  verifiedSection: { gap: 10 },
  verifiedHeader: { gap: 2 },
  verifiedTitle: { fontSize: 18, fontWeight: '800', letterSpacing: -0.3 },
  verifiedSub: { fontSize: 12 },
  verifiedGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  verifiedCard: {
    flex: 1,
    minWidth: '47%',
    height: 110,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#0F172A',
  },
  verifiedCardGrad: {
    width: '100%',
    height: '100%',
    justifyContent: 'space-between',
    padding: 12,
  },
  verifiedBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 9999,
  },
  verifiedBadgeText: { color: '#FFFFFF', fontSize: 9, fontWeight: '800' },
  verifiedCardBottom: { gap: 2 },
  verifiedCardTitle: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  verifiedCardMeta: { color: '#94A3B8', fontSize: 10 },

  // Modern Feed Cards
  feedCardsContainer: { gap: 12 },
  modernFeedCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 16,
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  feedCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  feedBadgesRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  categoryBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 9999 },
  categoryBadgeText: { fontSize: 11, fontWeight: '700' },
  severityBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 9999 },
  severityBadgeText: { fontSize: 10, fontWeight: '800' },
  feedCardTime: { fontSize: 11 },
  feedCardContentLink: { gap: 4 },
  feedCardTitle: { fontSize: 15, fontWeight: '800' },
  feedCardDesc: { fontSize: 13, lineHeight: 18 },
  feedCardPhotoWrap: { borderRadius: 14, overflow: 'hidden', marginTop: 4 },
  feedCardPhoto: { width: '100%', height: 160 },
  feedCardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    marginTop: 2,
  },
  feedCardMeta: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  feedCardActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  feedActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 9999,
  },
  feedActionBtnText: { fontSize: 11, fontWeight: '700' },

  // Panels & Standard
  notification: { minHeight: 64, borderWidth: 1, borderLeftWidth: 4, borderRadius: 8, padding: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  queue: { minHeight: 64, borderWidth: 1, borderRadius: 8, padding: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  panel: { borderWidth: 1, borderRadius: 18, overflow: 'hidden' },
  panelHeader: { minHeight: 46, borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 14 },
  panelTitle: { fontSize: 14, fontWeight: '800' },
  actionsGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  actionCell: { width: '50%', minHeight: 60, paddingHorizontal: 12, paddingVertical: 10 },
  panelRow: { minHeight: 52, borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10 },
  actionTitle: { fontSize: 13, fontWeight: '700' },
  small: { fontSize: 12, lineHeight: 16 },
  linkText: { fontSize: 12, fontWeight: '700' },
  utilityButton: { minHeight: 38, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center' },
  lower: { gap: 18 },
  lowerWide: { flexDirection: 'row', alignItems: 'flex-start' },
  feed: { flex: 1, gap: 12 },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  sectionTitle: { fontSize: 18, fontWeight: '800', letterSpacing: -0.3 },
  feedNotice: { minHeight: 44, borderRadius: 10, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  empty: { minHeight: 120, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center', padding: 20, gap: 4 },
  rail: { width: '100%', gap: 16 },
  railWide: { width: 330, flexShrink: 0 },
  contactName: { fontSize: 13, fontWeight: '700' },
  contactNumber: { fontSize: 12, fontWeight: '500' },
});
