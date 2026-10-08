// Farmer complaints list: category, snippet, date, status -> detail screen.
import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { shouldRefetch } from '../../src/utils/focusCache';
import { Screen } from '../../src/components/common/Screen';
import { Card } from '../../src/components/common/Card';
import { AppButton } from '../../src/components/common/AppButton';
import { StatusBadge } from '../../src/components/common/StatusBadge';
import { EmptyState } from '../../src/components/common/EmptyState';
import { ErrorRetry } from '../../src/components/common/ErrorRetry';
import { colors } from '../../src/theme/colors';
import type { Complaint } from '../../src/types/farmerModels';
import { getComplaints } from '../../src/services/engagementService';

/** English label per complaint status. */
const STATUS_LABEL: Record<Complaint['status'], string> = {
  OPEN: 'Open',
  IN_REVIEW: 'Under review',
  RESOLVED: 'Resolved',
};

/** Single complaint card row. */
function ComplaintRow({ item, onPress }: { item: Complaint; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.rowPress}>
      <Card style={styles.rowCard}>
        <View style={styles.rowTop}>
          <Text style={styles.category}>{item.category}</Text>
          <StatusBadge status={item.status} label={STATUS_LABEL[item.status]} />
        </View>
        <Text style={styles.snippet} numberOfLines={2}>{item.message}</Text>
        <Text style={styles.date}>{item.date}</Text>
      </Card>
    </Pressable>
  );
}

/** Complaints list screen. */
export default function ComplaintsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ created?: string }>();
  const [items, setItems] = useState<Complaint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Success banner after returning from the new-complaint screen.
  const [showCreated, setShowCreated] = useState(false);

  /** Reload complaints from the service. */
  const load = useCallback(async () => {
    try {
      setError(null);
      setLoading(true);
      setItems(await getComplaints());
    } catch {
      setError('Could not load complaints. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Refresh on focus (skipped if fetched <30s ago); show the success banner when arriving with ?created=1.
  useFocusEffect(
    useCallback(() => {
      if (shouldRefetch('complaints')) load();
      if (params.created === '1') {
        setShowCreated(true);
        router.setParams({ created: undefined });
      }
    }, [load, params.created, router]),
  );

  if (loading) {
    return (
      <Screen title="Complaints">
        <View style={styles.center}><ActivityIndicator size="large" color={colors.forest} /></View>
      </Screen>
    );
  }

  if (error) {
    return (
      <Screen title="Complaints">
        <ErrorRetry message={error} onRetry={load} />
      </Screen>
    );
  }

  return (
    <Screen title="Complaints" subtitle="Report any issue here">
      <View style={styles.topButton}>
        <AppButton label="New complaint" onPress={() => router.push('/complaints/new')} />
      </View>
      {showCreated && (
        <Pressable onPress={() => setShowCreated(false)} style={styles.success}>
          <Text style={styles.successText}>Your complaint has been submitted</Text>
        </Pressable>
      )}
      <FlatList
        data={items}
        keyExtractor={(c) => c.id}
        renderItem={({ item }) => (
          <ComplaintRow
            item={item}
            onPress={() => router.push({ pathname: '/complaints/detail', params: { id: item.id } })}
          />
        )}
        ListEmptyComponent={
          <EmptyState
            title="No complaints yet"
            message="When you report an issue, it will appear here."
          />
        }
        contentContainerStyle={items.length === 0 ? styles.emptyWrap : styles.list}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 48 },
  topButton: { marginBottom: 16 },
  success: {
    backgroundColor: colors.successTint,
    borderRadius: 18,
    borderLeftWidth: 4,
    borderLeftColor: colors.success,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 12,
  },
  successText: { color: colors.success, fontSize: 14, fontFamily: 'BricolageGrotesque_700Bold', textAlign: 'center' },
  list: { paddingBottom: 24 },
  emptyWrap: { flexGrow: 1, justifyContent: 'center' },
  rowPress: { marginBottom: 12 },
  rowCard: { padding: 14 },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  category: { fontSize: 13, color: colors.sage, fontFamily: 'BricolageGrotesque_700Bold' },
  snippet: { fontSize: 15, color: colors.ink, fontFamily: 'BricolageGrotesque_400Regular', lineHeight: 21 },
  date: { fontSize: 12, color: colors.sage, marginTop: 8, fontFamily: 'BricolageGrotesque_400Regular' },
});
