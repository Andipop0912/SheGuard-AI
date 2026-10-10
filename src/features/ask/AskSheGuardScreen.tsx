/**
 * AskSheGuardScreen
 *
 * AI safety assistant chat UI.
 *
 * Safety rules (MUST NOT break):
 * - This screen NEVER calls EmergencyCoordinator.
 * - This screen NEVER delays or blocks the SOS button.
 * - When immediate danger is detected in the AI response (canned message), we show a
 *   prominent SOS banner, but pressing it is just a navigation.navigate — the actual
 *   emergency is still created by the user via the existing SOS flow.
 * - AI key is NEVER in this file or any RN code.
 */
import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RootStackScreenProps } from '../../navigation/types';
import { AppContainer } from '../../app/di/AppContainer';
import { AskSheGuardApiService } from './AskSheGuardApiService';
import type { ChatMessageDto } from './AskSheGuardApiService';
import { AskVoiceInputModule } from './AskVoiceInputBridge';
import { ensureEvidencePermissions } from '../../evidence/native/evidencePermissions';
import { colors, radii, spacing, typography, cardShadow } from '../../design/tokens';
import { Icon } from '../../design/Icon';

// ──────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────

type Message = ChatMessageDto & { id: string; isError?: boolean };

const WELCOME: Message = {
  id: 'welcome',
  role: 'assistant',
  content:
    "Hello, I'm SheGuard AI. How can I help you stay safe today?\n\nYou can ask me about safety tips, how SheGuard features work, or local emergency numbers.",
};

// SOS-priority keywords in the canned danger response from the server
const DANGER_KEYWORDS = ['SOS button', 'Police: 100', 'immediate danger'];

function isImmediateDangerResponse(text: string): boolean {
  return DANGER_KEYWORDS.some((kw) => text.includes(kw));
}

// ──────────────────────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────────────────────

const UserBubble: React.FC<{ text: string; testID?: string }> = ({ text, testID }) => (
  <View style={styles.userRow} testID={testID}>
    <View style={styles.userBubble}>
      <Text style={styles.userText}>{text}</Text>
    </View>
  </View>
);

const AssistantBubble: React.FC<{ text: string; isError?: boolean; testID?: string }> = ({
  text,
  isError,
  testID,
}) => (
  <View style={styles.assistantRow} testID={testID}>
    <View style={[styles.assistantIcon]}>
      <Icon name="shield" size={16} color={colors.white} />
    </View>
    <View style={[styles.assistantBubble, isError && styles.errorBubble]}>
      <Text style={[styles.assistantText, isError && styles.errorText]}>{text}</Text>
    </View>
  </View>
);

const TypingIndicator: React.FC = () => (
  <View style={styles.assistantRow} testID="ask-typing">
    <View style={styles.assistantIcon}>
      <Icon name="shield" size={16} color={colors.white} />
    </View>
    <View style={styles.assistantBubble}>
      <ActivityIndicator size="small" color={colors.primaryNavy} />
    </View>
  </View>
);

const SosBanner: React.FC<{ onSos: () => void }> = ({ onSos }) => (
  <Pressable style={styles.sosBanner} onPress={onSos} testID="ask-sos-banner" accessibilityRole="button">
    <Icon name="crisis-alert" size={20} color={colors.white} />
    <Text style={styles.sosBannerText}>Tap here to go to the SOS button — your safety first</Text>
  </Pressable>
);

// ──────────────────────────────────────────────────────────────
// Screen
// ──────────────────────────────────────────────────────────────

export const AskSheGuardScreen: React.FC<RootStackScreenProps<'AskSheGuard'>> = ({ navigation }) => {
  const [messages, setMessages] = useState<Message[]>([WELCOME]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [showSosBanner, setShowSosBanner] = useState(false);
  const listRef = useRef<FlatList<Message>>(null);

  // Lazy-init; AskSheGuardApiService is lightweight and needs no teardown
  const apiService = useRef<AskSheGuardApiService | null>(null);
  const getApiService = (): AskSheGuardApiService => {
    if (!apiService.current) {
      apiService.current = new AskSheGuardApiService(AppContainer.getInstance().apiClient);
    }
    return apiService.current;
  };

  const voiceInput = useRef<AskVoiceInputModule | null>(null);
  const getVoiceInput = (): AskVoiceInputModule => {
    if (!voiceInput.current) {
      voiceInput.current = new AskVoiceInputModule();
    }
    return voiceInput.current;
  };

  const scrollToBottom = useCallback(() => {
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);
  }, []);

  const addMessage = useCallback((msg: Omit<Message, 'id'>) => {
    const id = `msg-${Date.now()}-${Math.random()}`;
    setMessages((prev) => [...prev, { ...msg, id }]);
    return id;
  }, []);

  const onSend = useCallback(async () => {
    const text = inputText.trim();
    if (!text || isLoading) return;

    setInputText('');
    setIsLoading(true);
    setShowSosBanner(false);

    // Add the user's message immediately
    addMessage({ role: 'user', content: text });
    scrollToBottom();

    // Build the conversation history for the API (exclude welcome message)
    const history = messages
      .filter((m) => m.id !== 'welcome' && !m.isError)
      .map(({ role, content }) => ({ role, content }));
    const fullHistory: ChatMessageDto[] = [...history, { role: 'user', content: text }];

    try {
      const result = await getApiService().ask(fullHistory);

      if (result.ok) {
        addMessage({ role: 'assistant', content: result.reply });
        if (isImmediateDangerResponse(result.reply)) {
          setShowSosBanner(true);
        }
      } else {
        addMessage({
          role: 'assistant',
          content: result.message,
          isError: true,
        });
      }
    } catch {
      addMessage({
        role: 'assistant',
        content: 'Something went wrong. Please try again.',
        isError: true,
      });
    } finally {
      setIsLoading(false);
      scrollToBottom();
    }
  }, [inputText, isLoading, messages, addMessage, scrollToBottom]);

  // Voice input is a separate microphone consumer from the always-on voice-SOS hotword
  // listener, so hotword listening is paused for the duration of dictation and resumed after —
  // only one microphone consumer at a time, same rule EvidenceController follows for recording.
  const onMicPress = useCallback(async () => {
    if (isListening || isLoading) return;

    const permission = await ensureEvidencePermissions();
    if (permission !== 'granted') {
      addMessage({ role: 'assistant', content: 'Microphone permission is needed for voice input.', isError: true });
      return;
    }

    const voice = AppContainer.getInstance().voiceActivationAdapter;
    const wasVoiceActive = voice.isVoiceMonitoringActive();
    if (wasVoiceActive) await voice.stopListening();

    setIsListening(true);
    try {
      const text = (await getVoiceInput().recognize()).trim();
      if (text) setInputText((prev) => (prev ? `${prev} ${text}` : text));
    } catch (e) {
      const code = (e as { code?: string } | null)?.code;
      addMessage({
        role: 'assistant',
        content: code === 'NO_SPEECH'
          ? "I didn't catch that. Please try again or type your question."
          : 'Voice input is not available right now. Please type your question.',
        isError: true,
      });
    } finally {
      setIsListening(false);
      if (wasVoiceActive) await voice.startListening();
    }
  }, [isListening, isLoading, addMessage]);

  // Navigate back to Home — the user presses the real SOS button there
  // IMPORTANT: We do NOT call EmergencyCoordinator here.
  const onSosBannerPress = useCallback(() => {
    navigation.navigate('MainTabs', { screen: 'Home' });
  }, [navigation]);

  const renderItem = useCallback(
    ({ item }: { item: Message }) => {
      if (item.role === 'user') {
        return <UserBubble text={item.content} testID={`ask-user-msg-${item.id}`} />;
      }
      return (
        <AssistantBubble
          text={item.content}
          isError={item.isError}
          testID={`ask-assistant-msg-${item.id}`}
        />
      );
    },
    []
  );

  const canSend = inputText.trim().length > 0 && !isLoading;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom', 'left', 'right']} testID="ask-sheguard-screen">
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={90}
      >
        {showSosBanner && <SosBanner onSos={onSosBannerPress} />}

        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          onContentSizeChange={scrollToBottom}
          showsVerticalScrollIndicator={false}
          ListFooterComponent={isLoading ? <TypingIndicator /> : null}
          testID="ask-message-list"
        />

        <View style={styles.inputRow}>
          <Pressable
            style={[styles.micButton, isListening && styles.micButtonActive]}
            onPress={onMicPress}
            disabled={isListening || isLoading}
            testID="ask-mic"
            accessibilityRole="button"
            accessibilityLabel={isListening ? 'Listening' : 'Ask by voice'}
          >
            {isListening ? (
              <ActivityIndicator size="small" color={colors.white} />
            ) : (
              <Icon name="mic" size={20} color={colors.primaryNavy} />
            )}
          </Pressable>
          <TextInput
            style={styles.input}
            value={inputText}
            onChangeText={setInputText}
            placeholder={isListening ? 'Listening...' : 'Type your question...'}
            placeholderTextColor={colors.textMuted}
            multiline
            maxLength={500}
            returnKeyType="default"
            testID="ask-input"
            accessibilityLabel="Type your question"
          />
          <Pressable
            style={[styles.sendButton, !canSend && styles.sendButtonDisabled]}
            onPress={onSend}
            disabled={!canSend}
            testID="ask-send"
            accessibilityRole="button"
            accessibilityLabel="Send message"
          >
            <Icon name="send" size={20} color={canSend ? colors.white : colors.textMuted} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

// ──────────────────────────────────────────────────────────────
// Styles
// ──────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },

  listContent: {
    paddingHorizontal: spacing.screenHorizontal,
    paddingTop: 16,
    paddingBottom: 8,
    gap: 12,
  },

  // User bubble — right-aligned navy
  userRow: { flexDirection: 'row', justifyContent: 'flex-end' },
  userBubble: {
    backgroundColor: colors.primaryNavy,
    borderRadius: radii.card,
    borderBottomRightRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxWidth: '78%',
    ...cardShadow,
  },
  userText: { color: colors.white, fontSize: 15, lineHeight: 22 },

  // Assistant bubble — left-aligned light surface
  assistantRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  assistantIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primaryNavy,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  assistantBubble: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxWidth: '78%',
    ...cardShadow,
  },
  assistantText: { color: colors.textPrimary, fontSize: 15, lineHeight: 22 },
  errorBubble: { borderColor: colors.emergencyRed, backgroundColor: colors.emergencyRedLight },
  errorText: { color: colors.emergencyRedDark },

  // Immediate danger SOS banner at the top
  sosBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.emergencyRed,
    paddingHorizontal: spacing.screenHorizontal,
    paddingVertical: 12,
  },
  sosBannerText: { color: colors.white, fontSize: 13, fontWeight: '700', flex: 1 },

  // Input row at the bottom
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    paddingHorizontal: spacing.screenHorizontal,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 110,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 10,
    color: colors.textPrimary,
    backgroundColor: colors.background,
    ...typography.body,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primaryNavy,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  sendButtonDisabled: {
    backgroundColor: colors.surfaceSecondary,
  },
  micButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  micButtonActive: {
    backgroundColor: colors.primaryNavy,
    borderColor: colors.primaryNavy,
  },
});
