import { locales, matchLocale, type FeedbackLocale } from '@kobecuppens/feedback-core';

export interface EmailStrings {
  reviewSubject: (title: string) => string;
  reviewLink: string;
  approved: string;
  declined: string;
  statusChanged: (status: string) => string;
  reason: (reason: string) => string;
  thanks: (project: string) => string;
}

const strings: Record<FeedbackLocale, EmailStrings> = {
  en: {
    reviewSubject: (title) => `New feedback to review: ${title}`,
    reviewLink: 'Review in the dashboard',
    approved: 'Your feedback is now public',
    declined: 'Your feedback was declined',
    statusChanged: (status) => `Your feedback is now "${status}"`,
    reason: (reason) => `Reason: ${reason}`,
    thanks: (project) => `Thanks for helping improve ${project}!`,
  },
  nl: {
    reviewSubject: (title) => `Nieuwe feedback om na te kijken: ${title}`,
    reviewLink: 'Nakijken in het dashboard',
    approved: 'Je feedback is nu openbaar',
    declined: 'Je feedback is afgewezen',
    statusChanged: (status) => `Je feedback staat nu op "${status}"`,
    reason: (reason) => `Reden: ${reason}`,
    thanks: (project) => `Bedankt dat je ${project} helpt verbeteren!`,
  },
  fr: {
    reviewSubject: (title) => `Nouvel avis à examiner : ${title}`,
    reviewLink: 'Examiner dans le tableau de bord',
    approved: 'Ton avis est maintenant public',
    declined: 'Ton avis a été refusé',
    statusChanged: (status) => `Ton avis est maintenant « ${status} »`,
    reason: (reason) => `Raison : ${reason}`,
    thanks: (project) => `Merci de nous aider à améliorer ${project} !`,
  },
  de: {
    reviewSubject: (title) => `Neues Feedback zu prüfen: ${title}`,
    reviewLink: 'Im Dashboard prüfen',
    approved: 'Dein Feedback ist jetzt öffentlich',
    declined: 'Dein Feedback wurde abgelehnt',
    statusChanged: (status) => `Dein Feedback ist jetzt „${status}“`,
    reason: (reason) => `Grund: ${reason}`,
    thanks: (project) => `Danke, dass du hilfst, ${project} zu verbessern!`,
  },
  es: {
    reviewSubject: (title) => `Nueva sugerencia para revisar: ${title}`,
    reviewLink: 'Revisar en el panel',
    approved: 'Tu sugerencia ya es pública',
    declined: 'Tu sugerencia ha sido rechazada',
    statusChanged: (status) => `Tu sugerencia ahora está «${status}»`,
    reason: (reason) => `Motivo: ${reason}`,
    thanks: (project) => `¡Gracias por ayudar a mejorar ${project}!`,
  },
  ja: {
    reviewSubject: (title) => `確認待ちの新しいフィードバック：${title}`,
    reviewLink: 'ダッシュボードで確認',
    approved: 'フィードバックが公開されました',
    declined: 'フィードバックが見送られました',
    statusChanged: (status) => `フィードバックのステータスが「${status}」になりました`,
    reason: (reason) => `理由：${reason}`,
    thanks: (project) => `${project}の改善にご協力いただきありがとうございます！`,
  },
  ko: {
    reviewSubject: (title) => `검토할 새 피드백: ${title}`,
    reviewLink: '대시보드에서 검토',
    approved: '피드백이 공개되었습니다',
    declined: '피드백이 반려되었습니다',
    statusChanged: (status) => `피드백 상태가 '${status}'(으)로 변경되었습니다`,
    reason: (reason) => `사유: ${reason}`,
    thanks: (project) => `${project} 개선에 도움을 주셔서 감사합니다!`,
  },
};

/** Email copy plus the board's status names for a stored locale; unknown or missing falls back to English. */
export function emailStrings(locale: string | null | undefined): EmailStrings & { status: (typeof locales)['en']['status'] } {
  const code = matchLocale(locale);
  return { ...strings[code], status: locales[code].status };
}
