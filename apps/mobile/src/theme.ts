/**
 * MedAssist visual identity — clean clinical theme.
 * Teal (medical) + navy (trust) on white. No emojis in UI; use @expo/vector-icons.
 */

export const colors = {
  background: '#FFFFFF',
  surface: '#F7FAFA',
  surfaceAlt: '#EEF5F5',
  primary: '#0E7C7B', // medical teal
  primaryDark: '#0A5E5D',
  primarySoft: '#E0F2F1',
  navy: '#16324F', // headings / trust
  text: '#1A2B3C',
  textMuted: '#5C7288',
  border: '#DCE7E7',
  danger: '#C0392B',
  dangerSoft: '#FDECEA',
  warning: '#B7791F',
  warningSoft: '#FFF6E0',
  success: '#1E7E34',
  successSoft: '#E6F4EA',
  info: '#1D6FA5',
  infoSoft: '#E8F1FA',
  bubbleUser: '#0E7C7B',
  bubbleUserText: '#FFFFFF',
  bubbleAssistant: '#F1F5F5',
  star: '#E8A100',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
} as const;

/** Font family name registered via expo-font (IBM Plex Sans Arabic). Falls back to system. */
export const fontFamily = {
  regular: 'IBMPlexSansArabic_400Regular',
  medium: 'IBMPlexSansArabic_500Medium',
  bold: 'IBMPlexSansArabic_700Bold',
} as const;

export const fontSize = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 20,
  xl: 26,
} as const;
