// Two-way chat with the assigned rider for a delivery.
// Phase 1 = polling every 10s for new messages (no realtime yet).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Pressable,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Screen } from '../../../../src/components/common/Screen';
import { Card } from '../../../../src/components/common/Card';
import { colors } from '../../../../src/theme/colors';
import {
  sendRiderMessage,
  type RiderMessage,
} from '../../../../src/services/customer/riderService';
import { trackOrder } from '../../../../src/services/customer/orderService';

export default function RiderChatScreen() {
  const { id, deliveryId, riderName } = useLocalSearchParams<{
    id: string;
    deliveryId: string;
    riderName?: string;
  }>();
  const orderId = Array.isArray(id) ? id[0] : id;
  const did = Array.isArray(deliveryId) ? deliveryId[0] : deliveryId;

  const [messages, setMessages] = useState<RiderMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<FlatList>(null);

  const refresh = useCallback(async () => {
    if (!orderId) return;
    try {
      const delivery = await trackOrder(orderId);
      setMessages(delivery.messages ?? []);
      setError(null);
    } catch (e) {
      if (loading) setError(e instanceof Error ? e.message : 'Failed to load chat.');
    } finally {
      setLoading(false);
    }
  }, [orderId, loading]);

  // Initial load + poll every 10s (Phase 1: no realtime).
  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 10000);
    return () => clearInterval(timer);
  }, [refresh]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || !did || sending) return;
    setSending(true);
    try {
      const updated = await sendRiderMessage(did, text);
      setMessages(updated);
      setDraft('');
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Message not sent. Try again.');
    } finally {
      setSending(false);
    }
  }, [did, draft, sending]);

  const renderItem = ({ item }: { item: RiderMessage }) => {
    const mine = item.from === 'customer';
    return (
      <View style={[styles.bubbleRow, mine ? styles.mineRow : styles.theirsRow]}>
        <View style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
          <Text style={[styles.msgText, mine ? styles.mineText : styles.theirsText]}>
            {item.text}
          </Text>
          {item.created_at ? (
            <Text style={[styles.time, mine ? styles.mineTime : styles.theirsTime]}>
              {new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </Text>
          ) : null}
        </View>
      </View>
    );
  };

  if (loading) {
    return (
      <Screen title="Rider chat">
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.forest} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen
      title="Rider chat"
      subtitle={riderName ? `with ${Array.isArray(riderName) ? riderName[0] : riderName}` : undefined}
    >
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={90}
      >
        {error ? (
          <Card style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable onPress={() => { setError(null); refresh(); }}>
              <Text style={styles.retryText}>Try again</Text>
            </Pressable>
          </Card>
        ) : null}

        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(_, i) => `msg-${i}`}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.emptyText}>
                No messages yet. Say hello to your rider.
              </Text>
            </View>
          }
        />

        <View style={styles.composer}>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder="Type a message..."
            placeholderTextColor={colors.sage}
            multiline
            maxLength={1000}
            editable={!sending}
          />
          <Pressable
            onPress={send}
            disabled={sending || !draft.trim()}
            style={[styles.sendBtn, (!draft.trim() || sending) && styles.sendBtnDim]}
          >
            {sending ? (
              <ActivityIndicator size="small" color={colors.ivory} />
            ) : (
              <Text style={styles.sendText}>Send</Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

/* Messages are fetched via trackOrder(orderId) from orderService. */

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyText: { fontSize: 14, color: colors.sage, textAlign: 'center', lineHeight: 20 },
  errorCard: { marginTop: 12, borderColor: colors.danger },
  errorText: { color: colors.danger, fontSize: 14, marginBottom: 8 },
  retryText: { color: colors.forest, fontFamily: 'BricolageGrotesque_700Bold' },
  list: { paddingVertical: 12, paddingHorizontal: 4, flexGrow: 1 },
  bubbleRow: { marginBottom: 10, flexDirection: 'row' },
  mineRow: { justifyContent: 'flex-end' },
  theirsRow: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '80%', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 },
  mine: { backgroundColor: colors.forest, borderBottomRightRadius: 4 },
  theirs: { backgroundColor: colors.ivory, borderBottomLeftRadius: 4, borderWidth: 1, borderColor: colors.line },
  msgText: { fontSize: 15, lineHeight: 21 },
  mineText: { color: colors.ivory },
  theirsText: { color: colors.ink },
  time: { fontSize: 11, marginTop: 4 },
  mineTime: { color: colors.chatTint, textAlign: 'right' },
  theirsTime: { color: colors.sage },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.cream,
  },
  input: {
    flex: 1,
    backgroundColor: colors.ivory,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.ink,
    maxHeight: 100,
  },
  sendBtn: {
    backgroundColor: colors.forest,
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 10,
    marginLeft: 8,
    justifyContent: 'center',
  },
  sendBtnDim: { opacity: 0.5 },
  sendText: { color: colors.ivory, fontFamily: 'BricolageGrotesque_700Bold' },
});
