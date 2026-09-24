import type { Attachment, Post } from '@kobecuppens/feedback-core';
import { useConfig, useCreatePost, useFeatures, useUpload } from '@kobecuppens/feedback-core/react';
import { useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View, type ImageStyle } from 'react-native';
import { Button, Chip, Header, InlineError } from '../components';
import { defaultPickImage } from '../platform';
import { useUI } from '../ui';

export interface FeedbackSubmitProps {
  /** Called with the created post after the success message is dismissed. */
  onDone?: (post: Post) => void;
  onCancel?: () => void;
}

export function FeedbackSubmit({ onDone, onCancel }: FeedbackSubmitProps) {
  const { styles, strings, theme, pickImage } = useUI();
  const features = useFeatures();
  const { data: config } = useConfig();
  const create = useCreatePost();
  const upload = useUpload();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<{ attachment: Attachment; previewUri: string }[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [created, setCreated] = useState<Post | null>(null);

  const limits = config?.limits;
  const titleMin = limits?.titleMin ?? 3;
  const picker = pickImage ?? defaultPickImage;
  const canAttach =
    !!features?.attachments && !!picker && attachments.length < (limits?.attachmentsPerPost ?? 4);


  const attach = async () => {
    if (!picker) return;
    setError(null);
    try {
      const picked = await picker();
      if (!picked) return;
      const attachment = await upload.mutateAsync(picked.file);
      setAttachments((list) => [...list, { attachment, previewUri: picked.previewUri }]);
    } catch (e) {
      setError(e);
    }
  };

  const submit = () => {
    setError(null);
    if (title.trim().length < titleMin) return;
    create.mutate(
      { title: title.trim(), body: body.trim(), categoryId, attachmentIds: attachments.map((a) => a.attachment.id) },
      { onSuccess: setCreated, onError: setError },
    );
  };

  if (created) {
    return (
      <View style={styles.container}>
        <Header title={strings.submit.title} onBack={() => onDone?.(created)} />
        <View style={styles.empty}>
          <Text style={styles.emptyText}>
            {created.moderation === 'approved' ? strings.submit.successPublished : strings.submit.successPending}
          </Text>
          <Button label={strings.submit.done} onPress={() => onDone?.(created)} />
        </View>
      </View>
    );
  }

  const titleMax = limits?.titleMax ?? 120;
  const bodyMax = limits?.bodyMax ?? 5000;

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Header title={strings.submit.title} onBack={onCancel} />
      <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
        <Text style={styles.inputLabel} nativeID="rnf-title-label">
          {strings.submit.titleLabel}
        </Text>
        <TextInput
          value={title}
          onChangeText={setTitle}
          maxLength={titleMax}
          placeholder={strings.submit.titlePlaceholder}
          placeholderTextColor={theme.colors.textMuted}
          style={styles.input}
          accessibilityLabelledBy="rnf-title-label"
          accessibilityLabel={strings.submit.titleLabel}
          autoFocus
        />
        <Text style={styles.inputLabel}>{strings.submit.bodyLabel}</Text>
        <TextInput
          value={body}
          onChangeText={setBody}
          maxLength={bodyMax}
          placeholder={strings.submit.bodyPlaceholder}
          placeholderTextColor={theme.colors.textMuted}
          style={styles.textarea}
          multiline
          accessibilityLabel={strings.submit.bodyLabel}
        />
        {config && config.categories.length > 0 && (
          <>
            <Text style={styles.inputLabel}>{strings.submit.categoryLabel}</Text>
            <View style={[styles.chipRow, { flexWrap: 'wrap' }]}>
              {config.categories.map((cat) => (
                <Chip
                  key={cat.id}
                  label={cat.name}
                  active={categoryId === cat.id}
                  onPress={() => setCategoryId(categoryId === cat.id ? null : cat.id)}
                />
              ))}
            </View>
          </>
        )}
        {(attachments.length > 0 || canAttach) && (
          <View style={styles.attachmentRow}>
            {attachments.map(({ attachment, previewUri }) => (
              <Pressable
                key={attachment.id}
                accessibilityRole="button"
                accessibilityLabel={strings.submit.removeAttachment}
                onPress={() => setAttachments((list) => list.filter((a) => a.attachment.id !== attachment.id))}
              >
                <Image source={{ uri: previewUri }} style={styles.attachmentImage as ImageStyle} accessibilityIgnoresInvertColors />
              </Pressable>
            ))}
          </View>
        )}
        {canAttach && (
          <Button label={strings.submit.attach} variant="secondary" onPress={() => void attach()} loading={upload.isPending} />
        )}
        <InlineError error={error} />
        <Button
          label={create.isPending ? strings.submit.submitting : strings.submit.submit}
          onPress={submit}
          disabled={title.trim().length < titleMin || upload.isPending}
          loading={create.isPending}
        />
        {onCancel && <Button label={strings.submit.cancel} variant="secondary" onPress={onCancel} />}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
