// Customer addresses: list, add, edit, delete, set default.
import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, Alert, TextInput, Switch, Modal } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Screen } from '../../../src/components/common/Screen';
import { Card } from '../../../src/components/common/Card';
import { AppButton } from '../../../src/components/common/AppButton';
import { colors } from '../../../src/theme/colors';
import {
  listAddresses, createAddress, updateAddress, deleteAddress, setDefaultAddress,
  type Address, type AddressForm,
} from '../../../src/services/customer/accountService';

const EMPTY: AddressForm = { label: '', recipient_name: '', phone: '', address_line: '', city: '', is_default: false };

export default function AddressesScreen() {
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<Address | null>(null);
  const [form, setForm] = useState<AddressForm>(EMPTY);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setAddresses(await listAddresses());
    } catch (e) {
      Alert.alert('Error', (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openAdd = () => { setEditing(null); setForm(EMPTY); setModalVisible(true); };
  const openEdit = (a: Address) => {
    setEditing(a);
    setForm({ label: a.label, recipient_name: a.recipient_name, phone: a.phone, address_line: a.address_line, city: a.city, is_default: !!a.is_default });
    setModalVisible(true);
  };

  const set = (k: keyof AddressForm, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  const validate = (): string | null => {
    if (!form.label.trim()) return 'Enter a label (e.g. Home).';
    if (!form.recipient_name.trim()) return "Enter the recipient's name.";
    if (!/^[+()\-.\\s\\d]{7,20}$/.test(form.phone)) return 'Enter a valid phone number.';
    if (!form.address_line.trim()) return 'Enter the address.';
    if (!form.city.trim()) return 'Enter the city.';
    return null;
  };

  const save = async () => {
    const err = validate();
    if (err) { Alert.alert('Missing', err); return; }
    setSaving(true);
    try {
      if (editing) await updateAddress(editing.id, form);
      else await createAddress(form);
      setModalVisible(false);
      await load();
    } catch (e) {
      Alert.alert('Error', (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = (a: Address) => {
    Alert.alert('Delete', `Delete the "${a.label}" address?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          try { await deleteAddress(a.id); await load(); }
          catch (e) { Alert.alert('Error', (e as Error).message); }
        },
      },
    ]);
  };

  const makeDefault = async (a: Address) => {
    try { await setDefaultAddress(a.id); await load(); }
    catch (e) { Alert.alert('Error', (e as Error).message); }
  };

  return (
    <Screen title="Addresses" subtitle="Delivery addresses">
      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.forest} /></View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          {addresses.map((a) => (
            <Card key={a.id} style={styles.card}>
              <View style={styles.row}>
                <View style={styles.info}>
                  <Text style={styles.label}>{a.label}{a.is_default ? '  •  Default' : ''}</Text>
                  <Text style={styles.detail}>{a.recipient_name} — {a.phone}</Text>
                  <Text style={styles.detail}>{a.address_line}, {a.city}</Text>
                </View>
              </View>
              <View style={styles.actions}>
                <Pressable onPress={() => openEdit(a)}><Text style={styles.action}>Edit</Text></Pressable>
                {!a.is_default && (
                  <Pressable onPress={() => makeDefault(a)}><Text style={styles.action}>Set default</Text></Pressable>
                )}
                <Pressable onPress={() => remove(a)}><Text style={[styles.action, styles.danger]}>Delete</Text></Pressable>
              </View>
            </Card>
          ))}
          {addresses.length === 0 && (
            <Text style={styles.empty}>No addresses yet. Add one below.</Text>
          )}
          <AppButton label="Add address" onPress={openAdd} />
        </ScrollView>
      )}

      <Modal visible={modalVisible} animationType="slide" transparent>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>{editing ? 'Edit address' : 'New address'}</Text>
            {(['label', 'recipient_name', 'phone', 'address_line', 'city'] as const).map((k) => (
              <TextInput
                key={k}
                style={styles.input}
                placeholder={k.replace('_', ' ')}
                placeholderTextColor={colors.sage}
                value={String(form[k])}
                onChangeText={(v) => set(k, v)}
                keyboardType={k === 'phone' ? 'phone-pad' : 'default'}
              />
            ))}
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Default address</Text>
              <Switch
                value={!!form.is_default}
                onValueChange={(v) => set('is_default', v)}
                trackColor={{ true: colors.forest, false: colors.line }}
              />
            </View>
            <AppButton label={editing ? 'Save' : 'Add'} onPress={save} loading={saving} />
            <Pressable style={styles.cancel} onPress={() => setModalVisible(false)}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingBottom: 32 },
  card: { marginBottom: 12 },
  row: { flexDirection: 'row' },
  info: { flex: 1 },
  label: { fontSize: 16, color: colors.ink, fontFamily: 'BricolageGrotesque_700Bold' },
  detail: { fontSize: 14, color: colors.sage, marginTop: 4 },
  actions: { flexDirection: 'row', marginTop: 12, gap: 20 },
  action: { fontSize: 14, fontWeight: '600', color: colors.forest },
  danger: { color: colors.danger },
  empty: { textAlign: 'center', color: colors.sage, marginVertical: 24, fontSize: 15 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.ivory, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 32 },
  sheetTitle: { fontSize: 20, color: colors.ink, fontFamily: 'BricolageGrotesque_700Bold', marginBottom: 16 },
  input: {
    backgroundColor: colors.cream, borderRadius: 12, padding: 14, marginBottom: 10,
    fontSize: 16, color: colors.ink, borderWidth: 1, borderColor: colors.line,
  },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginVertical: 8 },
  switchLabel: { fontSize: 16, color: colors.ink, fontWeight: '600' },
  cancel: { alignItems: 'center', marginTop: 12 },
  cancelText: { fontSize: 15, color: colors.sage, fontWeight: '600' },
});
