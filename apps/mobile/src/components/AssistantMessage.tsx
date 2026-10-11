/**
 * AssistantMessage — renders an assistant answer with clinical structure:
 * - EmergencyBanner when escalated
 * - "Documented knowledge" vs "Model inference" sections visually separated
 * - CitationCard per source, ConfidenceBadge, DisclaimerBanner
 */
import React from 'react';
import { Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Markdown from 'react-native-markdown-display';
import { MaterialIcons } from '@expo/vector-icons';
import { colors, fontFamily, fontSize, radius, spacing } from '../theme';
import { t, type I18nKey, type Lang } from '../i18n';
import { parseMessageSections } from '../lib/parseMessage';
import type { ChatResponse, Citation } from '../api/client';

function ConfidenceBadge({ value, lang }: { value: number; lang: Lang }) {
  const level = value >= 0.75 ? 'high' : value >= 0.5 ? 'medium' : 'low';
  const key: I18nKey =
    level === 'high' ? 'msg.confidenceHigh' : level === 'medium' ? 'msg.confidenceMedium' : 'msg.confidenceLow';
  const bg = level === 'high' ? colors.successSoft : level === 'medium' ? colors.warningSoft : colors.dangerSoft;
  const fg = level === 'high' ? colors.success : level === 'medium' ? colors.warning : colors.danger;
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <MaterialIcons name="verified" size={14} color={fg} />
      <Text style={[styles.badgeText, { color: fg }]}>
        {t(lang, 'msg.confidence')}: {t(lang, key)} · {Math.round(value * 100)}%
      </Text>
    </View>
  );
}

function CitationCard({ citation, lang, rtl }: { citation: Citation; lang: Lang; rtl: boolean }) {
  const open = () => {
    if (citation.url) Linking.openURL(citation.url).catch(() => {});
  };
  return (
    <View style={styles.citationCard}>
      <View style={styles.citationHeader}>
        <View style={styles.citationNum}>
          <Text style={styles.citationNumText}>{citation.n}</Text>
        </View>
        <Text style={[styles.citationTitle, { textAlign: rtl ? 'right' : 'left' }]}>{citation.title}</Text>
      </View>
      <View style={styles.citationMeta}>
        <Text style={styles.citationMetaText}>{citation.source}</Text>
        {citation.guidelineYear ? (
          <Text style={styles.citationMetaText}>
            · {t(lang, 'msg.guidelineYear')}: {citation.guidelineYear}
          </Text>
        ) : null}
      </View>
      <View style={styles.citationFooter}>
        <Text style={styles.citationLicense}>
          {t(lang, 'msg.license')}: {citation.license}
        </Text>
        {citation.url ? (
          <TouchableOpacity onPress={open} style={styles.openLink}>
            <Text style={styles.openLinkText}>{t(lang, 'msg.openSource')}</Text>
            <MaterialIcons name="open-in-new" size={14} color={colors.primary} />
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

function DisclaimerBanner({ text, rtl }: { text: string; rtl: boolean }) {
  return (
    <View style={styles.disclaimer}>
      <MaterialIcons name="info-outline" size={16} color={colors.info} />
      <Text style={[styles.disclaimerText, { textAlign: rtl ? 'right' : 'left' }]}>{text}</Text>
    </View>
  );
}

export function EmergencyBanner({ lang }: { lang: Lang }) {
  return (
    <View style={styles.emergency}>
      <MaterialIcons name="warning" size={22} color="#fff" />
      <Text style={styles.emergencyText}>{t(lang, 'msg.emergencyTitle')}</Text>
    </View>
  );
}

function markdownStyle(rtl: boolean) {
  const align = rtl ? 'right' : 'left';
  return {
    body: { fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: colors.text, textAlign: align as 'right' },
    paragraph: { marginTop: 0, marginBottom: 8, textAlign: align as 'right' },
    heading2: {
      fontFamily: fontFamily.bold,
      fontSize: fontSize.md,
      color: colors.navy,
      marginTop: 4,
      marginBottom: 8,
      textAlign: align as 'right',
    },
    bullet_list: { marginBottom: 8 },
    list_item: { marginBottom: 4 },
    strong: { fontFamily: fontFamily.bold },
    code_inline: { backgroundColor: colors.surfaceAlt, fontSize: fontSize.xs },
    fence: { backgroundColor: colors.surfaceAlt },
  };
}

export function AssistantMessage({ chat, lang }: { chat: ChatResponse; lang: Lang }) {
  const rtl = lang === 'ar';
  const sections = parseMessageSections(chat.answer);
  const md = markdownStyle(rtl);

  return (
    <View style={styles.container}>
      {chat.escalated ? <EmergencyBanner lang={lang} /> : null}

      {sections.map((s, i) => {
        if (s.kind === 'documented') {
          return (
            <View key={i} style={styles.documentedCard}>
              <View style={styles.sectionHeader}>
                <MaterialIcons name="menu-book" size={16} color={colors.primary} />
                <Text style={styles.sectionTitle}>{t(lang, 'msg.documented')}</Text>
              </View>
              <Markdown style={md}>{s.body}</Markdown>
            </View>
          );
        }
        if (s.kind === 'inference') {
          return (
            <View key={i} style={styles.inferenceCard}>
              <View style={styles.sectionHeader}>
                <MaterialIcons name="psychology" size={16} color={colors.textMuted} />
                <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>{t(lang, 'msg.inference')}</Text>
              </View>
              <Markdown style={md}>{s.body}</Markdown>
            </View>
          );
        }
        return (
          <View key={i} style={styles.plainCard}>
            <Markdown style={md}>{s.body}</Markdown>
          </View>
        );
      })}

      {chat.citations.length > 0 ? (
        <View style={styles.sourcesWrap}>
          <Text style={[styles.sourcesTitle, { textAlign: rtl ? 'right' : 'left' }]}>
            {t(lang, 'msg.sources')} ({chat.citations.length})
          </Text>
          {chat.citations.map((c) => (
            <CitationCard key={c.n} citation={c} lang={lang} rtl={rtl} />
          ))}
        </View>
      ) : null}

      <View style={styles.footerRow}>
        <ConfidenceBadge value={chat.confidence} lang={lang} />
      </View>

      {chat.disclaimer ? <DisclaimerBanner text={chat.disclaimer} rtl={rtl} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.sm },
  documentedCard: {
    backgroundColor: colors.primarySoft,
    borderRadius: radius.md,
    padding: spacing.md,
    borderStartWidth: 3,
    borderStartColor: colors.primary,
  },
  inferenceCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
  },
  plainCard: { paddingHorizontal: spacing.xs },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.sm },
  sectionTitle: { fontFamily: fontFamily.bold, fontSize: fontSize.sm, color: colors.primaryDark },
  sourcesWrap: { gap: spacing.sm, marginTop: spacing.xs },
  sourcesTitle: { fontFamily: fontFamily.bold, fontSize: fontSize.sm, color: colors.navy },
  citationCard: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.sm,
    gap: spacing.xs,
  },
  citationHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  citationNum: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  citationNumText: { color: '#fff', fontSize: fontSize.xs, fontFamily: fontFamily.bold },
  citationTitle: { flex: 1, fontFamily: fontFamily.medium, fontSize: fontSize.sm, color: colors.text },
  citationMeta: { flexDirection: 'row', flexWrap: 'wrap' },
  citationMetaText: { fontSize: fontSize.xs, color: colors.textMuted, fontFamily: fontFamily.regular },
  citationFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  citationLicense: { fontSize: fontSize.xs, color: colors.textMuted, fontFamily: fontFamily.regular },
  openLink: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  openLinkText: { color: colors.primary, fontSize: fontSize.xs, fontFamily: fontFamily.bold },
  footerRow: { flexDirection: 'row', marginTop: spacing.xs },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 5 },
  badgeText: { fontSize: fontSize.xs, fontFamily: fontFamily.medium },
  disclaimer: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: colors.infoSoft,
    borderRadius: radius.md,
    padding: spacing.sm,
    alignItems: 'flex-start',
  },
  disclaimerText: { flex: 1, fontSize: fontSize.xs, color: colors.info, fontFamily: fontFamily.regular, lineHeight: 18 },
  emergency: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.danger,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  emergencyText: { color: '#fff', fontFamily: fontFamily.bold, fontSize: fontSize.md },
});
