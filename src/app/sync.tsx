import { useEffect, useState, useSyncExternalStore } from 'react';
import { FlatList, Pressable, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { getPeerSyncStore, Item } from '@/lib/peer-sync-store';

export default function SyncScreen() {
  const store = getPeerSyncStore();
  const { deviceId, items, peers, status, syncing } = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot
  );
  const [text, setText] = useState('');
  const theme = useTheme();

  useEffect(() => {
    store.start();
  }, [store]);

  const addItem = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    store.addItem(trimmed);
    setText('');
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="subtitle">Peer Sync</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {status}
        </ThemedText>

        <ThemedView style={styles.inputRow}>
          <TextInput
            style={[
              styles.input,
              { color: theme.text, backgroundColor: theme.backgroundElement },
            ]}
            placeholder="Add a value…"
            placeholderTextColor={theme.textSecondary}
            value={text}
            onChangeText={setText}
            onSubmitEditing={addItem}
            returnKeyType="done"
          />
          <ActionButton label="Add" onPress={addItem} disabled={!text.trim()} />
        </ThemedView>

        <ThemedView type="backgroundElement" style={styles.peersCard}>
          <ThemedText type="smallBold">Nearby devices</ThemedText>
          {peers.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              Searching on this Wi-Fi…
            </ThemedText>
          ) : (
            peers.map((peer) => (
              <ThemedView type="backgroundElement" key={peer.id} style={styles.peerRow}>
                <ThemedText type="small" style={styles.peerName} numberOfLines={1}>
                  {peer.name}
                </ThemedText>
                <ActionButton
                  label={syncing ? 'Syncing…' : 'Sync'}
                  disabled={syncing}
                  onPress={() => store.syncWith(peer.id)}
                />
              </ThemedView>
            ))
          )}
        </ThemedView>

        <FlatList
          style={styles.list}
          contentContainerStyle={styles.listContent}
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <ItemRow item={item} mine={item.authorId === deviceId} />}
          ListEmptyComponent={
            <ThemedText type="small" themeColor="textSecondary" style={styles.emptyText}>
              No values yet — add one above.
            </ThemedText>
          }
        />
      </SafeAreaView>
    </ThemedView>
  );
}

function ItemRow({ item, mine }: { item: Item; mine: boolean }) {
  return (
    <ThemedView type="backgroundElement" style={styles.itemRow}>
      <ThemedText style={styles.itemText}>{item.text}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {mine ? 'you' : item.authorName}
      </ThemedText>
    </ThemedView>
  );
}

function ActionButton({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => (pressed || disabled) && styles.buttonDimmed}>
      <ThemedView type="backgroundSelected" style={styles.button}>
        <ThemedText type="smallBold">{label}</ThemedText>
      </ThemedView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
  },
  safeArea: {
    flex: 1,
    alignSelf: 'stretch',
    alignItems: 'stretch',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    paddingBottom: BottomTabInset + Spacing.three,
    maxWidth: MaxContentWidth,
    width: '100%',
    marginHorizontal: 'auto',
  },
  inputRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  input: {
    flex: 1,
    fontSize: 16,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + Spacing.one,
    borderRadius: Spacing.three,
  },
  peersCard: {
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
  peerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  peerName: {
    flexShrink: 1,
  },
  list: {
    flex: 1,
  },
  listContent: {
    gap: Spacing.two,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + Spacing.one,
    borderRadius: Spacing.three,
  },
  itemText: {
    flexShrink: 1,
  },
  emptyText: {
    textAlign: 'center',
    paddingTop: Spacing.three,
  },
  button: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
  },
  buttonDimmed: {
    opacity: 0.5,
  },
});
