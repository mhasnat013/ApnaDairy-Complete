// Sale screen — the farmer's daily-sale screen and most important page.
// Shows the current incoming offer from the manager: the milk quantity,
// the AI freshness score, and the AI price per litre. Two huge buttons:
// Accept and Refuse. The manager runs the IoT test; the farmer only
// sees the result and taps once.
// Real data via salesService (GET /api/v1/farmer/sales for the pending
// 'offered' sale, then POST .../accept or .../refuse).

import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { shouldRefetch } from '../../src/utils/focusCache';
import { Screen } from '../../src/components/common/Screen';
import { Card } from '../../src/components/common/Card';
import { ErrorRetry } from '../../src/components/common/ErrorRetry';
import { EmptyState } from '../../src/components/common/EmptyState';
import { colors } from '../../src/theme/colors';
import {
  AcceptSaleResult,
  CurrentOffer,
  acceptOffer,
  getCurrentOffer,
  refuseOffer,
} from '../../src/services/salesService';

// Formats a number with thousands separators for Rs values.
function formatRs(value: number): string {
  return value.toLocaleString('en-PK');
}

// One big number row inside the offer card.
function OfferRow({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

// Sale tab screen.
export default function FarmerSaleScreen(): React.JSX.Element {
  const [offer, setOffer] = useState<CurrentOffer | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<AcceptSaleResult | null>(null);
  const [refused, setRefused] = useState<boolean>(false);

  // Loads the current incoming offer from the manager.
  const load = useCallback(async () => {
    try {
      setError(null);
      setAccepted(null);
      setRefused(false);
      setActionError(null);
      setOffer(await getCurrentOffer());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The offer could not be loaded. Please try again.');
    }
  }, []);

  // Loads on focus — the manager may send a new offer at any time.
  // Skipped if fetched <30s ago; pull-to-refresh always reloads.
  useFocusEffect(useCallback(() => {
    if (shouldRefetch('sales')) load().finally(() => setLoading(false));
  }, [load]));

  // Pull-to-refresh handler (always reloads).
  const onRefresh = useCallback(async () => {
    shouldRefetch('sales', true);
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  // Accepts the offer: the sale completes and a receipt is created.
  const onAccept = useCallback(async () => {
    if (!offer || deciding) return;
    try {
      setActionError(null);
      setDeciding(true);
      setAccepted(await acceptOffer(offer.sale_id));
      setOffer(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'The sale could not be accepted. Please try again.');
    } finally {
      setDeciding(false);
    }
  }, [offer, deciding]);

  // Refuses the offer: the manager is informed.
  const onRefuse = useCallback(async () => {
    if (!offer || deciding) return;
    try {
      setActionError(null);
      setDeciding(true);
      await refuseOffer(offer.sale_id);
      setRefused(true);
      setOffer(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'The offer could not be refused. Please try again.');
    } finally {
      setDeciding(false);
    }
  }, [offer, deciding]);

  if (loading) {
    return (
      <Screen title="Today's sale">
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.forest} />
        </View>
      </Screen>
    );
  }

  if (error) {
    return (
      <Screen title="Today's sale">
        <ErrorRetry
          message={error}
          onRetry={() => {
            setLoading(true);
            load().finally(() => setLoading(false));
          }}
        />
      </Screen>
    );
  }

  return (
    <Screen title="Today's sale">
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.forest} />
        }
      >
        {/* Accepted confirmation */}
        {accepted && (
          <Card style={styles.resultCard}>
            <Text style={styles.resultTitle}>Sale completed</Text>
            <Text style={styles.resultAmount}>Rs {formatRs(accepted.total_amount)}</Text>
            <Text style={styles.resultSub}>Receipt {accepted.receipt_no}</Text>
            <Text style={styles.resultHint}>
              The amount will appear in your payments.
            </Text>
          </Card>
        )}

        {/* Refused confirmation */}
        {refused && (
          <Card style={styles.resultCard}>
            <Text style={styles.resultTitle}>Offer refused</Text>
            <Text style={styles.resultHint}>
              The manager has been informed. You can talk to your manager about the price.
            </Text>
          </Card>
        )}

        {/* No pending offer */}
        {!offer && !accepted && !refused && (
          <EmptyState
            title="No offer right now"
            message="When your manager tests your milk and sends an offer, it will appear here."
          />
        )}

        {/* Current incoming offer */}
        {offer && (
          <>
            <Text style={styles.offerHeading}>Your manager's offer</Text>
            <Card style={styles.offerCard}>
              <OfferRow label="Milk" value={`${offer.quantity_l} L`} />
              <View style={styles.divider} />
              <OfferRow label="AI freshness score" value={`${offer.freshness_score} / 100`} />
              <View style={styles.divider} />
              <View style={styles.priceBlock}>
                <Text style={styles.priceLabel}>AI price per litre</Text>
                <Text style={styles.price}>Rs {formatRs(offer.price_per_l)}</Text>
                <Text style={styles.total}>Total Rs {formatRs(offer.total_amount)}</Text>
              </View>
            </Card>

            {actionError ? <Text style={styles.actionError}>{actionError}</Text> : null}

            {/* Huge decision buttons */}
            <Pressable
              onPress={onAccept}
              disabled={deciding}
              style={[styles.hugeBtn, styles.acceptBtn, deciding && styles.btnDim]}
            >
              {deciding ? (
                <ActivityIndicator color={colors.cream} />
              ) : (
                <Text style={styles.hugeBtnText}>Accept</Text>
              )}
            </Pressable>
            <Pressable
              onPress={onRefuse}
              disabled={deciding}
              style={[styles.hugeBtn, styles.refuseBtn, deciding && styles.btnDim]}
            >
              <Text style={[styles.hugeBtnText, styles.refuseText]}>Refuse</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 48 },
  list: { paddingBottom: 24 },
  resultCard: { marginBottom: 12, alignItems: 'center', paddingVertical: 24 },
  resultTitle: {
    fontSize: 20,
    color: colors.ink,
    fontFamily: 'BricolageGrotesque_700Bold',
  },
  resultAmount: {
    fontSize: 40,
    color: colors.forest,
    fontFamily: 'BricolageGrotesque_800ExtraBold',
    marginTop: 8,
  },
  resultSub: {
    fontSize: 14,
    color: colors.sage,
    fontFamily: 'BricolageGrotesque_600SemiBold',
    marginTop: 4,
  },
  resultHint: {
    fontSize: 14,
    color: colors.sage,
    fontFamily: 'BricolageGrotesque_400Regular',
    marginTop: 8,
    textAlign: 'center',
  },
  offerHeading: {
    fontSize: 18,
    color: colors.ink,
    fontFamily: 'BricolageGrotesque_700Bold',
    marginBottom: 12,
  },
  offerCard: { marginBottom: 16 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  rowLabel: { fontSize: 15, color: colors.sage, fontFamily: 'BricolageGrotesque_400Regular' },
  rowValue: { fontSize: 18, color: colors.ink, fontFamily: 'BricolageGrotesque_700Bold' },
  divider: { height: 1, backgroundColor: colors.line, marginVertical: 4 },
  priceBlock: {
    backgroundColor: colors.cream,
    borderRadius: 18,
    padding: 16,
    marginTop: 12,
    alignItems: 'center',
  },
  priceLabel: { fontSize: 14, color: colors.sage, fontFamily: 'BricolageGrotesque_400Regular' },
  price: {
    fontSize: 52,
    color: colors.forest,
    fontFamily: 'BricolageGrotesque_800ExtraBold',
    marginTop: 4,
  },
  total: {
    fontSize: 17,
    color: colors.ink,
    fontFamily: 'BricolageGrotesque_700Bold',
    marginTop: 8,
  },
  actionError: {
    fontSize: 14,
    color: colors.danger,
    fontFamily: 'BricolageGrotesque_600SemiBold',
    marginBottom: 12,
  },
  hugeBtn: {
    minHeight: 72,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  acceptBtn: { backgroundColor: colors.forest },
  refuseBtn: { backgroundColor: colors.ivory, borderWidth: 2, borderColor: colors.danger },
  hugeBtnText: {
    fontSize: 24,
    color: colors.cream,
    fontFamily: 'BricolageGrotesque_700Bold',
  },
  refuseText: { color: colors.danger },
  btnDim: { opacity: 0.5 },
});
