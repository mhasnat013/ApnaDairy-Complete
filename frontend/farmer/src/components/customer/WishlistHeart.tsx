// Wishlist heart toggle — optimistic update, syncs with backend.
// Used on product cards, product detail, and marketplace rows.
import React, { useState } from 'react';
import { Pressable, Text, StyleSheet } from 'react-native';
import { colors } from '../../theme/colors';
import { addToWishlist, removeFromWishlist } from '../../services/customer/marketplaceService';

interface Props {
  productId: string;
  initialWishlisted: boolean;
  onToggle?: (wishlisted: boolean) => void;
  size?: number;
}

/** Heart button: filled amber when wishlisted, outline otherwise. */
export function WishlistHeart({ productId, initialWishlisted, onToggle, size = 22 }: Props) {
  const [wishlisted, setWishlisted] = useState(initialWishlisted);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (busy) return;
    const next = !wishlisted;
    setWishlisted(next); // optimistic
    onToggle?.(next);
    setBusy(true);
    try {
      if (next) {
        await addToWishlist(productId);
      } else {
        await removeFromWishlist(productId);
      }
    } catch {
      setWishlisted(!next); // roll back on failure
      onToggle?.(!next);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Pressable
      onPress={toggle}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={wishlisted ? 'Remove from wishlist' : 'Add to wishlist'}
      style={[styles.hit, busy && styles.dim]}
    >
      <Text style={[styles.heart, { fontSize: size }, wishlisted ? styles.filled : styles.outline]}>
        {'\u2665'}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hit: { padding: 6 },
  dim: { opacity: 0.5 },
  heart: { fontWeight: '700' },
  filled: { color: colors.amber },
  outline: { color: colors.line },
});
