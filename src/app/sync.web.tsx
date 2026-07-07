import { StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

// Local-network discovery and TCP sockets do not exist in browsers, so the
// peer-sync demo is native-only.
export default function SyncScreen() {
  return (
    <ThemedView style={styles.container}>
      <ThemedText themeColor="textSecondary">
        Peer sync needs a real device — open this tab on Android or iOS.
      </ThemedText>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },
});
