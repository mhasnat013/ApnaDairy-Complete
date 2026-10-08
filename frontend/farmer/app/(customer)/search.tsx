// Customer global search — products + managers, with recent searches.
// Route: /customer/search (pushed from home header search bar).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, FlatList, Pressable, StyleSheet, ActivityIndicator, Keyboard,
} from 'react-native';
import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { Screen } from '../../src/components/common/Screen';
import { SearchBar } from '../../src/components/common/SearchBar';
import { EmptyState } from '../../src/components/common/EmptyState';
import { ErrorRetry } from '../../src/components/common/ErrorRetry';
import { colors } from '../../src/theme/colors';
import { listProducts } from '../../src/services/customer/marketplaceService';
import type { Product } from '../../src/types/customerModels';

const RECENT_KEY = 'ad_recent_searches';
const MAX_RECENT = 8;

/** Recent searches persisted in SecureStore (memory fallback). */
async function loadRecent(): Promise<string[]> {
  try {
    const raw = await SecureStore.getItemAsync(RECENT_KEY);
    if (raw) return JSON.parse(raw) as string[];
  } catch {
    // fall through to memory
  }
  return memRecent;
}
let memRecent: string[] = [];
async function saveRecent(items: string[]): Promise<void> {
  memRecent = items;
  try {
    await SecureStore.setItemAsync(RECENT_KEY, JSON.stringify(items));
  } catch {
    // memory only
  }
}

function priceOf(p: Product): string {
  const v = p.final_price ?? p.price ?? 0;
  return `Rs ${Number(v).toFixed(0)}${p.unit ? '/' + p.unit : ''}`;
}

export default function CustomerSearch() {
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [results, setResults] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Sequence guard: only the latest request may update state.
  const requestSeq = useRef(0);

  useEffect(() => {
    loadRecent().then(setRecent);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const runSearch = useCallback(async (q: string) => {
    const term = q.trim();
    if (!term) {
      setResults([]);
      setSubmitted('');
      return;
    }
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    try {
      const list = await listProducts({ q: term, page_size: 30 });
      // Ignore stale responses (a newer search was started meanwhile).
      if (seq !== requestSeq.current) return;
      setResults(list.items);
      setSubmitted(term);
      setRecent((prev) => {
        const next = [term, ...prev.filter((r) => r !== term)].slice(0, MAX_RECENT);
        saveRecent(next);
        return next;
      });
    } catch (e) {
      if (seq === requestSeq.current) {
        setError(e instanceof Error ? e.message : 'Search failed.');
      }
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, []);

  // Debounced live search as the user types.
  const onChange = useCallback(
    (text: string) => {
      setQuery(text);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => runSearch(text), 450);
    },
    [runSearch],
  );

  const onSubmit = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    Keyboard.dismiss();
    runSearch(query);
  }, [query, runSearch]);

  const clearRecent = useCallback(() => {
    setRecent([]);
    saveRecent([]);
  }, []);

  const openProduct = useCallback((p: Product) => {
    if (p.id) router.push(`/customer/marketplace/${p.id}` as never);
  }, []);

  return (
    <Screen title="Search" subtitle="Find milk, ghee and shops">
      <SearchBar value={query} onChange={onChange} onSubmit={onSubmit} autoFocus />
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.forest} />
        </View>
      ) : error ? (
        <ErrorRetry message={error} onRetry={() => runSearch(submitted || query)} />
      ) : submitted ? (
        results.length === 0 ? (
          <EmptyState title="No matches" message={`Nothing found for "${submitted}". Try another word.`} />
        ) : (
          <FlatList
            data={results}
            keyExtractor={(p, i) => String(p.id ?? i)}
            contentContainerStyle={styles.list}
            renderItem={({ item }) => (
              <Pressable onPress={() => openProduct(item)} style={styles.row}>
                <View style={styles.thumb}>
                  <Text style={styles.thumbText}>{(item.name ?? '?').slice(0, 1).toUpperCase()}</Text>
                </View>
                <View style={styles.col}>
                  <Text style={styles.name} numberOfLines={1}>{item.name ?? 'Product'}</Text>
                  <Text style={styles.sub} numberOfLines={1}>
                    {[item.manager?.center_name, item.category].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                <Text style={styles.price}>{priceOf(item)}</Text>
              </Pressable>
            )}
          />
        )
      ) : (
        <View style={styles.recentWrap}>
          <View style={styles.recentHeader}>
            <Text style={styles.recentTitle}>Recent searches</Text>
            {recent.length > 0 ? (
              <Pressable onPress={clearRecent}>
                <Text style={styles.clearAll}>Clear</Text>
              </Pressable>
            ) : null}
          </View>
          {recent.length === 0 ? (
            <Text style={styles.recentEmpty}>Your recent searches will appear here.</Text>
          ) : (
            recent.map((r) => (
              <Pressable key={r} onPress={() => { setQuery(r); runSearch(r); }} style={styles.recentRow}>
                <Text style={styles.recentText}>{r}</Text>
              </Pressable>
            ))
          )}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 60 },
  list: { paddingHorizontal: 20, paddingBottom: 24 },
  row: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.ivory,
    borderRadius: 16, padding: 12, marginBottom: 10,
  },
  thumb: {
    width: 48, height: 48, borderRadius: 12, backgroundColor: colors.cream,
    alignItems: 'center', justifyContent: 'center', marginRight: 12,
  },
  thumbText: { fontSize: 20, color: colors.forest, fontFamily: 'BricolageGrotesque_700Bold' },
  col: { flex: 1, marginRight: 8 },
  name: { fontSize: 15, color: colors.ink, fontFamily: 'BricolageGrotesque_700Bold' },
  sub: { fontSize: 12, color: colors.sage, marginTop: 2, fontFamily: 'BricolageGrotesque_400Regular' },
  price: { fontSize: 14, color: colors.forest, fontFamily: 'BricolageGrotesque_700Bold' },
  recentWrap: { paddingHorizontal: 20, paddingTop: 8 },
  recentHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  recentTitle: { fontSize: 16, color: colors.ink, fontFamily: 'BricolageGrotesque_700Bold' },
  clearAll: { fontSize: 14, color: colors.danger, fontFamily: 'BricolageGrotesque_400Regular' },
  recentEmpty: { fontSize: 14, color: colors.sage, fontFamily: 'BricolageGrotesque_400Regular' },
  recentRow: {
    backgroundColor: colors.ivory, borderRadius: 12, paddingVertical: 12,
    paddingHorizontal: 16, marginBottom: 8,
  },
  recentText: { fontSize: 15, color: colors.ink, fontFamily: 'BricolageGrotesque_400Regular' },
});
