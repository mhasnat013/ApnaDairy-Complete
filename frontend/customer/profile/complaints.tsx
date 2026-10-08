// Customer complaints: list + new complaint form (optional photo).
import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, Alert, TextInput, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Screen } from '../../../src/components/common/Screen';
import { Card } from '../../../src/components/common/Card';
import { AppButton } from '../../../src/components/common/AppButton';
import { colors } from '../../../src/theme/colors';
import {
  listComplaints, createComplaint,
  type Complaint, type ComplaintCategory,
} from '../../../src/services/customer/accountService';
import type { UploadFile } from '../../../src/api/b2cClient';
import { pickImage } from '../../../src/utils/imagePicker';

const CATEGORIES: ComplaintCategory[] = ['quality', 'rider', 'order', 'payment']; // DB enum customer_complaint_category

function statusColor(s: string): string {
  if (s === 'resolved') return colors.success;
  if (s === 'rejected') return colors.danger;
  return colors.amber;
}

export default function ComplaintsScreen() {
  const router = useRouter();
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalVisible, setModalVisible] = useState(false);
  const [category, setCategory] = useState<ComplaintCategory>('quality');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [orderId, setOrderId] = useState('');
  const [photo, setPhoto] = useState<UploadFile | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setComplaints(await listComplaints());
    } catch (e) {
      Alert.alert('Error', (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const attachPhoto = async () => {
    const f = await pickImage();
    if (f) setPhoto(f);
    else Alert.alert('Photo', 'The photo picker is not available at the moment.');
  };

  const submit = async () => {
    if (subject.trim().length < 3) { Alert.alert('Missing', 'Enter a subject.'); return; }
    if (description.trim().length < 10) { Alert.alert('Missing', 'Enter details of at least 10 characters.'); return; }
    setSaving(true);
    try {
      await createComplaint(
        {
          order_id: orderId.trim() || undefined,
          category,
          subject: subject.trim(),
          description: description.trim(),
        },
        photo || undefined,
      );
      setModalVisible(false);
      setSubject(''); setDescription(''); setOrderId(''); setPhoto(null); setCategory('quality');
      await load();
    } catch (e) {
      Alert.alert('Error', (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1 }} edges={['top']}>
<Screen title="Complaints" subtitle="File a complaint">
      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.forest} /></View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          {complaints.map((c) => (
            <Pressable key={c.id} onPress={() => router.push(`/customer/profile/complaints/${c.id}` as never)}>
              <Card style={styles.card}>
                <View style={styles.row}>
                  <View style={styles.info}>
                    <Text style={styles.subject}>{c.subject}</Text>
                    <Text style={styles.detail}>{c.category} • {c.created_at ? new Date(c.created_at).toLocaleDateString('en-PK') : ''}</Text>
                  </View>
                  <Text style={[styles.status, { color: statusColor(c.status) }]}>{c.status.replace('_', ' ')}</Text>
                </View>
              </Card>
            </Pressable>
          ))}
          {complaints.length === 0 && (
            <Text style={styles.empty}>No complaints yet.</Text>
          )}
          <AppButton label="New complaint" onPress={() => setModalVisible(true)} />
        </ScrollView>
      )}

      <Modal visible={modalVisible} animationType="slide" transparent>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>New complaint</Text>
            <Text style={styles.label}>Category</Text>
            <View style={styles.chips}>
              {CATEGORIES.map((c) => (
                <Pressable
                  key={c}
                  style={[styles.chip, category === c && styles.chipActive]}
                  onPress={() => setCategory(c)}
                >
                  <Text style={[styles.chipText, category === c && styles.chipTextActive]}>{c}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput style={styles.input} placeholder="Subject" placeholderTextColor={colors.sage}
              value={subject} onChangeText={setSubject} />
            <TextInput style={[styles.input, styles.multiline]} placeholder="Enter details (min 10 characters)"
              placeholderTextColor={colors.sage} value={description} onChangeText={setDescription}
              multiline numberOfLines={4} textAlignVertical="top" />
            <TextInput style={styles.input} placeholder="Order ID (optional)" placeholderTextColor={colors.sage}
              value={orderId} onChangeText={setOrderId} />
            <Pressable style={styles.photoBtn} onPress={attachPhoto}>
              <Text style={styles.photoText}>{photo ? `Photo: ${photo.name}` : 'Attach photo (optional)'}</Text>
            </Pressable>
            <AppButton label="Submit" onPress={submit} loading={saving} />
            <Pressable style={styles.cancel} onPress={() => setModalVisible(false)}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </Screen>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingBottom: 32 },
  card: { marginBottom: 12 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  info: { flex: 1 },
  subject: { fontSize: 16, color: colors.ink, fontFamily: 'BricolageGrotesque_700Bold' },
  detail: { fontSize: 13, color: colors.sage, marginTop: 4, textTransform: 'capitalize' },
  status: { fontSize: 14, fontWeight: '700', textTransform: 'capitalize' },
  empty: { textAlign: 'center', color: colors.sage, marginVertical: 24, fontSize: 15 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.ivory, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 32, maxHeight: '90%' },
  sheetTitle: { fontSize: 20, color: colors.ink, fontFamily: 'BricolageGrotesque_700Bold', marginBottom: 12 },
  label: { fontSize: 14, fontWeight: '600', color: colors.ink, marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  chip: { borderWidth: 1.5, borderColor: colors.line, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  chipActive: { backgroundColor: colors.forest, borderColor: colors.forest },
  chipText: { fontSize: 14, color: colors.sage, textTransform: 'capitalize' },
  chipTextActive: { color: colors.ivory, fontWeight: '600' },
  input: {
    backgroundColor: colors.cream, borderRadius: 16, padding: 14, marginBottom: 10,
    fontSize: 16, color: colors.ink, borderWidth: 1, borderColor: colors.line,
  },
  multiline: { minHeight: 100 },
  photoBtn: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.line, borderRadius: 16, padding: 14, marginBottom: 12, alignItems: 'center' },
  photoText: { fontSize: 14, color: colors.forest, fontWeight: '600' },
  cancel: { alignItems: 'center', marginTop: 12 },
  cancelText: { fontSize: 15, color: colors.sage, fontWeight: '600' },
});
