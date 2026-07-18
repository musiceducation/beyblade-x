import 'react-native-gesture-handler';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { RoomProvider } from '@/lib/room-context';
import { colors } from '@/lib/theme';

export default function RootLayout() {
  return (
    <RoomProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.elevated },
          headerTintColor: colors.gold,
          headerTitleStyle: { fontWeight: '800' },
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="room" options={{ headerShown: false }} />
      </Stack>
    </RoomProvider>
  );
}
