import { useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { Screen, Field, PrimaryButton, ErrorText, Muted } from '@/components/ui';
import { useRoom } from '@/lib/room-context';
import { readyMatches } from '@/lib/tournament';
import { colors } from '@/lib/theme';
import { getApiBase } from '@/lib/rooms-api';
import * as Linking from 'expo-linking';

export default function RefereeScreen() {
  const { session, sessionData, action, leave } = useRoom();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const players = sessionData?.players || [];
  const ready = readyMatches(sessionData);

  const run = async (act: string, payload?: Record<string, unknown>) => {
    setBusy(true);
    setError('');
    try {
      await action(act, payload);
    } catch (e) {
      setError(e instanceof Error ? e.message : '失敗');
    } finally {
      setBusy(false);
    }
  };

  const liveUrl = `${getApiBase()}/live/${encodeURIComponent(session?.code || '')}`;

  return (
    <Screen>
      <Muted>房號 {session?.code} · 分享給選手入房</Muted>
      <View style={{ height: 10 }} />
      <Field
        label="新增選手"
        value={name}
        onChangeText={setName}
        placeholder="名字"
        autoCapitalize="words"
      />
      <PrimaryButton
        label="加入名單"
        disabled={busy || !name.trim()}
        onPress={async () => {
          await run('add_player', { name: name.trim() });
          setName('');
        }}
      />

      <FlatList
        style={{ marginTop: 12, maxHeight: 180 }}
        data={players}
        keyExtractor={(p) => p.id}
        ListEmptyComponent={<Muted>尚未有選手</Muted>}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Text style={styles.name}>{item.name}</Text>
            <PrimaryButton
              label="刪"
              tone="ghost"
              disabled={busy}
              onPress={() => run('remove_player', { playerId: item.id })}
            />
          </View>
        )}
      />

      <View style={styles.actions}>
        <PrimaryButton
          label={sessionData?.drawn ? '重新抽籤' : '抽籤產生賽程'}
          disabled={busy || players.length < 2}
          onPress={() => run('run_draw')}
        />
        <PrimaryButton
          label="重設賽程"
          tone="ghost"
          disabled={busy || !sessionData?.drawn}
          onPress={() => run('reset_schedule')}
        />
        <PrimaryButton
          label="開啟直播畫面（OBS）"
          tone="blue"
          onPress={() => Linking.openURL(liveUrl)}
        />
        <Muted>可計分場次：{ready.length}</Muted>
        <PrimaryButton label="離開房間" tone="ghost" onPress={() => leave()} />
      </View>
      <ErrorText>{error}</ErrorText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  name: { color: colors.text, fontWeight: '700' },
  actions: { gap: 8, marginTop: 16 },
});
