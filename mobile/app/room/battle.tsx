import { useLayoutEffect } from 'react';
import { Pressable, Text } from 'react-native';
import { useNavigation } from 'expo-router';
import BattleScoreboard from '@/components/BattleScoreboard';
import { Screen, ErrorText, Muted } from '@/components/ui';
import { useRoom } from '@/lib/room-context';
import { colors } from '@/lib/theme';

export default function BattleScreen() {
  const { session, sessionData, action, error, leave, isReferee } = useRoom();
  const navigation = useNavigation();

  useLayoutEffect(() => {
    navigation.setOptions({
      title: `BEYBATTLE · ${session?.code || ''}`,
      headerRight: () => (
        <Pressable onPress={() => leave()} style={{ paddingHorizontal: 8 }}>
          <Text style={{ color: colors.muted, fontWeight: '700' }}>離開</Text>
        </Pressable>
      ),
    });
  }, [navigation, session?.code, leave]);

  if (!isReferee) {
    return (
      <Screen>
        <Muted>只有裁判可以計分</Muted>
      </Screen>
    );
  }

  return (
    <Screen>
      <ErrorText>{error}</ErrorText>
      <BattleScoreboard sessionData={sessionData} onAction={action} />
    </Screen>
  );
}
