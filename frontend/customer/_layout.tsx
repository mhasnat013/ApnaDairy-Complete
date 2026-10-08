// ApnaDairy — customer app tab layout.
// 6-tab bottom nav (Instagram-style): Home, Marketplace, Cart, Orders,
// Rider, Profile. Icons are drawn with plain Views (no emoji, no assets).
import React from 'react';
import { Tabs } from 'expo-router';
import { View, StyleSheet } from 'react-native';
import { colors } from '../../src/theme/colors';

const ICON = 22;

// Small geometric tab icons drawn with Views.
function HomeIcon({ active }: { active: boolean }): React.JSX.Element {
  const c = active ? colors.forest : colors.sage;
  return (
    <View style={styles.iconBox}>
      <View style={[styles.homeRoof, { borderBottomColor: c }]} />
      <View style={[styles.homeBody, { borderColor: c }]} />
    </View>
  );
}

function MarketIcon({ active }: { active: boolean }): React.JSX.Element {
  const c = active ? colors.forest : colors.sage;
  return (
    <View style={[styles.iconBox, styles.grid2x2]}>
      {[0, 1, 2, 3].map((i) => (
        <View key={i} style={[styles.gridCell, { backgroundColor: c }]} />
      ))}
    </View>
  );
}

function CartIcon({ active }: { active: boolean }): React.JSX.Element {
  const c = active ? colors.forest : colors.sage;
  return (
    <View style={styles.iconBox}>
      <View style={[styles.cartBasket, { borderColor: c }]} />
      <View style={styles.cartWheels}>
        <View style={[styles.cartWheel, { backgroundColor: c }]} />
        <View style={[styles.cartWheel, { backgroundColor: c }]} />
      </View>
    </View>
  );
}

function OrdersIcon({ active }: { active: boolean }): React.JSX.Element {
  const c = active ? colors.forest : colors.sage;
  return (
    <View style={styles.iconBox}>
      {[0, 1, 2].map((i) => (
        <View key={i} style={[styles.orderLine, { backgroundColor: c }, i === 2 && styles.orderLineShort]} />
      ))}
    </View>
  );
}

function RiderIcon({ active }: { active: boolean }): React.JSX.Element {
  const c = active ? colors.forest : colors.sage;
  return (
    <View style={styles.iconBox}>
      <View style={[styles.riderPin, { borderColor: c }]}>
        <View style={[styles.riderDot, { backgroundColor: c }]} />
      </View>
    </View>
  );
}

function ProfileIcon({ active }: { active: boolean }): React.JSX.Element {
  const c = active ? colors.forest : colors.sage;
  return (
    <View style={styles.iconBox}>
      <View style={[styles.profileHead, { backgroundColor: c }]} />
      <View style={[styles.profileBody, { backgroundColor: c }]} />
    </View>
  );
}

const TABS: Array<{
  name: string;
  title: string;
  Icon: (p: { active: boolean }) => React.JSX.Element;
}> = [
  { name: 'home/index', title: 'Home', Icon: HomeIcon },
  { name: 'marketplace/index', title: 'Bazaar', Icon: MarketIcon },
  { name: 'cart/index', title: 'Cart', Icon: CartIcon },
  { name: 'orders/index', title: 'Orders', Icon: OrdersIcon },
  { name: 'rider/index', title: 'Rider', Icon: RiderIcon },
  { name: 'profile/index', title: 'Profile', Icon: ProfileIcon },
];

export default function CustomerLayout(): React.JSX.Element {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.forest,
        tabBarInactiveTintColor: colors.sage,
        tabBarStyle: {
          backgroundColor: colors.ivory,
          borderTopColor: colors.line,
          borderTopWidth: 1,
          height: 68,
          paddingBottom: 10,
          paddingTop: 6,
        },
        tabBarLabelStyle: {
          fontFamily: 'BricolageGrotesque_600SemiBold',
          fontSize: 11 },
      }}
    >
      {TABS.map(({ name, title, Icon }) => (
        <Tabs.Screen
          key={name}
          name={name}
          options={{
            title,
            tabBarIcon: ({ focused }) => <Icon active={focused} />,
          }}
        />
      ))}
      {/* Detail screens hide the tab bar */}
      <Tabs.Screen
        name="marketplace/[id]"
        options={{ href: null, tabBarStyle: { display: 'none' } }}
      />
      <Tabs.Screen name="index" options={{ href: null }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  iconBox: { width: ICON, height: ICON, alignItems: 'center', justifyContent: 'center' },
  homeRoof: {
    width: 0, height: 0,
    borderLeftWidth: 11, borderRightWidth: 11, borderBottomWidth: 9,
    borderLeftColor: 'transparent', borderRightColor: 'transparent',
    marginBottom: -2,
  },
  homeBody: { width: 16, height: 11, borderWidth: 2.5, borderTopWidth: 0 },
  grid2x2: { flexDirection: 'row', flexWrap: 'wrap', width: 20, height: 20 },
  gridCell: { width: 8, height: 8, margin: 1, borderRadius: 2 },
  cartBasket: { width: 18, height: 11, borderWidth: 2.5, borderTopWidth: 2.5, borderRadius: 2 },
  cartWheels: { flexDirection: 'row', marginTop: 2, width: 18, justifyContent: 'space-around' },
  cartWheel: { width: 4, height: 4, borderRadius: 2 },
  orderLine: { width: 18, height: 3, borderRadius: 2, marginVertical: 2 },
  orderLineShort: { width: 12, alignSelf: 'flex-start', marginLeft: 2 },
  riderPin: {
    width: 14, height: 14, borderRadius: 7, borderWidth: 2.5,
    alignItems: 'center', justifyContent: 'center',
  },
  riderDot: { width: 4, height: 4, borderRadius: 2 },
  profileHead: { width: 9, height: 9, borderRadius: 5, marginBottom: 2 },
  profileBody: { width: 18, height: 9, borderTopLeftRadius: 9, borderTopRightRadius: 9 },
});
