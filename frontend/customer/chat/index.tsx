// Customer AI chatbot — chat with the ApnaDairy dairy assistant.
// Route: /customer/chat (pushed from profile menu or home; not a tab).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Screen } from '../../../src/components/common/Screen';
import { colors } from '../../../src/theme/colors';
import { askAssistant } from '../../../src/services/customer/chatService';

interface Message {
  id: string;
  role: 'user' | 'bot';
  text: string;
  demo?: boolean;
  failed?: boolean;
}

let seq = 0;
const nextId = () => `m${Date.now()}_${seq++}`;

const SUGGESTIONS = [
  'How do I check the freshness of milk?',
  'Where is my order?',
  'What is the price of desi ghee?',
];

export default function ChatScreen() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<FlatList<Message>>(null);

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => {
      listRef.current?.scrollToEnd({ animated: true });
    });
  }, []);

  useEffect(() => {
    if (messages.length > 0) scrollToEnd();
  }, [messages, scrollToEnd]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || sending) return;
      setError(null);
      setInput('');
      const userMsg: Message = { id: nextId(), role: 'user', text: trimmed };
      setMessages((prev) => [...prev, userMsg]);
      setSending(true);
      try {
        const res = await askAssistant(trimmed);
        const botMsg: Message = {
          id: nextId(),
          role: 'bot',
          text: res.reply,
          demo: res.demo,
        };
        setMessages((prev) => [...prev, botMsg]);
      } catch (e) {
        const failMsg: Message = {
          id: nextId(),
          role: 'bot',
          text: '',
          failed: true,
        };
        setMessages((prev) => [...prev, failMsg]);
        setError(e instanceof Error ? e.message : 'No response received.');
      } finally {
        setSending(false);
      }
    },
    [sending],
  );

  const retryLast = useCallback(() => {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    if (lastUser) {
      setMessages((prev) => prev.filter((m) => !m.failed));
      void send(lastUser.text);
    }
  }, [messages, send]);

  const renderItem = ({ item }: { item: Message }) => {
    if (item.failed) {
      return (
        <View style={[styles.bubble, styles.botBubble, styles.failedBubble]}>
          <Text style={styles.failedText}>No response received. Please try again.</Text>
          <Pressable onPress={retryLast} style={styles.retryBtn}>
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      );
    }
    const isUser = item.role === 'user';
    return (
      <View style={[styles.bubble, isUser ? styles.userBubble : styles.botBubble]}>
        <Text style={[styles.msgText, isUser ? styles.userText : styles.botText]}>{item.text}</Text>
        {item.demo ? <Text style={styles.demoTag}>Demo response</Text> : null}
      </View>
    );
  };

  return (
    <Screen title="AI Assistant" subtitle="ApnaDairy">
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={90}
      >
        {messages.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Ask the ApnaDairy assistant</Text>
            <Text style={styles.emptyBody}>
              Ask anything about milk, ghee, orders, or delivery.
            </Text>
            {SUGGESTIONS.map((s) => (
              <Pressable key={s} style={styles.suggestion} onPress={() => void send(s)}>
                <Text style={styles.suggestionText}>{s}</Text>
              </Pressable>
            ))}
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(m) => m.id}
            renderItem={renderItem}
            contentContainerStyle={styles.list}
            onContentSizeChange={scrollToEnd}
          />
        )}

        {sending ? (
          <View style={styles.typing}>
            <ActivityIndicator size="small" color={colors.forest} />
            <Text style={styles.typingText}>Composing a response...</Text>
          </View>
        ) : null}

        {error && messages.length === 0 ? <Text style={styles.errorText}>{error}</Text> : null}

        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="Type your question..."
            placeholderTextColor={colors.sage}
            multiline
            maxLength={2000}
            editable={!sending}
            onSubmitEditing={() => void send(input)}
          />
          <Pressable
            style={[styles.sendBtn, (!input.trim() || sending) && styles.sendBtnDim]}
            onPress={() => void send(input)}
            disabled={!input.trim() || sending}
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

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { paddingVertical: 12, gap: 10 },
  bubble: {
    maxWidth: '82%',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: colors.forest,
    borderBottomRightRadius: 4,
  },
  botBubble: {
    alignSelf: 'flex-start',
    backgroundColor: colors.ivory,
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: colors.line,
  },
  msgText: { fontSize: 15, lineHeight: 22, fontFamily: 'BricolageGrotesque_400Regular' },
  userText: { color: colors.ivory },
  botText: { color: colors.ink },
  demoTag: {
    marginTop: 6,
    fontSize: 11,
    color: colors.sage,
    fontStyle: 'italic',
  },
  failedBubble: { borderColor: colors.danger },
  failedText: { fontSize: 14, color: colors.danger },
  retryBtn: {
    marginTop: 8,
    alignSelf: 'flex-start',
    backgroundColor: colors.forest,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  retryText: { color: colors.ivory, fontSize: 13, fontWeight: '700' },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 },
  emptyTitle: {
    fontSize: 22,
    color: colors.forest,
    fontFamily: 'BricolageGrotesque_700Bold',
    marginBottom: 8,
    textAlign: 'center' },
  emptyBody: {
    fontSize: 15,
    color: colors.sage,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 20,
  },
  suggestion: {
    backgroundColor: colors.ivory,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginTop: 8,
  },
  suggestionText: { fontSize: 14, color: colors.forest, fontFamily: 'BricolageGrotesque_400Regular' },
  typing: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  typingText: { fontSize: 13, color: colors.sage, fontStyle: 'italic' },
  errorText: { color: colors.danger, fontSize: 13, textAlign: 'center', marginBottom: 8 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.cream,
  },
  input: {
    flex: 1,
    backgroundColor: colors.ivory,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.ink,
    maxHeight: 120,
    fontFamily: 'BricolageGrotesque_400Regular' },
  sendBtn: {
    backgroundColor: colors.forest,
    borderRadius: 999,
    paddingHorizontal: 20,
    paddingVertical: 13,
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 88,
  },
  sendBtnDim: { opacity: 0.5 },
  sendText: {
    color: colors.ivory,
    fontSize: 15,
    fontFamily: 'BricolageGrotesque_700Bold' },
});
