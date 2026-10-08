// Customer root — redirects to the Home tab.
import React, { useEffect } from 'react';
import { router } from 'expo-router';
import { View, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../../src/theme/colors';

export default function CustomerIndex(): React.JSX.Element {
  useEffect(() => {
    router.replace('/customer/home');
  }, []);
  return (
    <SafeAreaView style={{ flex: 1 }} edges={['top']}>
<View style={{ flex: 1, backgroundColor: colors.cream, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator size="large" color={colors.forest} />
    </View>
    </SafeAreaView>
  );
}
