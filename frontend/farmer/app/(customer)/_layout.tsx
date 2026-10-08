// ApnaDairy — customer group layout (customer home, marketplace, ...).
// Plain Stack; headers stay hidden, screens render their own UI.
import React from 'react';
import { Stack } from 'expo-router';

export default function CustomerLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
