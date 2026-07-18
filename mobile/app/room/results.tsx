import { FlatList, StyleSheet, Text, View } from 'react-native';
import { Screen, Muted, ErrorText } from '@/components/ui';
import { useRoom } from '@/lib/room-context';
import { getAllMatches, playerName } from '@/lib/tournament';
import { PHASE_LABELS, colors } from '@/lib/theme';

export default function ScheduleScreen() {
  const { sessionData, error } = useRoom();
  const matches = getAllMatches(sessionData);

  return (
    <Screen>
      <ErrorText>{error}</ErrorText>
      {!matches.length ? (
        <Muted>尚未有賽程（裁判抽籤後出現）</Muted>
      ) : (
        <FlatList
          data={matches}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ gap: 8, paddingBottom: 40 }}
          renderItem={({ item }) => {
            const scores = item.status === 'done' ? item.scores : item.liveScores;
            return (
              <View style={styles.row}>
                <Text style={styles.label}>
                  {item.label || PHASE_LABELS[item.phase] || item.phase}
                </Text>
                <Text style={styles.names}>
                  {playerName(sessionData, item.p1Id)} vs {playerName(sessionData, item.p2Id)}
                </Text>
                <Text style={styles.meta}>
                  {item.status === 'done' ? '完場' : '待賽'}
                  {scores ? ` · ${scores[0]}:${scores[1]}` : ''}
                </Text>
              </View>
            );
          }}
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
  label: { color: colors.gold, fontWeight: '800', fontSize: 13 },
  names: { color: colors.text, fontWeight: '700' },
  meta: { color: colors.muted, fontSize: 12 },
});
