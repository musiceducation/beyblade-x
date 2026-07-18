import { Redirect, Tabs } from 'expo-router';
import { Text } from 'react-native';
import { useRoom } from '@/lib/room-context';
import { colors } from '@/lib/theme';

export default function RoomLayout() {
  const { ready, session, isReferee } = useRoom();

  if (!ready) return null;
  if (!session?.code) return <Redirect href="/" />;

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.elevated },
        headerTintColor: colors.gold,
        tabBarStyle: {
          backgroundColor: colors.elevated,
          borderTopColor: colors.border,
        },
        tabBarActiveTintColor: colors.gold,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '700' },
      }}
    >
      <Tabs.Screen
        name="battle"
        options={{
          title: '計分',
          href: isReferee ? undefined : null,
          tabBarIcon: ({ color }) => <Text style={{ color }}>⚔</Text>,
        }}
      />
      <Tabs.Screen
        name="live"
        options={{
          title: '直播',
          tabBarIcon: ({ color }) => <Text style={{ color }}>◉</Text>,
        }}
      />
      <Tabs.Screen
        name="schedule"
        options={{
          title: '賽程',
          tabBarIcon: ({ color }) => <Text style={{ color }}>☰</Text>,
        }}
      />
      <Tabs.Screen
        name="results"
        options={{
          title: '成績',
          tabBarIcon: ({ color }) => <Text style={{ color }}>★</Text>,
        }}
      />
      <Tabs.Screen
        name="camera"
        options={{
          title: '鏡頭',
          href: isReferee ? undefined : null,
          tabBarIcon: ({ color }) => <Text style={{ color }}>◎</Text>,
        }}
      />
      <Tabs.Screen
        name="replay"
        options={{
          title: '回放',
          tabBarIcon: ({ color }) => <Text style={{ color }}>▶</Text>,
        }}
      />
      <Tabs.Screen
        name="referee"
        options={{
          title: '裁判',
          href: isReferee ? undefined : null,
          tabBarIcon: ({ color }) => <Text style={{ color }}>⚙</Text>,
        }}
      />
    </Tabs>
  );
}
