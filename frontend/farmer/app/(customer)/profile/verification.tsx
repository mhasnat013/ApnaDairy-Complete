// Customer verification: status + CNIC/profile-photo upload + submit.
import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, Alert, TextInput } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Screen } from '../../../src/components/common/Screen';
import { Card } from '../../../src/components/common/Card';
import { AppButton } from '../../../src/components/common/AppButton';
import { colors } from '../../../src/theme/colors';
import {
  verificationStatus, uploadVerificationDocument, submitVerification, getProfile,
  type VerificationStatus, type DocType,
} from '../../../src/services/customer/accountService';
import type { UploadFile } from '../../../src/api/b2cClient';
import { pickImage } from '../../../src/utils/imagePicker';

const DOCS: Array<{ type: DocType; label: string }> = [
  { type: 'cnic_front', label: 'CNIC front' },
  { type: 'cnic_back', label: 'CNIC back' },
  { type: 'profile_photo', label: 'Profile photo' },
];

function statusLabel(s: string): string {
  switch (s) {
    case 'approved': return 'Verified — you can place orders.';
    case 'rejected': return 'Rejected — please submit again.';
    case 'in_review': return 'Under review — the SuperAdmin is checking your documents.';
    default: return 'Pending — upload your documents and submit.';
  }
}

export default function VerificationScreen() {
  const [status, setStatus] = useState<VerificationStatus | null>(null);
  const [paths, setPaths] = useState<Record<DocType, string | null>>({ cnic_front: null, cnic_back: null, profile_photo: null });
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState<DocType | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, p] = await Promise.all([verificationStatus(), getProfile().catch(() => null)]);
      setStatus(s);
      if (p) {
        setFullName([p.first_name, p.last_name].filter(Boolean).join(' '));
        setPhone(p.phone || '');
      }
    } catch (e) {
      Alert.alert('Error', (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const upload = async (type: DocType) => {
    const file: UploadFile | null = await pickImage();
    if (!file) { Alert.alert('Photo', 'The photo picker is not available at the moment.'); return; }
    setUploading(type);
    try {
      const res = await uploadVerificationDocument(type, file);
      setPaths((prev) => ({ ...prev, [type]: res.path }));
    } catch (e) {
      Alert.alert('Upload failed', (e as Error).message);
    } finally {
      setUploading(null);
    }
  };

  const submit = async () => {
    if (!fullName.trim()) { Alert.alert('Missing', 'Enter your full name.'); return; }
    if (!phone.trim()) { Alert.alert('Missing', 'Enter your phone number.'); return; }
    if (!address.trim()) { Alert.alert('Missing', 'Enter your address.'); return; }
    if (!paths.cnic_front || !paths.cnic_back) {
      Alert.alert('Missing', 'Upload both the CNIC front and back.');
      return;
    }
    setSubmitting(true);
    try {
      await submitVerification({
        full_name: fullName.trim(),
        phone: phone.trim(),
        address: address.trim(),
        cnic_front_path: paths.cnic_front,
        cnic_back_path: paths.cnic_back,
      });
      Alert.alert('Submitted', 'Your verification has been submitted to the SuperAdmin.');
      await load();
    } catch (e) {
      Alert.alert('Error', (e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const readonly = status?.status === 'approved' || status?.status === 'in_review';

  return (
    <Screen title="Verification" subtitle="Account verification">
      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.forest} /></View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          <Card style={styles.card}>
            <Text style={styles.statusTitle}>Status: {status?.status || 'pending'}</Text>
            <Text style={styles.statusText}>{statusLabel(status?.status || 'pending')}</Text>
            {status?.status === 'rejected' && status.rejection_reason && (
              <Text style={styles.rejection}>Reason: {status.rejection_reason}</Text>
            )}
          </Card>

          {!readonly && (
            <>
              <Text style={styles.section}>Documents</Text>
              {DOCS.map((d) => (
                <Card key={d.type} style={styles.card}>
                  <View style={styles.docRow}>
                    <Text style={styles.docLabel}>{d.label}</Text>
                    <Pressable
                      style={[styles.uploadBtn, paths[d.type] && styles.uploadedBtn]}
                      onPress={() => upload(d.type)}
                      disabled={uploading !== null}
                    >
                      {uploading === d.type ? (
                        <ActivityIndicator size="small" color={colors.ivory} />
                      ) : (
                        <Text style={styles.uploadText}>{paths[d.type] ? 'Uploaded' : 'Upload'}</Text>
                      )}
                    </Pressable>
                  </View>
                </Card>
              ))}

              <Text style={styles.section}>Details</Text>
              <TextInput style={styles.input} placeholder="Full name" placeholderTextColor={colors.sage}
                value={fullName} onChangeText={setFullName} />
              <TextInput style={styles.input} placeholder="Phone" placeholderTextColor={colors.sage}
                value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
              <TextInput style={[styles.input, styles.multiline]} placeholder="Current address"
                placeholderTextColor={colors.sage} value={address} onChangeText={setAddress}
                multiline numberOfLines={3} textAlignVertical="top" />
              <AppButton label="Submit for verification" onPress={submit} loading={submitting} />
            </>
          )}
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingBottom: 32 },
  card: { marginBottom: 12 },
  statusTitle: { fontSize: 16, color: colors.ink, fontFamily: 'BricolageGrotesque_700Bold', textTransform: 'capitalize' },
  statusText: { fontSize: 14, color: colors.sage, marginTop: 6, lineHeight: 20 },
  rejection: { fontSize: 14, color: colors.danger, marginTop: 8 },
  section: { fontSize: 18, color: colors.ink, fontFamily: 'BricolageGrotesque_700Bold', marginTop: 8, marginBottom: 12 },
  docRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  docLabel: { fontSize: 16, fontWeight: '600', color: colors.ink },
  uploadBtn: { backgroundColor: colors.forest, borderRadius: 999, paddingHorizontal: 20, paddingVertical: 10 },
  uploadedBtn: { backgroundColor: colors.success },
  uploadText: { color: colors.ivory, fontSize: 14, fontWeight: '700' },
  input: {
    backgroundColor: colors.ivory, borderRadius: 12, padding: 14, marginBottom: 10,
    fontSize: 16, color: colors.ink, borderWidth: 1, borderColor: colors.line,
  },
  multiline: { minHeight: 80 },
});
