import { Pressable, StyleSheet, Text, TextInput, View, ViewStyle } from 'react-native';
import { colors } from '@/lib/theme';

export function Screen({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.screen, style]}>{children}</View>;
}

export function Title({ children }: { children: React.ReactNode }) {
  return <Text style={styles.title}>{children}</Text>;
}

export function Muted({ children }: { children: React.ReactNode }) {
  return <Text style={styles.muted}>{children}</Text>;
}

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry,
  autoCapitalize,
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  autoCapitalize?: 'none' | 'characters' | 'words' | 'sentences';
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        secureTextEntry={secureTextEntry}
        autoCapitalize={autoCapitalize || 'none'}
        autoCorrect={false}
      />
    </View>
  );
}

export function PrimaryButton({
  label,
  onPress,
  disabled,
  tone = 'gold',
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: 'gold' | 'red' | 'blue' | 'ghost';
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.btn,
        tone === 'gold' && styles.btnGold,
        tone === 'red' && styles.btnRed,
        tone === 'blue' && styles.btnBlue,
        tone === 'ghost' && styles.btnGhost,
        (disabled || pressed) && { opacity: disabled ? 0.45 : 0.85 },
      ]}
    >
      <Text style={[styles.btnText, tone === 'ghost' && { color: colors.text }]}>{label}</Text>
    </Pressable>
  );
}

export function ErrorText({ children }: { children?: string }) {
  if (!children) return null;
  return <Text style={styles.error}>{children}</Text>;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
    padding: 16,
  },
  title: {
    color: colors.gold,
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: 1,
  },
  muted: {
    color: colors.muted,
    fontSize: 14,
    marginTop: 6,
  },
  field: { gap: 6, marginBottom: 12 },
  label: { color: colors.muted, fontSize: 13 },
  input: {
    minHeight: 46,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    color: colors.text,
    paddingHorizontal: 12,
    fontSize: 16,
  },
  btn: {
    minHeight: 46,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  btnGold: { backgroundColor: colors.gold },
  btnRed: { backgroundColor: colors.red },
  btnBlue: { backgroundColor: colors.blue },
  btnGhost: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.border,
  },
  btnText: { color: '#111', fontWeight: '800', fontSize: 15 },
  error: { color: colors.red, marginTop: 10, fontSize: 14 },
});
