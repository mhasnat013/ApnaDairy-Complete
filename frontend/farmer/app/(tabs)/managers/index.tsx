// Managers — the farmer links with exactly ONE area manager (v2 flow).
// Pick a city -> browse that city's area managers -> send a registration
// request to ONE manager -> the manager accepts -> the farmer then sells
// daily ONLY to that manager. The backend enforces one manager per farmer.
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Screen } from '../../../src/components/common/Screen';
import { getFarmerStats } from '../../../src/services/dashboardService';
import { Card } from '../../../src/components/common/Card';
import { AppButton } from '../../../src/components/common/AppButton';
import { StatusBadge } from '../../../src/components/common/StatusBadge';
import { EmptyState } from '../../../src/components/common/EmptyState';
import { colors } from '../../../src/theme/colors';
import { font } from '../../../src/theme/theme';
import {
  cancelManagerRequest,
  getCities,
  getManagerRequest,
  getManagersByCity,
  requestManager,
  type AreaManager,
  type ManagerRequest,
} from '../../../src/services/linkingService';

type Phase = 'loading' | 'linked' | 'pending' | 'pick';

/** First and last name initials, e.g. "Ali Raza" -> "AR". */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.charAt(0) ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1].charAt(0) : '';
  return (first + last).toUpperCase();
}

/** Managers tab screen. */
export default function ManagersScreen() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [request, setRequest] = useState<ManagerRequest | null>(null);
  const [cities, setCities] = useState<string[]>([]);
  const [city, setCity] = useState<string | null>(null);
  const [managers, setManagers] = useState<AreaManager[]>([]);
  const [loadingCities, setLoadingCities] = useState(false);
  const [loadingManagers, setLoadingManagers] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // When the farmer is already linked (accepted) but opens the full manager
  // list on purpose ("View all managers"), show the pick journey as an
  // overlay on top of the linked view. Does not change the actual phase.
  const [browsing, setBrowsing] = useState(false);

  // Load the farmer's registration request and decide which phase to show.
  // getManagerRequest() and getCities() are independent, so they load in
  // parallel instead of one after another. getFarmerStats() stays a
  // conditional fallback (only fetched when no request row exists).
  const load = useCallback(async (isRefresh = false) => {
    try {
      if (isRefresh) setRefreshing(true);
      setError(null);
      setNotice(null);
      setBrowsing(false);
      setLoadingCities(true);
      const [req, cityList] = await Promise.all([getManagerRequest(), getCities()]);
      setRequest(req);
      setCities(cityList);
      if (req && req.status === 'accepted') {
        setPhase('linked');
      } else if (req && req.status === 'pending') {
        setPhase('pending');
      } else if (!req || req.status !== 'declined') {
        // No request row at all: the farmer may still be registered with a
        // manager through the profile (area_manager_id fallback used by the
        // home dashboard). Show the "Your manager" card in that case.
        const stats = await getFarmerStats();
        const reg = stats.registered_manager;
        if (reg) {
          setRequest({
            id: 'profile-linked',
            status: 'accepted',
            note: null,
            reason: null,
            created_at: null,
            answered_at: null,
            manager: { id: reg.id, center_name: reg.center_name, city: null },
          });
          setPhase('linked');
          return;
        }
        setPhase('pick');
      } else {
        // The last request was declined: pick a city.
        setNotice('Your last request was declined. You can send a request to another manager.');
        setPhase('pick');
      }
    } catch {
      setError('Could not load your manager details. Pull down to try again.');
    } finally {
      setLoadingCities(false);
      setRefreshing(false);
      setPhase((p) => (p === 'loading' ? 'pick' : p));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Open the city -> manager journey from the linked view. Cities are only
  // fetched in the 'pick' phase, so load them here too.
  const startBrowsing = useCallback(async () => {
    setBrowsing(true);
    setCity(null);
    setManagers([]);
    setError(null);
    setLoadingCities(true);
    try {
      setCities(await getCities());
    } catch {
      setError('Could not load the cities. Please try again.');
    } finally {
      setLoadingCities(false);
    }
  }, []);

  // Load the area managers for the chosen city.
  const pickCity = useCallback(async (c: string) => {
    setCity(c);
    setError(null);
    setLoadingManagers(true);
    try {
      setManagers(await getManagersByCity(c));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The managers could not be loaded.');
      setManagers([]);
    } finally {
      setLoadingManagers(false);
    }
  }, []);

  // Send a registration request to ONE manager.
  const sendRequest = async (m: AreaManager) => {
    setSendingId(m.id);
    setError(null);
    try {
      const req = await requestManager(m.id);
      setRequest(req);
      setBrowsing(false);
      setPhase('pending');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The request could not be sent. Please try again.');
    } finally {
      setSendingId(null);
    }
  };

  // Cancel the pending request so the farmer can pick another manager.
  const cancelRequest = async () => {
    setBusy(true);
    setError(null);
    try {
      await cancelManagerRequest();
      setRequest(null);
      setCity(null);
      setManagers([]);
      setPhase('pick');
      setLoadingCities(true);
      setCities(await getCities());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The request could not be cancelled. Please try again.');
    } finally {
      setBusy(false);
      setLoadingCities(false);
    }
  };

  // --- Linked view: the farmer is registered under one manager. ---
  const renderLinked = (req: ManagerRequest) => (
    <ScrollView
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} colors={[colors.forest]} />}
    >
      <Card>
        <View style={styles.rowBetween}>
          <Text style={styles.cardTitle}>Your manager</Text>
          <StatusBadge status="ACCEPTED" label="Registered" />
        </View>
        <Text style={styles.bigName}>{req.manager?.center_name ?? 'Area manager'}</Text>
        {req.manager?.city ? <Text style={styles.sub}>{req.manager.city}</Text> : null}
        <View style={styles.gap} />
        <Pressable onPress={startBrowsing} hitSlop={8}>
          <Text style={styles.linkText}>View all managers</Text>
        </Pressable>
      </Card>
      <Card style={styles.noteCard}>
        <Text style={styles.noteText}>
          You sell your milk only to this manager. To change managers, please contact the SuperAdmin.
        </Text>
      </Card>
      {browsing ? renderPick(true) : null}
      <View style={styles.spacer} />
    </ScrollView>
  );

  // --- Pending view: waiting for the manager to accept. ---
  // The farmer NEVER accepts or rejects here — the decision is the
  // manager's own, made on the manager's web dashboard. This screen only
  // waits, refreshes, or lets the farmer withdraw (cancel) his own request.
  const renderPending = (req: ManagerRequest) => (
    <ScrollView
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} colors={[colors.forest]} />}
    >
      <Card>
        <View style={styles.rowBetween}>
          <Text style={styles.cardTitle}>Request pending</Text>
          <StatusBadge status="PENDING" label="Pending" />
        </View>
        <Text style={styles.bigName}>{req.manager?.center_name ?? 'Area manager'}</Text>
        {req.manager?.city ? <Text style={styles.sub}>{req.manager.city}</Text> : null}
        <View style={styles.gap} />
        <Text style={styles.noteText}>
          Waiting for the manager's decision. The manager will answer on their own screen — you cannot accept or reject anything here.
        </Text>
        <View style={styles.gap} />
        <AppButton label="Refresh status" variant="outline" onPress={() => load(true)} loading={refreshing} />
        <View style={styles.gap} />
        <Pressable onPress={cancelRequest} hitSlop={8} disabled={busy}>
          <Text style={styles.linkText}>{busy ? 'Cancelling…' : 'Withdraw this request'}</Text>
        </Pressable>
      </Card>
      <View style={styles.spacer} />
    </ScrollView>
  );

  // --- Pick view: choose a city, then send ONE request. ---
  // When `nested` is true (linked farmer tapped "View all managers"), the
  // journey renders inline inside the linked ScrollView with a back link.
  const renderPick = (nested = false) => {
    const content = (
      <View style={styles.pickInner}>
        {notice ? (
          <Card style={styles.noteCard}>
            <Text style={styles.noteText}>{notice}</Text>
          </Card>
        ) : null}
        {!nested ? (
          <>
            <Text style={styles.heroTitle}>Choose your manager</Text>
            <Text style={styles.heroSub}>Pick your city, then send a request to one area manager.</Text>
          </>
        ) : (
          <Pressable onPress={() => { setBrowsing(false); setCity(null); setManagers([]); }} hitSlop={8}>
            <Text style={styles.linkText}>Back to your manager</Text>
          </Pressable>
        )}
        <Text style={styles.sectionTitle}>1. Choose your city</Text>
        {loadingCities ? (
          <ActivityIndicator size="large" color={colors.forest} />
        ) : cities.length === 0 ? (
          <EmptyState title="No cities available" message="Please check back later." />
        ) : (
          <View style={styles.cityList}>
            {cities.map((c) => (
              <AppButton
                key={c}
                label={c}
                variant={city === c ? 'primary' : 'outline'}
                onPress={() => pickCity(c)}
              />
            ))}
          </View>
        )}

        {city ? (
          <>
            <Text style={styles.sectionTitle}>2. Send a request to one manager</Text>
            {loadingManagers ? (
              <ActivityIndicator size="large" color={colors.forest} />
            ) : managers.length === 0 ? (
              <EmptyState
                title={`No managers in ${city}`}
                message="Try another city."
              />
            ) : (
              managers.map((m) => (
                <Card key={m.id} style={styles.managerCard}>
                  <View style={styles.managerTop}>
                    <View style={styles.avatar}>
                      <Text style={styles.avatarText}>{initials(m.manager_name)}</Text>
                    </View>
                    <View style={styles.managerInfo}>
                      <Text style={styles.managerName}>{m.manager_name}</Text>
                      <Text style={styles.sub}>{m.center_name}</Text>
                    </View>
                  </View>
                  {m.address ? <Text style={styles.sub}>{m.address}</Text> : null}
                  {m.phone ? <Text style={styles.sub}>{m.phone}</Text> : null}
                  <View style={styles.gap} />
                  <AppButton
                    label="Send request"
                    onPress={() => sendRequest(m)}
                    loading={sendingId === m.id}
                    disabled={sendingId !== null}
                  />
                </Card>
              ))
            )}
          </>
        ) : null}
      </View>
    );
    if (nested) return content;
    return (
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} colors={[colors.forest]} />}
        contentContainerStyle={styles.list}
      >
        {content}
        <View style={styles.spacer} />
      </ScrollView>
    );
  };

  return (
    <Screen title="My Manager" subtitle="Register with one area manager">
      {phase === 'loading' ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.forest} />
        </View>
      ) : (
        <>
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          {phase === 'linked' && request ? renderLinked(request) : null}
          {phase === 'pending' && request ? renderPending(request) : null}
          {phase === 'pick' ? renderPick() : null}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { paddingBottom: 32 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  cardTitle: { fontSize: font.body, color: colors.ink, fontFamily: font.bold },
  bigName: { fontSize: font.h2, color: colors.ink, fontFamily: font.bold, marginTop: 4 },
  sub: { fontSize: font.small, color: colors.sage, fontFamily: font.regular, marginTop: 4 },
  sectionTitle: { fontSize: font.h3, color: colors.ink, fontFamily: font.bold, marginTop: 16, marginBottom: 12 },
  cityList: { gap: 12 },
  heroTitle: { fontSize: font.h1, color: colors.ink, fontFamily: font.extrabold, marginTop: 8 },
  heroSub: { fontSize: font.body, color: colors.sage, fontFamily: font.regular, marginTop: 6 },
  linkText: { fontSize: font.body, color: colors.forest, fontFamily: font.bold, textDecorationLine: 'underline' },
  pickInner: { gap: 0 },
  managerCard: { marginBottom: 12 },
  managerTop: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatar: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: colors.forest, alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { color: colors.ivory, fontSize: 22, fontFamily: font.extrabold },
  managerInfo: { flex: 1 },
  managerName: { fontSize: 19, color: colors.ink, fontFamily: font.bold },
  gap: { height: 12 },
  errorText: { fontSize: font.small, color: colors.danger, textAlign: 'center', marginBottom: 8, fontFamily: font.regular },
  noteCard: { backgroundColor: colors.amberTint, marginTop: 12 },
  noteText: { fontSize: font.small, color: colors.ink, lineHeight: 22, fontFamily: font.regular },
  spacer: { height: 24 },
});
