export const colors = {
  bg: '#070b12',
  elevated: '#0e1420',
  card: '#121a28',
  border: 'rgba(255,255,255,0.09)',
  text: '#e8ecf4',
  muted: '#8b95a8',
  red: '#ff2d55',
  blue: '#00d4ff',
  gold: '#ffd60a',
  green: '#34c759',
};

export const SESSION_LABELS = {
  junior: 'BEYBATTLE',
  senior: 'BEYBATTLE',
} as const;

export const PHASE_LABELS: Record<string, string> = {
  prelim: '初賽',
  revival: '復活賽',
  quarter: '複賽',
  challenge: '四強挑戰',
  semi: '準決賽',
  final: '決賽',
};
