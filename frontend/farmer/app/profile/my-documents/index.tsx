// My documents: the farmer's uploaded verification documents, from the backend.
import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { shouldRefetch } from '../../../src/utils/focusCache';
import { Screen } from '../../../src/components/common/Screen';
import { Card } from '../../../src/components/common/Card';
import { StatusBadge } from '../../../src/components/common/StatusBadge';
import { EmptyState } from '../../../src/components/common/EmptyState';
import { ErrorRetry } from '../../../src/components/common/ErrorRetry';
import { colors } from '../../../src/theme/colors';
import { font } from '../../../src/theme/theme';
import { listDocuments, type DocumentInfo } from '../../../src/services/documentsService';

/** English label per document kind. */
const KIND_LABEL: Record<string, string> = {
  cnic_front: 'CNIC (Front)',
  cnic_back: 'CNIC (Back)',
  profile_photo: 'Profile Photo',
  farm_photo: 'Farm Photo',
};

/** Single document row. */
function DocRow({ doc }: { doc: DocumentInfo }) {
  return (
    <Card style={styles.docCard}>
      <View style={styles.row}>
        <Text style={styles.label}>{KIND_LABEL[doc.kind] ?? doc.kind}</Text>
        <StatusBadge status="SUBMITTED" label="Submitted" />
      </View>
    </Card>
  );
}

/** My documents screen. */
export default function MyDocumentsScreen() {
  const [docs, setDocs] = useState<DocumentInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** Load the uploaded documents. */
  const load = useCallback(async () => {
    try {
      setError(null);
      setLoading(true);
      setDocs(await listDocuments());
    } catch {
      setError('Could not load your documents. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (shouldRefetch('my-documents')) load(); // 30s cache: skip refetch spam
    }, [load]),
  );

  if (loading) {
    return (
      <Screen title="My Documents">
        <View style={styles.center}><ActivityIndicator size="large" color={colors.forest} /></View>
      </Screen>
    );
  }

  if (error) {
    return (
      <Screen title="My Documents">
        <ErrorRetry message={error} onRetry={load} />
      </Screen>
    );
  }

  return (
    <Screen title="My Documents" subtitle="Documents you uploaded for verification">
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.list}>
        {docs.length === 0 ? (
          <EmptyState
            title="No documents yet"
            message="Your uploaded photos will appear here."
          />
        ) : (
          docs.map((doc) => <DocRow key={doc.kind} doc={doc} />)
        )}
        <Card style={styles.hintCard}>
          <Text style={styles.hint}>
            The SuperAdmin reviews your documents and approves your verification.
          </Text>
        </Card>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { paddingBottom: 32, gap: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 48, gap: 12 },
  docCard: { paddingVertical: 14 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { fontSize: 17, color: colors.ink, fontFamily: font.semibold },
  hintCard: { backgroundColor: colors.amberTint, borderWidth: 0 },
  hint: { fontSize: 14, color: colors.amberDark, textAlign: 'center', fontFamily: font.regular },
});
