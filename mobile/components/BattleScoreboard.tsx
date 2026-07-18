import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Match, SessionData } from '@/lib/types';
import { playerName, readyMatches } from '@/lib/tournament';
import { PHASE_LABELS, colors } from '@/lib/theme';
import { PrimaryButton, ErrorText, Muted } from './ui';

type FinishType = 'spin' | 'burst' | 'over' | 'extreme';

const FINISH: Record<FinishType, { zh: string; pts: number }> = {
  spin: { zh: '殘存', pts: 1 },
  burst: { zh: '爆裂', pts: 2 },
  over: { zh: '擊飛', pts: 2 },
  extreme: { zh: '極致', pts: 3 },
};

type Props = {
  sessionData: SessionData | null;
  onAction: (action: string, payload?: Record<string, unknown>) => Promise<void>;
};

export default function BattleScoreboard({ sessionData, onAction }: Props) {
  const matches = useMemo(() => readyMatches(sessionData), [sessionData]);
  const [matchId, setMatchId] = useState<string | null>(null);
  const [scores, setScores] = useState<[number, number]>([0, 0]);
  const [battle, setBattle] = useState(1);
  const [target] = useState(4);
  const [history, setHistory] = useState<
    { scores: [number, number]; battle: number }[]
  >([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [call, setCall] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const active: Match | null = useMemo(() => {
    const id = matchId || sessionData?.activeMatchId || null;
    if (!id) return null;
    return matches.find((m) => m.id === id)
      || (sessionData ? readyMatches(sessionData).find((m) => m.id === id) : null)
      || null;
  }, [matchId, sessionData, matches]);

  useEffect(() => {
    if (!active) return;
    const live = active.liveScores;
    setScores(live ? [live[0] || 0, live[1] || 0] : [0, 0]);
    setBattle(active.liveBattles || 1);
    setHistory([]);
  }, [active?.id]);

  const run = async (action: string, payload?: Record<string, unknown>) => {
    setBusy(true);
    setError('');
    try {
      await onAction(action, payload);
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失敗');
      throw e;
    } finally {
      setBusy(false);
    }
  };

  const pushLive = (next: [number, number], nextBattle: number, id: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      run('set_live_scores', { matchId: id, scores: next, battles: nextBattle }).catch(() => {});
    }, 160);
  };

  const selectMatch = async (id: string) => {
    const m = matches.find((x) => x.id === id);
    const next: [number, number] = m?.liveScores
      ? [m.liveScores[0] || 0, m.liveScores[1] || 0]
      : [0, 0];
    const b = m?.liveBattles || 1;
    setMatchId(id);
    setScores(next);
    setBattle(b);
    setHistory([]);
    try {
      await run('set_active', { matchId: id });
      await run('set_live_scores', { matchId: id, scores: next, battles: b });
    } catch {
      /* shown */
    }
  };

  const apply = (next: [number, number], nextBattle = battle) => {
    if (!active) return;
    setHistory((h) => [...h, { scores: [...scores] as [number, number], battle }]);
    setScores(next);
    setBattle(nextBattle);
    pushLive(next, nextBattle, active.id);
    if (next[0] >= target || next[1] >= target) {
      const side: 1 | 2 = next[0] >= target ? 1 : 2;
      setTimeout(() => finish(side, next).catch(() => {}), 250);
    }
  };

  const award = async (player: 1 | 2, type: FinishType) => {
    if (!active || busy || active.status === 'done') return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const pts = FINISH[type].pts;
    const next: [number, number] = [...scores];
    next[player - 1] += pts;
    setCall(`Blader ${player} · ${FINISH[type].zh} +${pts}`);
    apply(next);
  };

  const finish = async (winnerSide: 1 | 2, finalScores = scores) => {
    if (!active || active.status === 'done') return;
    await run('record_winner', {
      matchId: active.id,
      winnerSide,
      scores: finalScores,
      battles: battle,
      autoAdvance: false,
    });
    setCall(`${playerName(sessionData, winnerSide === 1 ? active.p1Id : active.p2Id)} 勝`);
    setMatchId(null);
  };

  const undo = () => {
    if (!history.length || !active) return;
    const last = history[history.length - 1]!;
    setHistory((h) => h.slice(0, -1));
    setScores(last.scores);
    setBattle(last.battle);
    setCall('已撤銷');
    pushLive(last.scores, last.battle, active.id);
  };

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Muted>選擇場次後用 Finish 計分 · {target} 分制</Muted>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.matchRow}>
        {matches.map((m) => (
          <Pressable
            key={m.id}
            onPress={() => selectMatch(m.id)}
            style={[styles.chip, active?.id === m.id && styles.chipOn]}
          >
            <Text style={styles.chipText}>
              {m.label || m.id}
            </Text>
            <Text style={styles.chipSub}>
              {playerName(sessionData, m.p1Id)} vs {playerName(sessionData, m.p2Id)}
            </Text>
          </Pressable>
        ))}
        {!matches.length && <Text style={styles.empty}>暫無可計分場次 — 先去「裁判」抽籤</Text>}
      </ScrollView>

      <View style={styles.center}>
        <Text style={styles.round}>第 {battle} 局</Text>
        <Text style={styles.phase}>
          {active ? (active.label || PHASE_LABELS[active.phase] || active.phase) : '尚未選場'}
        </Text>
        <Text style={styles.call}>{call || '得分判定'}</Text>
        <Text style={styles.scoreline}>
          <Text style={{ color: colors.red }}>{scores[0]}</Text>
          {' : '}
          <Text style={{ color: colors.blue }}>{scores[1]}</Text>
        </Text>
      </View>

      <View style={styles.grid}>
        <PlayerCol
          side={1}
          name={active ? playerName(sessionData, active.p1Id) : 'Blader 1'}
          score={scores[0]}
          disabled={!active || busy}
          onAward={(t) => award(1, t)}
          onAdjust={(d) => {
            if (!active) return;
            const next: [number, number] = [...scores];
            next[0] = Math.max(0, next[0] + d);
            apply(next);
          }}
        />
        <PlayerCol
          side={2}
          name={active ? playerName(sessionData, active.p2Id) : 'Blader 2'}
          score={scores[1]}
          disabled={!active || busy}
          onAward={(t) => award(2, t)}
          onAdjust={(d) => {
            if (!active) return;
            const next: [number, number] = [...scores];
            next[1] = Math.max(0, next[1] + d);
            apply(next);
          }}
        />
      </View>

      <View style={styles.actions}>
        <PrimaryButton
          label="下一局"
          tone="ghost"
          disabled={!active || busy}
          onPress={() => {
            if (!active) return;
            const b = battle + 1;
            setBattle(b);
            setCall(`第 ${b} 局`);
            pushLive(scores, b, active.id);
          }}
        />
        <PrimaryButton label="撤銷" tone="ghost" disabled={!history.length || busy} onPress={undo} />
        <PrimaryButton
          label="手動完場"
          tone="gold"
          disabled={!active || busy}
          onPress={() => finish(scores[0] >= scores[1] ? 1 : 2)}
        />
      </View>
      <ErrorText>{error}</ErrorText>
    </ScrollView>
  );
}

function PlayerCol({
  side,
  name,
  score,
  disabled,
  onAward,
  onAdjust,
}: {
  side: 1 | 2;
  name: string;
  score: number;
  disabled: boolean;
  onAward: (t: FinishType) => void;
  onAdjust: (d: number) => void;
}) {
  const accent = side === 1 ? colors.red : colors.blue;
  return (
    <View style={[styles.player, { borderColor: accent }]}>
      <Text style={styles.blader}>Blader {side}</Text>
      <Text style={[styles.name, { color: accent }]}>{name}</Text>
      <Text style={styles.bigScore}>{score}</Text>
      <View style={styles.adj}>
        <Pressable disabled={disabled} onPress={() => onAdjust(-1)} style={styles.adjBtn}>
          <Text style={styles.adjText}>−</Text>
        </Pressable>
        <Pressable disabled={disabled} onPress={() => onAdjust(1)} style={styles.adjBtn}>
          <Text style={styles.adjText}>+</Text>
        </Pressable>
      </View>
      <View style={styles.finishes}>
        {(Object.keys(FINISH) as FinishType[]).map((type) => (
          <Pressable
            key={type}
            disabled={disabled}
            onPress={() => onAward(type)}
            style={styles.finish}
          >
            <Text style={styles.finishName}>{FINISH[type].zh}</Text>
            <Text style={styles.finishPts}>+{FINISH[type].pts}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12, paddingBottom: 40 },
  matchRow: { maxHeight: 78 },
  chip: {
    marginRight: 8,
    padding: 10,
    borderRadius: 10,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    minWidth: 140,
  },
  chipOn: { borderColor: colors.gold },
  chipText: { color: colors.gold, fontWeight: '700', fontSize: 13 },
  chipSub: { color: colors.muted, fontSize: 11, marginTop: 2 },
  empty: { color: colors.muted, paddingVertical: 8 },
  center: { alignItems: 'center', gap: 4, paddingVertical: 8 },
  round: { color: colors.gold, fontSize: 18, fontWeight: '800' },
  phase: { color: colors.muted },
  call: { color: colors.text, opacity: 0.8 },
  scoreline: { color: colors.text, fontSize: 36, fontWeight: '900', marginTop: 4 },
  grid: { flexDirection: 'row', gap: 8 },
  player: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    backgroundColor: colors.card,
    gap: 6,
  },
  blader: { color: colors.muted, fontSize: 11, textTransform: 'uppercase' },
  name: { fontWeight: '800', fontSize: 15 },
  bigScore: { color: colors.text, fontSize: 34, fontWeight: '900' },
  adj: { flexDirection: 'row', gap: 6 },
  adjBtn: {
    flex: 1,
    minHeight: 36,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  adjText: { color: colors.text, fontSize: 18, fontWeight: '700' },
  finishes: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  finish: {
    width: '47%',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 8,
    alignItems: 'center',
    backgroundColor: colors.elevated,
  },
  finishName: { color: colors.text, fontWeight: '700', fontSize: 13 },
  finishPts: { color: colors.gold, fontSize: 11 },
  actions: { gap: 8 },
});
