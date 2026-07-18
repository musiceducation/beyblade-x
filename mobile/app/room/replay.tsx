import { useCallback, useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { Video, ResizeMode } from 'expo-av';
import { Screen, Muted, PrimaryButton, ErrorText } from '@/components/ui';
import { useRoom } from '@/lib/room-context';
import { clearLocalReplays, loadLocalReplays } from '@/lib/replays';
import { LocalReplay } from '@/lib/types';
import { colors } from '@/lib/theme';
import {
  cloudToDisplay,
  listCloudReplays,
  uploadPendingReplays,
  uploadReplayToCloud,
} from '@/lib/replay-upload';

type DisplayItem = {
  id: string;
  title: string;
  battleNum: number;
  createdAt: string;
  uri: string;
  cloud: boolean;
  uploaded?: boolean;
  hasVideo?: boolean;
};

export default function ReplayScreen() {
  const { session, isReferee } = useRoom();
  const [items, setItems] = useState<DisplayItem[]>([]);
  const [playing, setPlaying] = useState<DisplayItem | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(0);

  const reload = useCallback(async () => {
    if (!session?.code) return;
    const local = await loadLocalReplays(session.code);
    setPending(local.filter((r) => !r.uploaded).length);

    let cloudItems: DisplayItem[] = [];
    try {
      const cloud = await listCloudReplays(session.code);
      cloudItems = cloud.map(cloudToDisplay);
    } catch (e) {
      console.warn('cloud replays', e);
    }

    const localItems: DisplayItem[] = local.map((r: LocalReplay) => ({
      id: r.id,
      title: r.matchLabel || '對戰',
      battleNum: r.battleNum,
      createdAt: new Date(r.createdAt).toISOString(),
      uri: r.cloudVideoUrl || r.uri,
      cloud: Boolean(r.uploaded && r.cloudVideoUrl),
      uploaded: r.uploaded,
      hasVideo: true,
    }));

    const seen = new Set<string>();
    const merged: DisplayItem[] = [];
    [...localItems, ...cloudItems].forEach((item) => {
      if (seen.has(item.id)) return;
      seen.add(item.id);
      if (item.uri || item.hasVideo) merged.push(item);
    });
    merged.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    setItems(merged);
  }, [session?.code]);

  useEffect(() => {
    reload().catch((e) => setError(e instanceof Error ? e.message : '載入失敗'));
  }, [reload]);

  const uploadAll = async () => {
    if (!session?.refereeToken || !session.code) return;
    setBusy(true);
    setError('');
    try {
      const local = await loadLocalReplays(session.code);
      const n = await uploadPendingReplays(session.code, session.refereeToken, local);
      await reload();
      if (n === 0) setError('沒有待上傳的本機回放');
    } catch (e) {
      setError(e instanceof Error ? e.message : '上傳失敗');
    } finally {
      setBusy(false);
    }
  };

  const uploadOne = async (id: string) => {
    if (!session?.refereeToken || !session.code) return;
    const local = await loadLocalReplays(session.code);
    const replay = local.find((r) => r.id === id);
    if (!replay) return;
    setBusy(true);
    setError('');
    try {
      await uploadReplayToCloud(replay, session.refereeToken);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : '上傳失敗');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Muted>
        本機 + 雲端回放
        {pending > 0 ? ` · ${pending} 段待上傳` : ''}
      </Muted>
      <ErrorText>{error}</ErrorText>

      {isReferee && pending > 0 && (
        <PrimaryButton
          label={busy ? '上傳中…' : `上傳全部 (${pending})`}
          tone="gold"
          disabled={busy}
          onPress={uploadAll}
        />
      )}

      {playing && playing.uri ? (
        <View style={styles.player}>
          <Video
            source={{ uri: playing.uri }}
            style={styles.video}
            useNativeControls
            resizeMode={ResizeMode.CONTAIN}
            shouldPlay
          />
          <PrimaryButton label="關閉播放" tone="ghost" onPress={() => setPlaying(null)} />
        </View>
      ) : null}

      {!items.length ? (
        <Muted>尚未有回放 — 裁判可在「鏡頭」錄製</Muted>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(r) => r.id}
          contentContainerStyle={{ gap: 8, paddingBottom: 40, marginTop: 10 }}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>{item.title} · 第 {item.battleNum} 局</Text>
                <Text style={styles.meta}>
                  {new Date(item.createdAt).toLocaleString()}
                  {item.cloud ? ' · 雲端' : item.uploaded ? ' · 已上傳' : ' · 本機'}
                </Text>
              </View>
              <View style={styles.btns}>
                {!item.cloud && !item.uploaded && isReferee ? (
                  <PrimaryButton
                    label="上傳"
                    tone="ghost"
                    disabled={busy}
                    onPress={() => uploadOne(item.id)}
                  />
                ) : null}
                {item.uri ? (
                  <PrimaryButton label="播放" tone="gold" onPress={() => setPlaying(item)} />
                ) : null}
              </View>
            </View>
          )}
        />
      )}

      {isReferee && items.length > 0 && (
        <PrimaryButton
          label="清除本機快取"
          tone="ghost"
          onPress={async () => {
            await clearLocalReplays(session?.code);
            setPlaying(null);
            await reload();
          }}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  player: { gap: 8, marginVertical: 8 },
  video: {
    width: '100%',
    height: 220,
    backgroundColor: '#000',
    borderRadius: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
  },
  btns: { gap: 6, alignItems: 'flex-end' },
  title: { color: colors.text, fontWeight: '800' },
  meta: { color: colors.muted, fontSize: 12, marginTop: 2 },
});
