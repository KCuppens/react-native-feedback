import type { Post } from '@kobecuppens/feedback-core';
import { useRoadmap } from '@kobecuppens/feedback-core/react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { CategoryPill, EmptyState, ErrorState, Loading, StatusPill } from '../components';
import { useUI } from '../ui';

export interface FeedbackRoadmapProps {
  onOpenPost: (post: Post) => void;
}

export function FeedbackRoadmap({ onOpenPost }: FeedbackRoadmapProps) {
  const { styles, strings } = useUI();
  const query = useRoadmap();

  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  return (
    <ScrollView horizontal style={styles.container} contentContainerStyle={styles.roadmapScroll}>
      {query.data.map((column) => (
        <View key={column.status} style={styles.roadmapColumn}>
          <View style={styles.roadmapColumnHeader}>
            <StatusPill status={column.status} label={strings.status[column.status]} />
            <Text style={styles.roadmapCount}>{column.posts.length}</Text>
          </View>
          <ScrollView nestedScrollEnabled contentContainerStyle={{ gap: 8 }}>
            {column.posts.length === 0 ? (
              <EmptyState message={strings.roadmap.empty} />
            ) : (
              column.posts.map((post) => (
                <Pressable key={post.id} accessibilityRole="button" onPress={() => onOpenPost(post)} style={styles.roadmapCard}>
                  <Text style={styles.roadmapCardTitle} numberOfLines={3}>
                    {post.title}
                  </Text>
                  <View style={styles.cardMeta}>
                    <Text style={styles.cardMetaText} accessibilityLabel={strings.post.votes(post.score)}>
                      ▲ {post.score}
                    </Text>
                    {post.category && <CategoryPill name={post.category.name} color={post.category.color} />}
                  </View>
                </Pressable>
              ))
            )}
          </ScrollView>
        </View>
      ))}
    </ScrollView>
  );
}
