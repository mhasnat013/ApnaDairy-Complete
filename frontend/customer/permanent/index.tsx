// Permanent (monthly) customer — subscription request + monthly ledger.
// Only verified customers may request; backend returns 403 otherwise.
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { Screen } from '../../../src/components/common/Screen';
import { Card } from '../../../src/components/common/Card';
import { AppButton } from '../../../src/components/common/AppButton';
import { StatusBadge } from '../../../src/components/common/StatusBadge';
import { colors } from '../../../src/theme/colors';
import {
  getLedger,
  getPermanentStatus,
  requestPermanent,
  type Cycle,
  type Ledger,
  type PermanentRequest,
} from '../../../src/services/customer/permanentService';

const todayISO = () => new Date().toISOString().slice(0, 10);

const fmtDate = (d?: string | null) => (d ? d.slice(0, 10) : '—');

export default function PermanentScreen() {
  const [req, setReq] = useState<PermanentRequest | { status: 'none' } | null>(null);
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [cycle, setCycle] = useState<Cycle>('30');
  const [qty, setQty] = useState('2');
  const [startDate, setStartDate] = useState(todayISO());
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [r, l] = await Promise.all([getPermanentStatus(), getLedger().catch(() => null)]);
      setReq(r);
      setLedger(l);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onRequest = async () => {
    setFormError(null);
    const q = parseFloat(qty);
    if (!q || q <= 0) {
      setFormError('Please enter a valid daily quantity in litres.');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || startDate < todayISO()) {
      setFormError('Start date must be today or later (YYYY-MM-DD).');
      return;
    }
    setSubmitting(true);
    try {
      await requestPermanent(cycle, q, startDate);
      await load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Request failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const renderBody = () => {
    if (loading) {
      return (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.forest} />
        </View>
      );
    }
    if (error || !req) {
      return (
        <View style={styles.center}>
          <Text style={styles.error}>{error ?? 'Something went wrong.'}</Text>
          <AppButton label="Retry" onPress={() => void load()} variant="outline" />
        </View>
      );
    }

    const status = req.status;

    if (status === 'none') {
      return (
        <>
          <Card>
            <Text style={styles.title}>Become a permanent customer</Text>
            <Text style={styles.body}>
              Get daily milk delivery on a 15-day or 30-day cycle with a monthly ledger. Your request
              needs SuperAdmin approval.
            </Text>
          </Card>
          <Card>
            <Text style={styles.label}>Billing cycle</Text>
            <View style={styles.cycleRow}>
              {(['15', '30'] as Cycle[]).map((c) => (
                <Pressable
                  key={c}
                  style={[styles.cycleBtn, cycle === c && styles.cycleActive]}
                  onPress={() => setCycle(c)}
                >
                  <Text style={[styles.cycleText, cycle === c && styles.cycleTextActive]}>
                    {c} days
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.label}>Daily quantity (litres)</Text>
            <TextInput style={styles.input} value={qty} onChangeText={setQty}
              placeholder="2" placeholderTextColor={colors.sage} keyboardType="decimal-pad" />
            <Text style={styles.label}>Start date (YYYY-MM-DD)</Text>
            <TextInput style={styles.input} value={startDate} onChangeText={setStartDate}
              placeholder={todayISO()} placeholderTextColor={colors.sage} />
          </Card>
          {formError ? <Text style={styles.error}>{formError}</Text> : null}
          <AppButton label="Request subscription" onPress={() => void onRequest()} loading={submitting} />
        </>
      );
    }

    if (status === 'pending') {
      const r = req as PermanentRequest;
      return (
        <Card>
          <StatusBadge status="PENDING" label="Pending approval" />
          <Text style={styles.title}>Request under review</Text>
          <Text style={styles.body}>
            {r.cycle}-day cycle, {r.daily_quantity_l ?? '—'} L/day, starting {fmtDate(r.start_date)}.
            SuperAdmin will approve your permanent subscription soon.
          </Text>
          <AppButton label="Back" onPress={() => router.back()} variant="outline" />
        </Card>
      );
    }

    if (status === 'rejected') {
      const r = req as PermanentRequest;
      return (
        <Card>
          <StatusBadge status="REJECTED" label="Rejected" />
          <Text style={styles.title}>Request rejected</Text>
          {r.rejection_reason ? <Text style={styles.body}>Reason: {r.rejection_reason}</Text> : null}
          <AppButton label="Back" onPress={() => router.back()} variant="outline" />
        </Card>
      );
    }

    // Approved (or paused) — show subscription + ledger.
    const r = req as PermanentRequest;
    return (
      <>
        <Card>
          <StatusBadge status={status === 'approved' ? 'APPROVED' : 'PENDING'} label={status} />
          <Text style={styles.title}>Permanent subscription</Text>
          <Text style={styles.body}>
            {r.cycle}-day cycle · {r.daily_quantity_l ?? '—'} L/day{'\n'}
            {fmtDate(r.start_date)} → {fmtDate(r.end_date)}
          </Text>
          {ledger ? (
            <View style={styles.balanceRow}>
              <Text style={styles.balanceLabel}>Ledger balance</Text>
              <Text style={[styles.balanceValue, ledger.balance > 0 && styles.balanceDue]}>
                Rs {ledger.balance.toFixed(2)}
              </Text>
            </View>
          ) : null}
        </Card>

        <Card>
          <Text style={styles.title}>Monthly ledger</Text>
          {ledger && ledger.entries.length ? (
            ledger.entries.map((e) => (
              <View key={e.id} style={styles.entryRow}>
                <View style={styles.entryInfo}>
                  <Text style={styles.entryType}>{e.entry_type}</Text>
                  <Text style={styles.entryDate}>{fmtDate(e.created_at)}</Text>
                </View>
                <Text style={[styles.entryAmount, e.amount < 0 && styles.balanceDue]}>
                  Rs {Math.abs(e.amount).toFixed(2)}
                </Text>
              </View>
            ))
          ) : (
            <Text style={styles.body}>No ledger entries yet.</Text>
          )}
        </Card>
      </>
    );
  };

  return (
    <Screen title="Permanent customer" subtitle="ApnaDairy">
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.list}>
        {renderBody()}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { gap: 12, paddingBottom: 24 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingTop: 60 },
  title: { fontSize: 18, color: colors.ink, fontFamily: 'BricolageGrotesque_700Bold', marginVertical: 8 },
  body: { fontSize: 15, color: colors.sage, lineHeight: 22, marginBottom: 8 },
  label: { fontSize: 14, fontWeight: '600', color: colors.ink, marginTop: 10, marginBottom: 6 },
  input: {
    backgroundColor: colors.ivory, borderRadius: 12, paddingHorizontal: 14, height: 48,
    fontSize: 16, color: colors.ink, borderWidth: 1, borderColor: colors.line,
  },
  error: { color: colors.danger, fontSize: 14, textAlign: 'center', marginVertical: 4 },
  cycleRow: { flexDirection: 'row', gap: 10 },
  cycleBtn: {
    flex: 1, borderRadius: 12, borderWidth: 2, borderColor: colors.line,
    paddingVertical: 12, alignItems: 'center', backgroundColor: colors.ivory,
  },
  cycleActive: { borderColor: colors.forest, backgroundColor: colors.cream },
  cycleText: { fontSize: 16, fontWeight: '600', color: colors.sage },
  cycleTextActive: { color: colors.forest },
  balanceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.line },
  balanceLabel: { fontSize: 15, color: colors.sage },
  balanceValue: { fontSize: 20, color: colors.success, fontFamily: 'BricolageGrotesque_700Bold' },
  balanceDue: { color: colors.danger },
  entryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.line },
  entryInfo: { flex: 1 },
  entryType: { fontSize: 15, fontWeight: '600', color: colors.ink },
  entryDate: { fontSize: 13, color: colors.sage, marginTop: 2 },
  entryAmount: { fontSize: 16, fontWeight: '700', color: colors.ink },
});
