import { FlatList, StyleSheet, Text, View } from 'react-native';
import { Screen, Muted, ErrorText } from '@/components/ui';
import { useRoom } from '@/lib/room-context';
import { getAllMatches, playerName, sessionStats } from '@/lib/tournament';
import { ArenaLiveState } from '@/lib/types';
import { PHASE_LABELS, colors } from '@/lib/theme';

function isFreshOverlay(overlay: ArenaLiveState | null | undefined, sessionKey: string) {
  return Boolean(
    overlay?.active
    && overlay.updatedAt
    && overlay.session === sessionKey
    && Date.now() - overlay.updatedAt < 60000
    && !overlay.matchOver,
  );
}

export default function LiveScreen() {
  const { sessionData, room, sessionKey, error } = useRoom();
  const overlay = (room?.live || null) as ArenaLiveState | null;
  const matches = getAllMatches(sessionData);
  const stats = sessionStats(matches);
  const active = matches.find((m) => m.id === sessionData?.activeMatchId);
  const activeValid = active?.p1Id && active?.p2Id ? active : null;
  const upcoming = matches
    .filter((m) => m.status === 'pending' && m.p1Id && m.p2Id)
    .slice(0, 4);
  const recent = matches
    .filter((m) => m.status === 'done' && (m.p1Id || m.p2Id))
    .slice(-3)
    .reverse();
  const fresh = isFreshOverlay(overlay, sessionKey);

  if (!sessionData?.drawn) {
    return (
      <Screen>
        <ErrorText>{error}</ErrorText>
        <Muted>尚未抽籤 — 賽程建立後會顯示即時比分</Muted>
      </Screen>
    );
  }

  const heroTitle = fresh
    ? overlay?.matchLabel || PHASE_LABELS[overlay?.phase || ''] || '對戰'
    : activeValid?.label || PHASE_LABELS[activeValid?.phase || ''] || '對戰';
  const p1Name = fresh
    ? overlay?.p1Name || 'Blader 1'
    : playerName(sessionData, activeValid?.p1Id);
  const p2Name = fresh
    ? overlay?.p2Name || 'Blader 2'
    : playerName(sessionData, activeValid?.p2Id);
  const scores = fresh
    ? overlay?.scores || [0, 0]
    : activeValid?.liveScores || activeValid?.scores || [0, 0];
  const battle = fresh
    ? overlay?.battle
    : activeValid?.liveBattles || activeValid?.battles;

  return (
    <Screen>
      <ErrorText>{error}</ErrorText>

      <View style={styles.summary}>
        <Text style={styles.summaryStat}>{stats.done} 已完</Text>
        <View style={styles.summaryBar}>
          <View style={[styles.summaryFill, { width: `${stats.pct}%` }]} />
        </View>
        <Text style={styles.summaryStat}>{stats.total} 總場</Text>
      </View>

      {fresh || activeValid ? (
        <View style={styles.hero}>
          <Text style={styles.heroLabel}>進行中</Text>
          <Text style={styles.heroTitle}>{heroTitle}</Text>
          <View style={styles.scoreRow}>
            <View style={styles.player}>
              <Text style={styles.p1Name}>{p1Name}</Text>
              <Text style={styles.p1Score}>{scores[0]}</Text>
            </View>
            <Text style={styles.vs}>VS</Text>
            <View style={[styles.player, styles.playerRight]}>
              <Text style={styles.p2Name}>{p2Name}</Text>
              <Text style={styles.p2Score}>{scores[1]}</Text>
            </View>
          </View>
          <Text style={styles.battle}>
            {battle ? `第 ${battle} 局` : '比賽進行中'}
          </Text>
        </View>
      ) : (
        <Muted>目前沒有進行中的對戰{stats.pending > 0 ? ` · ${stats.pending} 場待賽` : ''}</Muted>
      )}

      {upcoming.length > 0 && (
        <>
          <Text style={styles.blockTitle}>即將開始</Text>
          <FlatList
            data={upcoming}
            keyExtractor={(m) => m.id}
            scrollEnabled={false}
            contentContainerStyle={{ gap: 8, marginBottom: 12 }}
            renderItem={({ item }) => (
              <View style={styles.row}>
                <Text style={styles.label}>{item.label || PHASE_LABELS[item.phase] || item.phase}</Text>
                <Text style={styles.names}>
                  {playerName(sessionData, item.p1Id)} vs {playerName(sessionData, item.p2Id)}
                </Text>
              </View>
            )}
          />
        </>
      )}

      {recent.length > 0 && (
        <>
          <Text style={styles.blockTitle}>最近結果</Text>
          <FlatList
            data={recent}
            keyExtractor={(m) => m.id}
            scrollEnabled={false}
            contentContainerStyle={{ gap: 8, paddingBottom: 40 }}
            renderItem={({ item }) => (
              <View style={styles.row}>
                <Text style={styles.label}>{item.label || PHASE_LABELS[item.phase] || item.phase}</Text>
                <Text style={styles.names}>
                  {playerName(sessionData, item.p1Id)} vs {playerName(sessionData, item.p2Id)}
                </Text>
                <Text style={styles.meta}>
                  勝方：{playerName(sessionData, item.winnerId)}
                  {item.scores ? ` · ${item.scores[0]}:${item.scores[1]}` : ''}
                </Text>
              </View>
            )}
          />
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
  },
  summaryStat: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  summaryBar: {
    flex: 1,
    height: 6,
    borderRadius: 999,
    backgroundColor: colors.border,
    overflow: 'hidden',
  },
  summaryFill: { height: '100%', backgroundColor: colors.gold },
  hero: {
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 8,
    marginBottom: 14,
  },
  heroLabel: { color: colors.muted, fontSize: 11, letterSpacing: 1 },
  heroTitle: { color: colors.gold, fontWeight: '800', fontSize: 16 },
  scoreRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  player: { flex: 1, minWidth: 0 },
  playerRight: { alignItems: 'flex-end' },
  p1Name: { color: colors.red, fontWeight: '700' },
  p1Score: { color: colors.red, fontSize: 34, fontWeight: '900', lineHeight: 38 },
  p2Name: { color: colors.blue, fontWeight: '700', textAlign: 'right' },
  p2Score: { color: colors.blue, fontSize: 34, fontWeight: '900', lineHeight: 38, textAlign: 'right' },
  vs: { color: colors.muted, fontWeight: '800' },
  battle: { color: colors.muted, fontSize: 12 },
  blockTitle: { color: colors.gold, fontWeight: '800', marginBottom: 8 },
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
