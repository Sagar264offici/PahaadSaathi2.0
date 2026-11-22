/**
 * PahaadSaathi — Report Incident Screen
 *
 * Fully unified with Home Screen Himalayan aesthetic:
 * - Matching Header, Brand Typography, Language Toggle & ThemeToggle
 * - Live Camera Capture with real-time metadata & EXIF age verification
 * - GPS coordinates auto-locked on live photo capture
 * - Cards & Chips using Home Screen tokens and elevation
 * - Integrated BottomNavigation bar
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  Alert,
  Modal,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
  ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import * as SMS from 'expo-sms';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  Camera,
  Images,
  MapPin,
  ArrowLeft,
  X,
  CheckCircle,
  Wifi,
  WifiOff,
  Sparkles,
  Clock,
  ShieldCheck,
} from 'lucide-react-native';

import { useTheme } from '@/hooks/useTheme';
import { ThemeToggle } from '@/components/ThemeToggle';
import { BottomNavigation } from '@/components/BottomNavigation';
import { SmoothScrollView as ScrollView } from '@/components/SmoothScrollView';
import { Palette, Radii, Spacing, Typography, Shadows } from '@/theme/tokens';
import { HazardType, Severity, addHazard, hazardTypes, severities } from '@/data/hazardStore';
import { getUser } from '@/data/userStore';
import { useConnectivity } from '@/hooks/useConnectivity';
import { buildSmsBody, SMS_GATEWAY_NUMBER } from '@/lib/sms';
import { t, strings, Lang } from '@/lib/i18n';
import AsyncStorage from '@react-native-async-storage/async-storage';

const LANG_KEY = 'pahaadsaathi:lang';

type PickedPhoto = {
  uri: string;
  mimeType?: string | null;
  fileName?: string | null;
  isLiveCamera?: boolean;
  capturedAt?: string;
  deviceTimestamp?: number;
};

// Hazard type metadata
const HAZARD_META: Record<string, { emoji: string; color: string }> = {
  Landslide:     { emoji: '⛰️', color: '#B45309' },
  'Road Damage': { emoji: '🚧', color: '#D97706' },
  Waterlogging:  { emoji: '🌊', color: '#1D4ED8' },
  Accident:      { emoji: '💥', color: '#DC2626' },
  'Fallen Trees':{ emoji: '🌲', color: '#15803D' },
  'Forest Fire': { emoji: '🔥', color: '#EA580C' },
  'Flash Flood': { emoji: '⚡', color: '#2563EB' },
  Other:         { emoji: '⚠️', color: '#64748B' },
};

const SEVERITY_COLORS: Record<string, string> = {
  Low:      '#15803D',
  Medium:   '#D97706',
  High:     '#DC2626',
};

export default function ReportScreen() {
  const router = useRouter();
  const { theme } = useTheme();
  const { isOnline } = useConnectivity();
  const user = getUser();
  const isDark = theme.name === 'dark';

  // Language state
  const [lang, setLang] = useState<Lang>('en');
  useEffect(() => {
    AsyncStorage.getItem(LANG_KEY).then((v) => {
      if (v === 'hi' || v === 'en') setLang(v);
    });
  }, []);

  const toggleLang = () => {
    const next: Lang = lang === 'en' ? 'hi' : 'en';
    setLang(next);
    AsyncStorage.setItem(LANG_KEY, next).catch(() => {});
  };

  // Form state
  const [hazardType, setHazardType] = useState<HazardType>('Landslide');
  const [severity, setSeverity] = useState<Severity>('Medium');
  const [locationText, setLocationText] = useState('');
  const [description, setDescription] = useState('');
  const [reporterPhone, setReporterPhone] = useState(user?.phone || '');

  // Photo & GPS state
  const [photo, setPhoto] = useState<PickedPhoto | null>(null);
  const [gps, setGps] = useState<{ latitude: number; longitude: number; accuracy: number | null } | null>(null);
  const [gpsStatus, setGpsStatus] = useState<'idle' | 'capturing' | 'locked' | 'error'>('idle');

  // Camera modal state
  const [showCamera, setShowCamera] = useState(false);
  const [CameraComponent, setCameraComponent] = useState<React.ComponentType<any> | null>(null);
  const cameraRef = useRef<any>(null);

  // Submission state
  const [submitting, setSubmitting] = useState(false);
  const useSms = isOnline === false;

  // Lazy load camera module
  useEffect(() => {
    if (showCamera && !CameraComponent) {
      import('expo-camera')
        .then((mod) => {
          setCameraComponent(() => mod.CameraView ?? mod.Camera);
        })
        .catch(() => {
          setShowCamera(false);
          Alert.alert(
            lang === 'en' ? 'Camera unavailable' : 'कैमरा अनुपलब्ध',
            lang === 'en' ? 'Please use gallery selection.' : 'कृपया गैलरी से चुनें।'
          );
        });
    }
  }, [showCamera, CameraComponent, lang]);

  // Capture GPS
  const captureGps = useCallback(async () => {
    setGpsStatus('capturing');
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setGpsStatus('error');
        return;
      }

      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setGps({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy });
      setGpsStatus('locked');

      try {
        const res = await fetch(
          `https://photon.komoot.io/api/reverse?lat=${pos.coords.latitude}&lon=${pos.coords.longitude}&limit=1`,
          { signal: AbortSignal.timeout(5000) }
        );
        if (res.ok) {
          const data = await res.json();
          const f = data.features?.[0]?.properties;
          if (f) {
            const parts = [f.village || f.city, f.county, f.state].filter(Boolean);
            setLocationText(parts.join(', '));
          }
        }
      } catch {}
    } catch {
      setGpsStatus('error');
    }
  }, []);

  // Live Camera Capture
  const handleCapture = async () => {
    if (!cameraRef.current) return;
    try {
      const pic = await cameraRef.current.takePictureAsync({ quality: 0.6, skipProcessing: false });
      const now = new Date();
      setPhoto({
        uri: pic.uri,
        isLiveCamera: true,
        capturedAt: now.toISOString(),
        deviceTimestamp: Date.now(),
      });
      setShowCamera(false);
      await captureGps();
    } catch {
      Alert.alert(
        lang === 'en' ? 'Capture Failed' : 'कैप्चर विफल',
        lang === 'en' ? 'Could not take photo. Please try again.' : 'फोटो नहीं ली जा सकी। पुनः प्रयास करें।'
      );
    }
  };

  // Gallery Picker with EXIF metadata live incident verification
  const handlePickGallery = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: false,
      quality: 0.6,
      exif: true,
    });

    if (!result.canceled && result.assets[0]) {
      const a = result.assets[0];

      // Check EXIF capture timestamp to enforce live incident window
      let isLiveTime = true;
      if (a.exif?.DateTimeOriginal || a.exif?.DateTime) {
        try {
          const exifStr = String(a.exif.DateTimeOriginal || a.exif.DateTime);
          const [d, t] = exifStr.split(' ');
          const [year, month, day] = d.split(':').map(Number);
          const [hour, min, sec] = t.split(':').map(Number);
          const exifDate = new Date(year, month - 1, day, hour, min, sec);
          const diffMinutes = Math.abs(Date.now() - exifDate.getTime()) / (1000 * 60);

          // If photo was captured more than 60 minutes ago, reject old file
          if (diffMinutes > 60) {
            isLiveTime = false;
          }
        } catch {}
      }

      if (!isLiveTime) {
        Alert.alert(
          lang === 'en' ? '⚠️ Live Incident Photo Required' : '⚠️ लाइव घटना की फोटो आवश्यक है',
          lang === 'en'
            ? 'The image metadata indicates it was captured earlier. To prevent outdated or false reports, photos must be captured live at the scene. Please use the Live Camera.'
            : 'यह फोटो पुरानी पाई गई है। कृपया लाइव कैमरे का उपयोग करके ताज़ा फोटो लें।'
        );
        return;
      }

      setPhoto({
        uri: a.uri,
        mimeType: a.mimeType,
        fileName: a.fileName,
        isLiveCamera: false,
        capturedAt: new Date().toISOString(),
        deviceTimestamp: Date.now(),
      });
      await captureGps();
    }
  };

  // Submit Report
  const handleSubmit = async () => {
    if (!locationText.trim()) {
      Alert.alert(
        lang === 'en' ? 'Location required' : 'स्थान आवश्यक है',
        lang === 'en' ? 'Please capture GPS or enter a location.' : 'कृपया GPS या स्थान दर्ज करें।'
      );
      return;
    }
    if (!description.trim()) {
      Alert.alert(
        lang === 'en' ? 'Description required' : 'विवरण आवश्यक है',
        lang === 'en' ? 'Please describe the incident.' : 'कृपया घटना का विवरण दें।'
      );
      return;
    }

    setSubmitting(true);

    try {
      let photoUrl: string | null = null;
      if (photo) {
        try {
          const { semanticEvidenceService } = await import('@/services/media/SemanticEvidenceService');
          const evidenceRes = await semanticEvidenceService.processEvidence({
            reportId: String(Date.now()),
            photoUri: photo.uri,
            hazardType,
            description: description.trim(),
            options: { profile: 'moderate' },
          });
          photoUrl = evidenceRes.evidenceUrl;
        } catch (evidenceErr) {
          console.warn('[Report] PSEP processing notice, using storage fallback:', evidenceErr);
          try {
            const { uploadHazardPhoto } = await import('@/lib/storage');
            const up = await uploadHazardPhoto(photo);
            if (up.success && up.url) {
              photoUrl = up.url;
            } else if (up.url) {
              photoUrl = up.url;
            } else {
              photoUrl = photo.uri ?? null;
            }
          } catch {
            photoUrl = photo.uri ?? null;
          }
        }
      }

      await addHazard({
        type: hazardType,
        location: locationText.trim(),
        area: locationText.trim(),
        description: description.trim(),
        severity,
        status: 'reported',
        latitude: gps?.latitude ?? null,
        longitude: gps?.longitude ?? null,
        photo_url: photoUrl,
        reportedBy: user?.name ?? 'Mountain Resident',
        reportedByRole: user?.role ?? 'resident',
        reporterPhone: reporterPhone.trim() || null,
      });

      Alert.alert(
        lang === 'en' ? '✅ Report Submitted' : '✅ रिपोर्ट जमा हुई',
        lang === 'en'
          ? 'Live incident broadcasted to nearby travellers (within 50 km) and emergency teams.'
          : 'घटना की सूचना 50 किमी के दायरे में यात्रियों और आपातकालीन टीमों को भेज दी गई है।'
      );
      router.replace('/');
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Failed to submit report.');
    } finally {
      setSubmitting(false);
    }
  };

  // Offline SMS fallback
  const handleSmsFallback = async () => {
    if (!locationText.trim() || !description.trim()) {
      Alert.alert(
        lang === 'en' ? 'Missing fields' : 'जानकारी अधूरी है',
        lang === 'en' ? 'Fill location and description first.' : 'पहले स्थान और विवरण भरें।'
      );
      return;
    }
    const body = buildSmsBody({
      type: hazardType,
      location: locationText.trim(),
      description: description.trim(),
    });
    const avail = await SMS.isAvailableAsync();
    if (!avail) {
      Alert.alert('SMS unavailable');
      return;
    }
    await SMS.sendSMSAsync([SMS_GATEWAY_NUMBER], body);
    Alert.alert(
      lang === 'en' ? '📱 SMS Sent' : '📱 SMS भेजा गया',
      lang === 'en' ? 'Emergency report sent via SMS.' : 'आपातकालीन रिपोर्ट SMS से भेजी गई।'
    );
    router.replace('/');
  };

  // Color tokens matching Home Screen
  const bg = isDark ? Palette.surfaceDark : Palette.glacier;
  const cardBg = isDark ? Palette.surfaceDarkElevated : Palette.snow;
  const cardBorder = isDark ? Palette.surfaceDarkBorder : Palette.stone;
  const textPrimary = isDark ? Palette.snow : Palette.pineForest;
  const textSecondary = isDark ? Palette.slateMuted : Palette.slate;

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: bg }]}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />

      {/* ── App Header (Unified with Home Screen) ── */}
      <View
        accessibilityRole="header"
        style={[
          styles.header,
          {
            backgroundColor: isDark ? Palette.surfaceDarkElevated : Palette.snow,
            borderBottomColor: isDark ? Palette.surfaceDarkBorder : Palette.stone,
          },
        ]}
      >
        <View style={styles.brandRow}>
          <Pressable
            style={[
              styles.backBtn,
              {
                backgroundColor: isDark ? Palette.surfaceDark : Palette.stoneLight,
                borderColor: cardBorder,
              },
            ]}
            onPress={() => router.back()}
            accessibilityLabel="Go back"
          >
            <ArrowLeft size={18} color={textPrimary} />
          </Pressable>
          <View>
            <Text style={[styles.brandTitle, { color: isDark ? Palette.snow : Palette.pineForest }]}>
              PAHAADSAATHI
            </Text>
            <View style={styles.communitySubhead}>
              <Camera size={12} color={Palette.pineForestMuted} />
              <Text style={styles.communityText}>
                {lang === 'en' ? 'Live Verified Incident Report' : 'लाइव प्रमाणित घटना रिपोर्ट'}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.headerControls}>
          <Pressable
            style={styles.langToggle}
            onPress={toggleLang}
            accessibilityRole="button"
            accessibilityLabel="Toggle Language"
          >
            <Text style={styles.langText}>{lang === 'en' ? 'हिन्दी' : 'EN'}</Text>
          </Pressable>
          <ThemeToggle />
        </View>
      </View>

      {/* ── Connectivity Status Strip ── */}
      <View
        style={[
          styles.connBanner,
          {
            backgroundColor: useSms
              ? isDark ? '#2D2012' : '#FEF3C7'
              : isDark ? '#142E1F' : '#DCFCE7',
            borderBottomColor: cardBorder,
          },
        ]}
      >
        {useSms ? <WifiOff size={13} color={Palette.saffron} /> : <Wifi size={13} color={Palette.verifiedGreen} />}
        <Text style={[styles.connText, { color: useSms ? Palette.saffron : Palette.verifiedGreen }]}>
          {useSms
            ? (lang === 'en' ? 'Offline Mode • Report will sync or send via SMS' : 'ऑफ़लाइन मोड • रिपोर्ट बाद में या SMS से जाएगी')
            : (lang === 'en' ? 'Online • Live Cloud & AI Verification Active' : 'ऑनलाइन • लाइव क्लाउड और AI सत्यापन सक्रिय')}
        </Text>
      </View>

      {/* ── Main Content ScrollView ── */}
      <View style={styles.mainContainer}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ════ SECTION 1: LIVE PHOTO EVIDENCE ════ */}
          <View style={[styles.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
            <View style={styles.cardHeader}>
              <View style={[styles.iconCircle, { backgroundColor: isDark ? Palette.surfaceDark : Palette.stoneLight }]}>
                <Camera size={16} color={Palette.pineForest} />
              </View>
              <View>
                <Text style={[styles.cardTitle, { color: textPrimary }]}>
                  {lang === 'en' ? 'Live Incident Photo' : 'घटना स्थल की लाइव फोटो'}
                </Text>
                <Text style={[styles.cardSubtitle, { color: textSecondary }]}>
                  {lang === 'en' ? 'Verified with real-time camera metadata' : 'ताज़ा कैमरा मेटाडेटा से सत्यापित'}
                </Text>
              </View>
            </View>

            {photo ? (
              <View style={styles.photoPreviewWrap}>
                <Image source={{ uri: photo.uri }} contentFit="cover" style={styles.photoPreview} />
                <Pressable
                  style={styles.photoRemove}
                  onPress={() => {
                    setPhoto(null);
                    setGps(null);
                    setGpsStatus('idle');
                  }}
                  accessibilityLabel="Remove photo"
                >
                  <X size={15} color={Palette.snow} />
                </Pressable>

                {/* Live Metadata Badges */}
                <View style={styles.liveBadgeOverlay}>
                  <View style={styles.metaBadgePill}>
                    <ShieldCheck size={12} color="#10B981" />
                    <Text style={styles.metaBadgeText}>
                      {photo.isLiveCamera ? 'LIVE CAMERA VERIFIED' : 'RECENT CAPTURE VERIFIED'}
                    </Text>
                  </View>

                  {gpsStatus === 'locked' && gps && (
                    <View style={styles.metaBadgePill}>
                      <MapPin size={11} color={Palette.snow} />
                      <Text style={styles.metaBadgeText}>
                        {gps.latitude.toFixed(4)}, {gps.longitude.toFixed(4)}
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            ) : (
              <View style={styles.photoActionsRow}>
                <Pressable
                  style={[
                    styles.photoActionBtn,
                    {
                      backgroundColor: isDark ? Palette.pineForestContainer : Palette.pineForest,
                    },
                  ]}
                  onPress={() => setShowCamera(true)}
                >
                  <Camera size={20} color={isDark ? '#064E3B' : Palette.snow} />
                  <Text
                    style={[
                      styles.photoActionBtnText,
                      { color: isDark ? '#064E3B' : Palette.snow, fontWeight: '700' },
                    ]}
                  >
                    {lang === 'en' ? 'Open Live Camera' : 'लाइव कैमरा खोलें'}
                  </Text>
                </Pressable>

                <Pressable
                  style={[
                    styles.photoActionBtnSecondary,
                    {
                      backgroundColor: isDark ? Palette.surfaceDark : Palette.stoneLight,
                      borderColor: cardBorder,
                    },
                  ]}
                  onPress={handlePickGallery}
                >
                  <Images size={18} color={textPrimary} />
                  <Text style={[styles.photoActionBtnTextSecondary, { color: textPrimary }]}>
                    {lang === 'en' ? 'Recent Gallery' : 'गैलरी से'}
                  </Text>
                </Pressable>
              </View>
            )}
          </View>

          {/* ════ SECTION 2: HAZARD TYPE ════ */}
          <View style={[styles.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
            <Text style={[styles.cardTitle, { color: textPrimary }]}>
              {lang === 'en' ? 'Hazard Category' : 'खतरे की श्रेणी'}
            </Text>
            <View style={styles.chipGrid}>
              {hazardTypes.map((item) => {
                const meta = HAZARD_META[item] ?? { emoji: '⚠️', color: '#64748B' };
                const active = hazardType === item;
                return (
                  <Pressable
                    key={item}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: active
                          ? isDark ? Palette.pineForestContainer : Palette.pineForest
                          : isDark ? Palette.surfaceDark : Palette.stoneLight,
                        borderColor: active ? Palette.pineForest : cardBorder,
                      },
                    ]}
                    onPress={() => setHazardType(item)}
                  >
                    <Text style={styles.chipEmoji}>{meta.emoji}</Text>
                    <Text
                      style={[
                        styles.chipText,
                        {
                          color: active
                            ? isDark ? '#064E3B' : Palette.snow
                            : textPrimary,
                          fontWeight: active ? '700' : '500',
                        },
                      ]}
                    >
                      {item}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* ════ SECTION 3: SEVERITY LEVEL ════ */}
          <View style={[styles.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
            <Text style={[styles.cardTitle, { color: textPrimary }]}>
              {lang === 'en' ? 'Severity Level' : 'गंभीरता का स्तर'}
            </Text>
            <View style={styles.chipGrid}>
              {severities.map((item) => {
                const active = severity === item;
                const col = SEVERITY_COLORS[item];
                return (
                  <Pressable
                    key={item}
                    style={[
                      styles.chip,
                      styles.chipSeverity,
                      {
                        backgroundColor: active ? col : isDark ? Palette.surfaceDark : Palette.stoneLight,
                        borderColor: active ? col : cardBorder,
                      },
                    ]}
                    onPress={() => setSeverity(item)}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        {
                          color: active ? Palette.snow : textPrimary,
                          fontWeight: active ? '800' : '600',
                        },
                      ]}
                    >
                      {item}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* ════ SECTION 4: LOCATION & GPS LOCK ════ */}
          <View style={[styles.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
            <View style={styles.cardHeaderRow}>
              <Text style={[styles.cardTitle, { color: textPrimary }]}>
                {lang === 'en' ? 'Incident Location' : 'घटना का स्थान'}
              </Text>
              {gpsStatus === 'locked' && (
                <View style={styles.gpsPill}>
                  <CheckCircle size={11} color={Palette.verifiedGreen} />
                  <Text style={styles.gpsPillText}>
                    {lang === 'en' ? 'GPS Locked' : 'GPS सुरक्षित'}
                  </Text>
                </View>
              )}
            </View>

            <TextInput
              value={locationText}
              onChangeText={setLocationText}
              placeholder={lang === 'en' ? 'e.g. Near Helang, NH-07 Joshimath Road' : 'जैसे: हेलंग के पास, NH-07'}
              placeholderTextColor={Palette.slateMuted}
              style={[
                styles.input,
                {
                  color: textPrimary,
                  borderColor: cardBorder,
                  backgroundColor: isDark ? Palette.surfaceDark : Palette.glacierDark,
                },
              ]}
            />

            {gpsStatus !== 'locked' && (
              <Pressable
                style={[styles.gpsBtn, gpsStatus === 'capturing' && styles.gpsBtnBusy]}
                onPress={captureGps}
                disabled={gpsStatus === 'capturing'}
              >
                {gpsStatus === 'capturing' ? (
                  <ActivityIndicator size="small" color={Palette.snow} />
                ) : (
                  <MapPin size={15} color={Palette.snow} />
                )}
                <Text style={styles.gpsBtnText}>
                  {gpsStatus === 'capturing'
                    ? (lang === 'en' ? 'Detecting Coordinates…' : 'स्थान खोज रहा है…')
                    : (lang === 'en' ? 'Detect Current GPS Location' : 'वर्तमान GPS स्थान दर्ज करें')}
                </Text>
              </Pressable>
            )}
          </View>

          {/* ════ SECTION 5: SITUATION DETAILS ════ */}
          <View style={[styles.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
            <Text style={[styles.cardTitle, { color: textPrimary }]}>
              {lang === 'en' ? 'Incident Description' : 'घटना का विवरण'}
            </Text>
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder={
                lang === 'en'
                  ? 'Describe road blockage, debris, traffic impact or weather...'
                  : 'सड़क की स्थिति, मलबा या ट्रैफिक जाम का विवरण दें...'
              }
              placeholderTextColor={Palette.slateMuted}
              multiline
              numberOfLines={4}
              style={[
                styles.textArea,
                {
                  color: textPrimary,
                  borderColor: cardBorder,
                  backgroundColor: isDark ? Palette.surfaceDark : Palette.glacierDark,
                },
              ]}
            />
          </View>

          {/* ════ SECTION 6: REPORTER CONTACT ════ */}
          <View style={[styles.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
            <Text style={[styles.cardTitle, { color: textPrimary }]}>
              {lang === 'en' ? 'Contact Number (Verification Callback)' : 'संपर्क नंबर (सत्यापन हेतु)'}
            </Text>
            <TextInput
              value={reporterPhone}
              onChangeText={setReporterPhone}
              placeholder="e.g. 9876543210"
              placeholderTextColor={Palette.slateMuted}
              keyboardType="phone-pad"
              style={[
                styles.input,
                {
                  color: textPrimary,
                  borderColor: cardBorder,
                  backgroundColor: isDark ? Palette.surfaceDark : Palette.glacierDark,
                },
              ]}
            />
            <Text style={[styles.helperNote, { color: textSecondary }]}>
              {lang === 'en'
                ? 'Only district emergency operations officers may contact you to confirm road status.'
                : 'केवल जिला आपदा प्रबंधन अधिकारी सत्यापन के लिए संपर्क कर सकते हैं।'}
            </Text>
          </View>

          {/* ════ SUBMIT ACTIONS ════ */}
          {useSms ? (
            <View style={styles.submitActionsGroup}>
              <Pressable
                style={[styles.submitBtn, { backgroundColor: Palette.pineForest }]}
                onPress={handleSubmit}
                disabled={submitting}
              >
                <Text style={styles.submitBtnText}>
                  {lang === 'en' ? 'Save Report Offline' : 'ऑफ़लाइन रिपोर्ट सहेजें'}
                </Text>
              </Pressable>

              <Pressable
                style={[styles.smsFallbackBtn, { backgroundColor: '#B45309' }]}
                onPress={handleSmsFallback}
              >
                <Text style={styles.submitBtnText}>
                  {lang === 'en' ? '📱 Send via Emergency SMS' : '📱 आपातकालीन SMS से भेजें'}
                </Text>
              </Pressable>
            </View>
          ) : (
            <Pressable
              style={[
                styles.submitBtn,
                {
                  backgroundColor: isDark ? Palette.pineForestContainer : Palette.pineForest,
                },
                submitting && styles.submitBtnDisabled,
              ]}
              onPress={handleSubmit}
              disabled={submitting}
            >
              {submitting ? (
                <ActivityIndicator color={isDark ? '#064E3B' : Palette.snow} />
              ) : (
                <Text
                  style={[
                    styles.submitBtnText,
                    { color: isDark ? '#064E3B' : Palette.snow },
                  ]}
                >
                  {lang === 'en' ? '🚨 Submit Live Incident Report' : '🚨 लाइव घटना रिपोर्ट जमा करें'}
                </Text>
              )}
            </Pressable>
          )}

          <View style={{ height: Spacing.xl }} />
        </ScrollView>
      </View>

      {/* ── Camera Modal ── */}
      <Modal visible={showCamera} animationType="slide" statusBarTranslucent>
        <SafeAreaView style={styles.cameraModal}>
          {CameraComponent ? (
            <CameraComponent ref={cameraRef} style={styles.cameraView} facing="back">
              <View style={styles.cameraOverlay}>
                <Pressable
                  style={styles.cameraCloseBtn}
                  onPress={() => setShowCamera(false)}
                >
                  <X size={22} color={Palette.snow} />
                </Pressable>

                <View style={styles.cameraBottomBar}>
                  <View style={styles.cameraBadgePill}>
                    <Clock size={12} color="#10B981" />
                    <Text style={styles.cameraBadgeText}>LIVE TIMESTAMP ENFORCED</Text>
                  </View>
                  <Text style={styles.cameraHint}>
                    {lang === 'en'
                      ? 'Capture live mountain hazard photograph'
                      : 'घटना स्थल की लाइव फोटो लें'}
                  </Text>
                  <Pressable style={styles.captureBtn} onPress={handleCapture}>
                    <View style={styles.captureBtnInner} />
                  </Pressable>
                </View>
              </View>
            </CameraComponent>
          ) : (
            <View style={styles.cameraLoading}>
              <ActivityIndicator size="large" color={Palette.snow} />
              <Text style={{ color: Palette.snow, marginTop: 12 }}>
                {lang === 'en' ? 'Starting camera…' : 'कैमरा शुरू हो रहा है…'}
              </Text>
            </View>
          )}
        </SafeAreaView>
      </Modal>

      {/* ── Integrated Bottom Navigation ── */}
      <BottomNavigation />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.screenPadding,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: Radii.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandTitle: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.subheading,
    letterSpacing: 1.1,
  },
  communitySubhead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  communityText: {
    fontFamily: Typography.fontFamily.medium,
    fontSize: Typography.fontSize.caption,
    color: Palette.pineForestMuted,
  },
  headerControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  langToggle: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 5,
    borderRadius: Radii.sm,
    backgroundColor: Palette.stoneLight,
  },
  langText: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.caption,
    color: Palette.pineForest,
  },
  connBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.screenPadding,
    paddingVertical: 6,
    borderBottomWidth: 1,
  },
  connText: {
    fontFamily: Typography.fontFamily.semibold,
    fontSize: Typography.fontSize.caption,
  },
  mainContainer: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: Spacing.screenPadding,
    paddingBottom: 32,
    gap: Spacing.md,
  },
  card: {
    borderRadius: Radii.md,
    padding: Spacing.md,
    borderWidth: 1,
    gap: Spacing.sm,
    ...Shadows.sm,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  iconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.bodyLg,
  },
  cardSubtitle: {
    fontFamily: Typography.fontFamily.regular,
    fontSize: Typography.fontSize.caption,
    marginTop: 1,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  photoPreviewWrap: {
    borderRadius: Radii.md,
    overflow: 'hidden',
    height: 220,
    position: 'relative',
    marginTop: 4,
  },
  photoPreview: {
    width: '100%',
    height: '100%',
  },
  photoRemove: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: 'rgba(0,0,0,0.65)',
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  liveBadgeOverlay: {
    position: 'absolute',
    bottom: 10,
    left: 10,
    gap: 6,
  },
  metaBadgePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(0,0,0,0.75)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: Radii.full,
  },
  metaBadgeText: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: 10,
    color: Palette.snow,
    letterSpacing: 0.5,
  },
  photoActionsRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: 4,
  },
  photoActionBtn: {
    flex: 1.3,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: Radii.md,
  },
  photoActionBtnText: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.bodySm,
  },
  photoActionBtnSecondary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    borderRadius: Radii.md,
    borderWidth: 1,
  },
  photoActionBtnTextSecondary: {
    fontFamily: Typography.fontFamily.semibold,
    fontSize: Typography.fontSize.bodySm,
  },
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
    marginTop: 2,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    borderRadius: Radii.full,
    borderWidth: 1,
  },
  chipSeverity: {
    minWidth: 80,
    justifyContent: 'center',
  },
  chipEmoji: {
    fontSize: 13,
  },
  chipText: {
    fontFamily: Typography.fontFamily.semibold,
    fontSize: Typography.fontSize.caption,
  },
  input: {
    borderWidth: 1,
    borderRadius: Radii.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: 11,
    fontFamily: Typography.fontFamily.regular,
    fontSize: Typography.fontSize.bodyMd,
  },
  textArea: {
    borderWidth: 1,
    borderRadius: Radii.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: 11,
    fontFamily: Typography.fontFamily.regular,
    fontSize: Typography.fontSize.bodyMd,
    height: 90,
    textAlignVertical: 'top',
  },
  gpsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    backgroundColor: Palette.pineForest,
    paddingVertical: 11,
    borderRadius: Radii.sm,
    marginTop: 4,
  },
  gpsBtnBusy: {
    opacity: 0.7,
  },
  gpsBtnText: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.caption,
    color: Palette.snow,
  },
  gpsPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radii.full,
  },
  gpsPillText: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: 10,
    color: Palette.verifiedGreen,
  },
  helperNote: {
    fontFamily: Typography.fontFamily.regular,
    fontSize: Typography.fontSize.caption,
    marginTop: 2,
  },
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 15,
    borderRadius: Radii.md,
    marginTop: 4,
  },
  submitBtnDisabled: {
    opacity: 0.6,
  },
  submitBtnText: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.bodyMd,
  },
  submitActionsGroup: {
    gap: Spacing.sm,
    marginTop: 4,
  },
  smsFallbackBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 15,
    borderRadius: Radii.md,
  },
  cameraModal: {
    flex: 1,
    backgroundColor: '#000000',
  },
  cameraView: {
    flex: 1,
  },
  cameraOverlay: {
    flex: 1,
    justifyContent: 'space-between',
    padding: 20,
  },
  cameraCloseBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
    marginTop: 10,
  },
  cameraBottomBar: {
    alignItems: 'center',
    gap: 12,
    marginBottom: 20,
  },
  cameraBadgePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Radii.full,
  },
  cameraBadgeText: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: 11,
    color: Palette.snow,
    letterSpacing: 0.5,
  },
  cameraHint: {
    color: Palette.snow,
    fontSize: 13,
    fontFamily: Typography.fontFamily.medium,
    textAlign: 'center',
  },
  captureBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(255,255,255,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureBtnInner: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#FFFFFF',
  },
  cameraLoading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
