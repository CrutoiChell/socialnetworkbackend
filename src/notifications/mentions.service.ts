import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';

/**
 * Извлекает уникальные `@username`-упоминания из текста и шлёт
 * пуш-уведомления типа MENTION упомянутым пользователям.
 *
 * Регулярка матчит латиницу/цифры/подчёркивание (1–30 символов) — так же,
 * как формат, генерируемый при регистрации (см. `auth.service`).
 * Кириллические юзернеймы умышленно не поддерживаются — они в проекте не создаются.
 */
@Injectable()
export class MentionsService {
  /** Совпадает с `@user_name`, не захватывает email-подобные `a@b`. */
  private static readonly MENTION_REGEX = /(^|[^\w@])@([a-zA-Z0-9_]{1,30})/g;

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  /** Возвращает список уникальных нижнерегистровых ников из текста. */
  static extractUsernames(text: string | null | undefined): string[] {
    if (!text) return [];
    const out = new Set<string>();
    for (const m of text.matchAll(MentionsService.MENTION_REGEX)) {
      const name = m[2];
      if (name) out.add(name);
    }
    return Array.from(out);
  }

  /**
   * Находит реально существующих пользователей и создаёт MENTION-уведомления.
   * @param text исходный текст (пост/коммент/сообщение)
   * @param senderId автор контента (он сам не получит уведомления, даже если упомянул себя)
   * @param entityId сущность, на которую ведёт уведомление (postId/commentId/messageId)
   */
  async notifyMentions(text: string, senderId: number, entityId: number | null) {
    const usernames = MentionsService.extractUsernames(text);
    if (usernames.length === 0) return;

    const matched = await this.prisma.user.findMany({
      where: { username: { in: usernames, mode: 'insensitive' } },
      select: { id: true },
    });

    const targets = matched.map((u) => u.id).filter((id) => id !== senderId);
    if (targets.length === 0) return;

    await Promise.all(
      targets.map((userId) =>
        this.notifications
          .createNotification({
            userId,
            senderId,
            type: 'MENTION',
            entityId,
          })
          .catch(() => null),
      ),
    );
  }
}
