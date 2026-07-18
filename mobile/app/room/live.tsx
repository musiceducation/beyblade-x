import { FlatList, StyleSheet, Text, View } from 'react-native';
import { Screen, Muted, ErrorText } from '@/components/ui';
import { useRoom } from '@/lib/room-context';
import { getAllMatches, playerName } from '@/lib/tournament';
import { colors } from '@/lib/theme';

export default function ResultsScreen() {
  const { sessionData, error } = useRoom();
  const done = getAllMatches(sessionData).filter((m) => m.status === 'done');

  return (
    <Screen>
      <ErrorText>{error}</ErrorText>
      {!done.length ? (
        <Muted>尚未有完場成績</Muted>
      ) : (
        <FlatList
          data={done}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ gap: 8, paddingBottom: 40 }}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <Text style={styles.label}>{item.label || item.id}</Text>
              <Text style={styles.names}>
                {playerName(sessionData, item.p1Id)} vs {playerName(sessionData, item.p2Id)}
              </Text>
              <Text style={styles.win}>
                勝方：{playerName(sessionData, item.winnerId)}
                {item.scores ? ` · ${item.scores[0]}:${item.scores[1]}` : ''}
              </Text>
            </View>
          )}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    gap: 4,
  },
  label: { color: colors.gold, fontWeight: '800' },
  names: { color: colors.text },
  win: { color: colors.green, fontWeight: '700' },
});
