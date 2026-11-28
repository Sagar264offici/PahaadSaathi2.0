import { AppPressable as Pressable } from '@/components/ui/AppPressable';
import { AppText as Text } from '@/components/ui/AppText';
import { Link, usePathname } from 'expo-router';
import { StyleSheet, View, Platform } from 'react-native';
import { Globe, Users, MapPin, ShieldAlert, UserRound } from 'lucide-react-native';
import { Palette, Radii } from '@/theme/tokens';
import { useTheme } from '@/hooks/useTheme';
import { useDesktopNavigation } from './AppNavigation';

const items = [
  { label: 'Feed', href: '/', icon: Globe },
  { label: 'Radar', href: '/map', icon: MapPin },
  { label: 'SOS', href: '/emergency', icon: ShieldAlert, isAction: true },
  { label: 'Community', href: '/community', icon: Users },
  { label: 'Profile', href: '/account', icon: UserRound },
] as const;

export function BottomNavigation() {
  const pathname = usePathname();
  const { isDark } = useTheme();
  const desktop = useDesktopNavigation();
  if (desktop) return null;

  const dockBg = isDark ? 'rgba(15, 23, 42, 0.94)' : 'rgba(255, 255, 255, 0.95)';
  const dockBorder = isDark ? 'rgba(51, 65, 85, 0.75)' : 'rgba(226, 232, 240, 0.85)';

  return (
    <View style={styles.dockWrapper} pointerEvents="box-none">
      <View
        style={[
          styles.dockBar,
          {
            backgroundColor: dockBg,
            borderColor: dockBorder,
          },
        ]}
        aria-label="Main navigation"
      >
        {items.map((item) => {
          const { label, href, icon: Icon } = item;
          const isAction = 'isAction' in item && item.isAction;
          const active = pathname === href;
          const activeColor = isDark ? '#60A5FA' : Palette.cobalt;
          const inactiveColor = isDark ? '#94A3B8' : '#64748B';

          if (isAction) {
            return (
              <Link href={href} key={href} asChild>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Emergency SOS Beacon"
                  style={styles.actionBtnWrapper}
                >
                  <View style={styles.actionFab}>
                    <Icon size={22} color={Palette.white} strokeWidth={2.4} />
                  </View>
                  <Text style={styles.actionLabel}>SOS</Text>
                </Pressable>
              </Link>
            );
          }

          const color = active ? activeColor : inactiveColor;

          return (
            <Link href={href} key={href} asChild>
              <Pressable
                accessibilityRole="link"
                accessibilityLabel={label}
                aria-current={active ? 'page' : undefined}
                style={styles.item}
              >
                <View style={[styles.iconWrap, active && (isDark ? styles.iconWrapActiveDark : styles.iconWrapActiveLight)]}>
                  <Icon size={19} color={color} strokeWidth={active ? 2.3 : 1.8} />
                </View>
                <Text style={[styles.label, { color, fontWeight: active ? '700' : '500' }]}>
                  {label}
                </Text>
                {active && <View style={[styles.activeDot, { backgroundColor: activeColor }]} />}
              </Pressable>
            </Link>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dockWrapper: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: Platform.OS === 'ios' ? 24 : 14,
  },
  dockBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    maxWidth: 440,
    height: 64,
    borderRadius: Radii.dock,
    borderWidth: 1,
    paddingHorizontal: 10,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.12,
        shadowRadius: 20,
      },
      android: {
        elevation: 10,
      },
      web: {
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        boxShadow: '0 12px 32px rgba(15, 23, 42, 0.12)',
      } as any,
    }),
  },
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
    gap: 2,
    position: 'relative',
  },
  iconWrap: {
    width: 34,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapActiveLight: {
    backgroundColor: '#EFF6FF',
  },
  iconWrapActiveDark: {
    backgroundColor: 'rgba(37, 99, 235, 0.2)',
  },
  label: {
    fontSize: 10,
    letterSpacing: -0.2,
  },
  activeDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    marginTop: 1,
  },
  actionBtnWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
    marginTop: -12,
  },
  actionFab: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: Palette.rescueRed,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: Palette.white,
    ...Platform.select({
      ios: {
        shadowColor: Palette.rescueRed,
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.4,
        shadowRadius: 10,
      },
      android: {
        elevation: 8,
      },
      web: {
        boxShadow: '0 8px 20px rgba(180, 35, 45, 0.4)',
      } as any,
    }),
  },
  actionLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: Palette.rescueRed,
    marginTop: 2,
  },
});
