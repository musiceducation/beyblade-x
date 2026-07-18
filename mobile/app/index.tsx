import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { useRoom } from '@/lib/room-context';
import { authReferee, createRoom, getApiBase, joinAsPlayer } from '@/lib/rooms-api';
import { colors } from '@/lib/theme';
import { ErrorText, Field, Muted, PrimaryButton, Screen, Title } from '@/components/ui';

export default function LobbyScreen() {
  const { ready, session, enter } = useRoom();
  const router = useRouter();
  const [mode, setMode] = useState<'join' | 'create'>('create');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [asReferee, setAsReferee] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (session?.code) router.replace('/room/battle');
  }, [session?.code, router]);

  if (!ready) {
    return (
      <Screen>
        <Muted>載入中…</Muted>
      </Screen>
    );
  }

  if (session?.code) {
    return <Redirect href="/room/battle" />;
  }

  const onCreate = async () => {
    setBusy(true);
    setError('');
    try {
      const data = await createRoom(password);
      await enter({
        code: data.room.code,
        refereeToken: data.refereeToken,
        playerId: null,
        playerName: '',
      });
      router.replace('/room/battle');
    } catch (e) {
      setError(e instanceof Error ? e.message : '開房失敗');
    } finally {
      setBusy(false);
    }
  };

  const onJoin = async () => {
    setBusy(true);
    setError('');
    try {
      let token: string | null = null;
      const roomCode = code.trim().toUpperCase();
      if (asReferee) {
        token = await authReferee(roomCode, password);
      }
      const next = await joinAsPlayer(roomCode, name.trim(), token);
      if (token) next.refereeToken = token;
      await enter(next);
      router.replace(token ? '/room/battle' : '/room/live');
    } catch (e) {
      setError(e instanceof Error ? e.message : '入房失敗');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen style={styles.wrap}>
      <View style={styles.hero}>
        <Text style={styles.mark}>X</Text>
        <Title>BEYBATTLE</Title>
        <Muted>開房比賽 · 計分 · 鏡頭回放</Muted>
        <Text style={styles.api}>API：{getApiBase()}</Text>
      </View>

      <View style={styles.tabs}>
        <Pressable
          onPress={() => setMode('create')}
          style={[styles.tab, mode === 'create' && styles.tabOn]}
        >
          <Text style={styles.tabText}>開房（裁判）</Text>
        </Pressable>
        <Pressable
          onPress={() => setMode('join')}
          style={[styles.tab, mode === 'join' && styles.tabOn]}
        >
          <Text style={styles.tabText}>入房</Text>
        </Pressable>
      </View>

      {mode === 'create' ? (
        <View>
          <Muted>開房後進入對戰計分。請設定裁判密碼。</Muted>
          <View style={{ height: 12 }} />
          <Field
            label="裁判密碼"
            value={password}
            onChangeText={setPassword}
            placeholder="至少 4 個字元"
            secureTextEntry
          />
          <PrimaryButton
            label={busy ? '開房中…' : '建立房間'}
            disabled={busy || password.trim().length < 4}
            onPress={onCreate}
          />
        </View>
      ) : (
        <View>
          <Field
            label="房號"
            value={code}
            onChangeText={(t) => setCode(t.toUpperCase())}
            placeholder="例如 AB12CD"
            autoCapitalize="characters"
          />
          <Field
            label="你的名字"
            value={name}
            onChangeText={setName}
            placeholder="顯示名稱"
            autoCapitalize="words"
          />
          <Pressable
            onPress={() => setAsReferee((v) => !v)}
            style={styles.check}
          >
            <Text style={styles.checkBox}>{asReferee ? '☑' : '☐'}</Text>
            <Text style={styles.checkLabel}>我是裁判（輸入裁判密碼）</Text>
          </Pressable>
          {asReferee && (
            <Field
              label="裁判密碼"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />
          )}
          <PrimaryButton
            label={busy ? '進入中…' : '進入房間'}
            disabled={busy || !code.trim() || !name.trim()}
            onPress={onJoin}
          />
        </View>
      )}

      <ErrorText>{error}</ErrorText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: { justifyContent: 'center' },
  hero: { alignItems: 'center', marginBottom: 24 },
  mark: {
    width: 44,
    height: 44,
    borderRadius: 10,
    overflow: 'hidden',
    textAlign: 'center',
    lineHeight: 44,
    backgroundColor: colors.gold,
    color: '#111',
    fontWeight: '900',
    fontSize: 22,
    marginBottom: 10,
  },
  api: { color: colors.muted, fontSize: 11, marginTop: 10 },
  tabs: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  tab: {
    flex: 1,
    minHeight: 42,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabOn: { borderColor: colors.gold, backgroundColor: 'rgba(255,214,10,0.12)' },
  tabText: { color: colors.text, fontWeight: '700' },
  check: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  checkBox: { color: colors.gold, fontSize: 18 },
  checkLabel: { color: colors.text },
});
