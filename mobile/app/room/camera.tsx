import { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { Screen, PrimaryButton, Muted, ErrorText } from '@/components/ui';
import { useRoom } from '@/lib/room-context';
import { saveLocalReplay } from '@/lib/replays';
import { uploadReplayToCloud } from '@/lib/replay-upload';
import { getAllMatches } from '@/lib/tournament';
import { colors } from '@/lib/theme';

export default function CameraScreen() {
  const { session, sessionData, isReferee } = useRoom();
  const cameraRef = useRef<CameraView>(null);
  const [camPerm, requestCam] = useCameraPermissions();
  const [micPerm, requestMic] = useMicrophonePermissions();
  const [recording, setRecording] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [battleNum, setBattleNum] = useState(1);

  if (!isReferee) {
    return (
      <Screen>
        <Muted>只有裁判可以錄製鏡頭</Muted>
      </Screen>
    );
  }

  const ensurePerms = async () => {
    if (!camPerm?.granted) {
      const r = await requestCam();
      if (!r.granted) throw new Error('需要相機權限');
    }
    if (!micPerm?.granted) {
      const r = await requestMic();
      if (!r.granted) throw new Error('需要麥克風權限（現場收音）');
    }
  };

  const activeMatchId = sessionData?.activeMatchId || null;
  const activeMatch = activeMatchId
    ? getAllMatches(sessionData).find((m) => m.id === activeMatchId)
    : null;
  const matchLabel = activeMatch?.label || activeMatchId || '對戰';

  const start = async () => {
    setError('');
    setStatus('');
    try {
      await ensurePerms();
      setRecording(true);
      const result = await cameraRef.current?.recordAsync({
        maxDuration: 180,
      });
      setRecording(false);
      if (!result?.uri) return;

      const replayId = `r-${Date.now()}`;
      const label = matchLabel;
      const replay = {
        id: replayId,
        roomCode: session?.code || '',
        matchId: activeMatchId || null,
        matchLabel: label,
        battleNum,
        uri: result.uri,
        createdAt: Date.now(),
        uploaded: false,
      };

      await saveLocalReplay(replay);
      setStatus(`已儲存第 ${battleNum} 段回放`);
      setBattleNum((n) => n + 1);

      if (session?.refereeToken) {
        setUploading(true);
        setStatus(`上傳第 ${battleNum} 段…`);
        try {
          await uploadReplayToCloud(replay, session.refereeToken);
          setStatus(`第 ${battleNum} 段已上傳雲端`);
        } catch (e) {
          setError(e instanceof Error ? e.message : '上傳失敗（已保留本機）');
        } finally {
          setUploading(false);
        }
      }
    } catch (e) {
      setRecording(false);
      setUploading(false);
      setError(e instanceof Error ? e.message : '錄製失敗');
    }
  };

  const stop = () => {
    cameraRef.current?.stopRecording();
  };

  return (
    <Screen style={styles.screen}>
      <Muted>錄製對戰 → 自動上傳雲端（房 {session?.code}）</Muted>
      <View style={styles.preview}>
        {camPerm?.granted ? (
          <CameraView
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            mode="video"
            facing="back"
          />
        ) : (
          <View style={styles.placeholder}>
            <Muted>尚未授權相機</Muted>
            <PrimaryButton
              label="授權相機／咪"
              onPress={() => ensurePerms().catch((e) => setError(e.message))}
            />
          </View>
        )}
      </View>
      <View style={styles.actions}>
        {!recording ? (
          <PrimaryButton
            label={uploading ? '上傳中…' : '開始錄製'}
            tone="red"
            disabled={uploading}
            onPress={start}
          />
        ) : (
          <PrimaryButton label="停止錄製" tone="gold" onPress={stop} />
        )}
        {status ? <Text style={styles.ok}>{status}</Text> : null}
      </View>
      <ErrorText>{error}</ErrorText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { gap: 10 },
  preview: {
    flex: 1,
    minHeight: 320,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 16,
  },
  actions: { gap: 8 },
  ok: { color: colors.green, fontWeight: '700', textAlign: 'center' },
});
