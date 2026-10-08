// Customer KYC verification — status view + document upload + submission.
// Backend stores documents in the customer-documents bucket (private);
// SuperAdmin reviews the submission.
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
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { Screen } from '../../../src/components/common/Screen';
import { Card } from '../../../src/components/common/Card';
import { AppButton } from '../../../src/components/common/AppButton';
import { StatusBadge } from '../../../src/components/common/StatusBadge';
import { colors } from '../../../src/theme/colors';
import {
  getVerificationStatus,
  submitVerification,
  uploadDocument,
  type DocType,
  type VerificationStatus,
} from '../../../src/services/customer/verificationService';

const DOCS: { key: DocType; label: string; required: boolean }[] = [
  { key: 'cnic_front', label: 'CNIC — front side', required: true },
  { key: 'cnic_back', label: 'CNIC — back side', required: true },
  { key: 'profile_photo', label: 'Profile photo (optional)', required: false },
];

// Docs the backend actually links on submit (VerificationSubmitIn has no
// profile_photo field, so the photo stays optional and is not sent).
const REQUIRED_DOCS: DocType[] = ['cnic_front', 'cnic_back'];

type DocState = Record<DocType, { path?: string; uploading: boolean; error?: string }>;

const emptyDocs = (): DocState => ({
  cnic_front: { uploading: false },
  cnic_back: { uploading: false },
  profile_photo: { uploading: false },
});

export default function VerificationScreen() {
  const [status, setStatus] = useState<VerificationStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [docs, setDocs] = useState<DocState>(emptyDocs);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setStatus(await getVerificationStatus());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load status.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const pickAndUpload = async (docType: DocType) => {
    setDocs((d) => ({ ...d, [docType]: { ...d[docType], uploading: true, error: undefined } }));
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) throw new Error('Gallery permission denied.');
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.7,
      });
      if (res.canceled || !res.assets?.[0]) {
        setDocs((d) => ({ ...d, [docType]: { ...d[docType], uploading: false } }));
        return;
      }
      const asset = res.assets[0];
      const name = asset.fileName ?? `${docType}.jpg`;
      const mimeType = asset.mimeType ?? 'image/jpeg';
      const out = await uploadDocument(asset.uri, name, mimeType, docType);
      setDocs((d) => ({ ...d, [docType]: { path: out.path, uploading: false } }));
    } catch (e) {
      setDocs((d) => ({
        ...d,
        [docType]: { ...d[docType], uploading: false, error: e instanceof Error ? e.message : 'Upload failed.' },
      }));
    }
  };

  const onSubmit = async () => {
    setFormError(null);
    if (!fullName.trim() || !phone.trim() || !address.trim()) {
      setFormError('Please fill name, phone and address.');
      return;
    }
    const missing = DOCS.filter((d) => d.required && !docs[d.key].path);
    if (missing.length) {
      setFormError(`Please upload: ${missing.map((d) => d.label).join(', ')}.`);
      return;
    }
    setSubmitting(true);
    try {
      await submitVerification({
        full_name: fullName.trim(),
        phone: phone.trim(),
        address: address.trim(),
        cnic_front_path: docs.cnic_front.path,
        cnic_back_path: docs.cnic_back.path,
      });
      await load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Submission failed.');
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
    if (error || !status) {
      return (
        <View style={styles.center}>
          <Text style={styles.error}>{error ?? 'Something went wrong.'}</Text>
          <AppButton label="Retry" onPress={() => void load()} variant="outline" />
        </View>
      );
    }

    const s = (status.status || 'pending').toLowerCase();

    if (s === 'approved') {
      return (
        <Card>
          <StatusBadge status="APPROVED" label="Verified" />
          <Text style={styles.title}>Account verified</Text>
          <Text style={styles.body}>
            Your documents were approved. You can now place orders and request a permanent subscription.
          </Text>
          <AppButton label="Back" onPress={() => router.back()} variant="outline" />
        </Card>
      );
    }

    if (s === 'rejected') {
      return (
        <Card>
          <StatusBadge status="REJECTED" label="Rejected" />
          <Text style={styles.title}>Verification rejected</Text>
          {status.rejection_reason ? (
            <Text style={styles.body}>Reason: {status.rejection_reason}</Text>
          ) : null}
          <Text style={styles.body}>Please fix the issue and submit again.</Text>
          <AppButton
            label="Submit again"
            onPress={() => {
              setDocs(emptyDocs());
              setStatus({ status: 'pending' });
            }}
          />
        </Card>
      );
    }

    if (status.submitted_at) {
      return (
        <Card>
          <StatusBadge status="PENDING" label="Under review" />
          <Text style={styles.title}>Documents under review</Text>
          <Text style={styles.body}>
            Your verification was submitted and is waiting for SuperAdmin approval. You can explore the
            app meanwhile; ordering unlocks after approval.
          </Text>
          <AppButton label="Back" onPress={() => router.back()} variant="outline" />
        </Card>
      );
    }

    // No submission yet — show the form.
    return (
      <>
        <Card>
          <Text style={styles.title}>Verify your account</Text>
          <Text style={styles.body}>
            Verification is required before ordering. Upload clear photos of your CNIC (front and
            back). A profile photo is optional.
          </Text>
        </Card>

        <Card>
          <Text style={styles.label}>Full name</Text>
          <TextInput style={styles.input} value={fullName} onChangeText={setFullName}
            placeholder="Muhammad Ali" placeholderTextColor={colors.sage} />
          <Text style={styles.label}>Phone</Text>
          <TextInput style={styles.input} value={phone} onChangeText={setPhone}
            placeholder="0300 1234567" placeholderTextColor={colors.sage} keyboardType="phone-pad" />
          <Text style={styles.label}>Current address</Text>
          <TextInput style={[styles.input, styles.multiline]} value={address} onChangeText={setAddress}
            placeholder="House, street, area, city" placeholderTextColor={colors.sage} multiline />
        </Card>

        <Card>
          <Text style={styles.title}>Documents</Text>
          {DOCS.map((d) => {
            const st = docs[d.key];
            return (
              <View key={d.key} style={styles.docRow}>
                <View style={styles.docInfo}>
                  <Text style={styles.docLabel}>{d.label}</Text>
                  {st.path ? (
                    <Text style={styles.docOk}>Uploaded</Text>
                  ) : st.error ? (
                    <Text style={styles.error}>{st.error}</Text>
                  ) : null}
                </View>
                <Pressable
                  style={[styles.pickBtn, st.uploading && styles.dim]}
                  disabled={st.uploading}
                  onPress={() => void pickAndUpload(d.key)}
                >
                  {st.uploading ? (
                    <ActivityIndicator size="small" color={colors.ivory} />
                  ) : (
                    <Text style={styles.pickText}>{st.path ? 'Change' : 'Upload'}</Text>
                  )}
                </Pressable>
              </View>
            );
          })}
        </Card>

        {formError ? <Text style={styles.error}>{formError}</Text> : null}
        <AppButton label="Submit for verification" onPress={() => void onSubmit()} loading={submitting} />
      </>
    );
  };

  return (
    <SafeAreaView style={{ flex: 1 }} edges={['top']}>
<Screen title="Verification" subtitle="ApnaDairy">
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.list}>
        {renderBody()}
      </ScrollView>
    </Screen>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  list: { gap: 12, paddingBottom: 24 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingTop: 60 },
  title: { fontSize: 18, color: colors.ink, fontFamily: 'BricolageGrotesque_700Bold', marginVertical: 8 },
  body: { fontSize: 15, color: colors.sage, lineHeight: 22, marginBottom: 8 },
  label: { fontSize: 14, fontWeight: '600', color: colors.ink, marginTop: 10, marginBottom: 6 },
  input: {
    backgroundColor: colors.ivory, borderRadius: 16, paddingHorizontal: 14, height: 48,
    fontSize: 16, color: colors.ink, borderWidth: 1, borderColor: colors.line,
  },
  multiline: { height: 84, textAlignVertical: 'top', paddingTop: 12 },
  error: { color: colors.danger, fontSize: 14, textAlign: 'center', marginVertical: 4 },
  docRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.line },
  docInfo: { flex: 1 },
  docLabel: { fontSize: 15, fontWeight: '600', color: colors.ink },
  docOk: { fontSize: 13, color: colors.success, marginTop: 2 },
  pickBtn: { backgroundColor: colors.forest, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 10 },
  pickText: { color: colors.ivory, fontSize: 14, fontWeight: '700' },
  dim: { opacity: 0.5 },
});
