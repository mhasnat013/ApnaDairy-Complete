// Complaint detail: info + message thread + follow-up input.
import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Alert, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Screen } from '../../../../src/components/common/Screen';
import { Card } from '../../../../src/components/common/Card';
import { AppButton } from '../../../../src/components/common/AppButton';
import { colors } from '../../../../src/theme/colors';
import {
  getComplaint, postComplaintMessage, type Complaint,
} from '../../../../src/services/customer/accountService';

export default function ComplaintDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [complaint, setComplaint] = useState<Complaint | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setComplaint(await getComplaint(id));
    } catch (e) {
      Alert.alert('Error', (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const send = async () => {
    if (!message.trim() || !id) return;
    setSending(true);
    try {
      const msgs = await postComplaintMessage(id, message.trim());
      setComplaint((c) => (c ? { ...c, messages: msgs } : c));
      setMessage('');
    } catch (e) {
      Alert.alert('Error', (e as Error).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1 }} edges={['top']}>
<Screen title="Complaint" subtitle={complaint?.subject || ''}>
      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.forest} /></View>
      ) : !complaint ? (
        <View style={styles.center}><Text style={styles.empty}>Complaint not found.</Text></View>
      ) : (
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
            <Card style={styles.card}>
              <Text style={styles.subject}>{complaint.subject}</Text>
              <Text style={styles.meta}>
                {complaint.category} • {complaint.status.replace('_', ' ')}
                {complaint.order_id ? ` • Order ${complaint.order_id.slice(0, 8)}` : ''}
              </Text>
              <Text style={styles.desc}>{complaint.description}</Text>
            </Card>

            <Text style={styles.section}>Messages</Text>
            {complaint.messages.map((m, i) => (
              <View key={i} style={[styles.bubble, m.sender === 'customer' ? styles.mine : styles.theirs]}>
                <Text style={styles.bubbleSender}>{m.sender === 'customer' ? 'You' : 'Support'}</Text>
                <Text style={[styles.bubbleText, m.sender === 'customer' ? styles.mineText : styles.theirsText]}>{m.text}</Text>
              </View>
            ))}
            {complaint.messages.length === 0 && (
              <Text style={styles.empty}>No messages yet.</Text>
            )}
          </ScrollView>
          <View style={styles.composer}>
            <TextInput
              style={styles.input}
              placeholder="Write a follow-up message..."
              placeholderTextColor={colors.sage}
              value={message}
              onChangeText={setMessage}
              multiline
            />
            <AppButton label="Send" onPress={send} loading={sending} disabled={!message.trim()} />
          </View>
        </KeyboardAvoidingView>
      )}
    </Screen>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingBottom: 16 },
  card: { marginBottom: 12 },
  subject: { fontSize: 18, color: colors.ink, fontFamily: 'BricolageGrotesque_700Bold' },
  meta: { fontSize: 13, color: colors.sage, marginTop: 4, textTransform: 'capitalize' },
  desc: { fontSize: 15, color: colors.ink, marginTop: 10, lineHeight: 22 },
  section: { fontSize: 18, color: colors.ink, fontFamily: 'BricolageGrotesque_700Bold', marginTop: 8, marginBottom: 12 },
  bubble: { borderRadius: 16, padding: 12, marginBottom: 8, maxWidth: '85%' },
  mine: { backgroundColor: colors.forest, alignSelf: 'flex-end' },
  theirs: { backgroundColor: colors.ivory, alignSelf: 'flex-start', borderWidth: 1, borderColor: colors.line },
  bubbleSender: { fontSize: 12, fontWeight: '700', color: colors.amber, marginBottom: 4 },
  bubbleText: { fontSize: 15 },
  mineText: { color: colors.ivory },
  theirsText: { color: colors.ink },
  empty: { textAlign: 'center', color: colors.sage, marginVertical: 16, fontSize: 15 },
  composer: { paddingVertical: 8 },
  input: {
    backgroundColor: colors.ivory, borderRadius: 16, padding: 14, marginBottom: 10,
    fontSize: 16, color: colors.ink, borderWidth: 1, borderColor: colors.line, minHeight: 48,
  },
});
