// Milk tab home: "My milk sales" list (sales/collections from the
// manager-driven daily flow) + "My offers" list (offers awaiting the farmer's
// decision). Tap a sale -> /milk/request-detail, tap an offer -> /milk/offer-detail.
// The offer row is a big one-tap target that opens the accept/refuse screen.
// Note: the daily sale is started by the area manager (v2 spec) — there is no
// farmer-initiated "new request" action in this build.
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { shouldRefetch } from '../../../src/utils/focusCache';
import { Screen } from '../../../src/components/common/Screen';
import { Card } from '../../../src/components/common/Card';
import { AppButton } from '../../../src/components/common/AppButton';
import { StatusBadge } from '../../../src/components/common/StatusBadge';
import { EmptyState } from '../../../src/components/common/EmptyState';
import { ErrorRetry } from '../../../src/components/common/ErrorRetry';
import { colors } from '../../../src/theme/colors';
import { font } from '../../../src/theme/theme';
import type { MilkRequest } from '../../../src/types/farmerModels';
import * as milkService from '../../../src/services/milkService';
import { listSales, type SaleRecord } from '../../../src/services/salesService';

/** Formats an ISO date string into a short readable date. */
function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-PK', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** Formats a number as "Rs 3,700". */
function formatRs(n: number): string {
  return 'Rs ' + n.toLocaleString('en-PK', { maximumFractionDigits: 1 });
}

/** Display label for each milk request status. */
function requestStatusLabel(s: MilkRequest['status']): string {
  const map: Record<MilkRequest['status'], string> = {
    SENT: 'Sent', VIEWED: 'Viewed', TESTING: 'Testing',
    OFFERED: 'Offer received', CLOSED: 'Closed',
  };
  return map[s];
}

/** Milk tab home screen. */
export default function MilkTab() {
  const router = useRouter();
  const [requests, setRequests] = useState<MilkRequest[]>([]);
  const [offers, setOffers] = useState<SaleRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Loads the farmer's milk requests and the offers awaiting a decision.
  const load = useCallback(async () => {
    try {
      setError(null);
      const [reqs, sales] = await Promise.all([milkService.getRequests(), listSales()]);
      setRequests(reqs);
      // The tab preview shows only offers waiting for the farmer's decision.
      setOffers(sales.filter((s: SaleRecord) => s.status === 'offered'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Data could not be loaded. Please try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Reload when the tab gains focus (skipped if fetched <30s ago).
  useFocusEffect(useCallback(() => { if (shouldRefetch('milk')) load(); }, [load]));

  /** Pull-to-refresh handler (always reloads). */
  const onRefresh = () => {
    shouldRefetch('milk', true);
    setRefreshing(true);
    load();
  };

  if (loading) {
    return (
      <Screen title="Milk" subtitle="Sell your milk">
        <View style={styles.center}><ActivityIndicator size="large" color={colors.forest} /></View>
      </Screen>
    );
  }

  return (
    <Screen title="Milk" subtitle="Sell your milk">
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.forest]} />}
      >
        {error ? (
          <ErrorRetry message={error} onRetry={load} />
        ) : (
          <>
            <Text style={styles.sectionTitle}>My milk sales</Text>
            {requests.length === 0 ? (
              <EmptyState
                title="No milk sales yet"
                message="Take your milk to your manager — they will test it and send you an offer here."
              />
            ) : (
              requests.map((r) => (
                <Pressable key={r.id} onPress={() => router.push(`/milk/request-detail?id=${r.id}`)}>
                  <Card>
                    <View style={styles.rowTop}>
                      <Text style={styles.litres}>{r.litres} L</Text>
                      <StatusBadge status={r.status} label={requestStatusLabel(r.status)} />
                    </View>
                    <Text style={styles.sub}>{r.managerName} · {formatDate(r.createdAt)}</Text>
                    <Text style={styles.hint}>Tap to view details</Text>
                  </Card>
                </Pressable>
              ))
            )}

            <Text style={styles.sectionTitle}>My offers</Text>
            {offers.length === 0 ? (
              <EmptyState
                title="No offers waiting"
                message="New price offers from your manager will appear here."
              />
            ) : (
              offers.map((o) => (
                <Pressable key={o.id} onPress={() => router.push(`/milk/offer-detail?id=${o.id}`)}>
                  <Card>
                    <View style={styles.rowTop}>
                      <Text style={styles.litres}>
                        {o.quantity_l} L · {o.price_per_l != null ? `${formatRs(o.price_per_l)}/L` : 'Price pending'}
                      </Text>
                      <StatusBadge status="OFFERED" label="Awaiting decision" />
                    </View>
                    <Text style={styles.sub}>
                      {o.manager_name ?? 'Your manager'}
                      {o.freshness_score != null ? ` · AI score ${Math.round(o.freshness_score)}` : ''}
                    </Text>
                    {o.total_amount != null ? (
                      <Text style={styles.total}>Total: {formatRs(o.total_amount)}</Text>
                    ) : null}
                    <Text style={styles.hint}>Tap to accept or refuse</Text>
                  </Card>
                </Pressable>
              ))
            )}
            <View style={styles.allOffers}>
              <AppButton label="View all offers" variant="outline" onPress={() => router.push('/milk/offers')} />
            </View>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { paddingBottom: 32, gap: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  sectionTitle: { fontSize: font.h3, color: colors.ink, fontFamily: font.bold, marginTop: 16 },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  litres: { fontSize: 24, color: colors.ink, fontFamily: font.extrabold, flexShrink: 1 },
  sub: { fontSize: font.small, color: colors.sage, fontFamily: font.regular, marginTop: 6 },
  total: { fontSize: font.h3, color: colors.forest, fontFamily: font.extrabold, marginTop: 8 },
  hint: { fontSize: font.tiny, color: colors.sage, fontFamily: font.semibold, marginTop: 10 },
  allOffers: { marginTop: 8 },
});
