import {
  Injectable,
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { randomUUID } from 'crypto';

type YooKassaAmount = { value: string; currency: string };

type YooKassaPaymentResponse = {
  id: string;
  status: string;
  amount: YooKassaAmount;
  confirmation?: { type: string; confirmation_url?: string };
  metadata?: Record<string, string>;
};

type YooKassaWebhookEvent = {
  type: string;
  event: string;
  object: {
    id: string;
    status: string;
    amount: YooKassaAmount;
    metadata?: Record<string, string>;
  };
};

const PREMIUM_PRICE = '299.00';
const PREMIUM_CURRENCY = 'RUB';
const PREMIUM_DAYS = 30;

@Injectable()
export class PaymentsService {
  private readonly shopId: string;
  private readonly secretKey: string;
  private readonly returnUrl: string;
  private readonly apiBase = 'https://api.yookassa.ru/v3';

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
  ) {
    this.shopId = config.get<string>('UKASSA_SHOP_ID') ?? '';
    this.secretKey = config.get<string>('UKASSA_SECRET_KEY') ?? '';
    this.returnUrl =
      config.get<string>('UKASSA_RETURN_URL') ||
      'http://localhost:3000/premium?payment=success';

    if (!this.shopId || !this.secretKey) {
      console.warn(
        '[PaymentsService] UKASSA_SHOP_ID / UKASSA_SECRET_KEY not configured — payments will fail.',
      );
    }
  }

  /**
   * Создаёт платёжную сессию в ЮКассе (Sandbox или Production).
   * Возвращает URL для редиректа пользователя на страницу оплаты.
   */
  async createCheckout(userId: number) {
    console.log(`[PaymentsService] createCheckout called for userId=${userId}`);
    console.log(`[PaymentsService] shopId=${this.shopId ? '***' + this.shopId.slice(-4) : 'EMPTY'}, returnUrl=${this.returnUrl}`);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, username: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const idempotenceKey = randomUUID();
    const body = {
      amount: {
        value: PREMIUM_PRICE,
        currency: PREMIUM_CURRENCY,
      },
      confirmation: {
        type: 'redirect',
        return_url: this.returnUrl,
      },
      capture: true,
      description: `Stellar Premium — 30 дней для @${user.username}`,
      metadata: {
        userId: String(user.id),
        username: user.username,
      },
    };

    console.log(`[PaymentsService] Sending request to YooKassa: ${this.apiBase}/payments`);

    let response: Response;
    try {
      response = await fetch(`${this.apiBase}/payments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotence-Key': idempotenceKey,
          Authorization:
            'Basic ' +
            Buffer.from(`${this.shopId}:${this.secretKey}`).toString('base64'),
        },
        body: JSON.stringify(body),
      });
    } catch (networkError) {
      console.error('[PaymentsService] Network error calling YooKassa:', networkError);
      throw new InternalServerErrorException(
        'Не удалось связаться с платёжным шлюзом. Проверьте сеть.',
      );
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      console.error(`[PaymentsService] YooKassa HTTP ${response.status}:`, text);
      console.error('[PaymentsService] Возможные причины: неверный shopId/secretKey, sandbox не активен, IP заблокирован.');
      throw new InternalServerErrorException(
        `Ошибка платёжного шлюза (${response.status}). Проверьте конфигурацию UKASSA_SHOP_ID и UKASSA_SECRET_KEY.`,
      );
    }

    console.log(`[PaymentsService] YooKassa responded OK for userId=${userId}`);

    const payment = (await response.json()) as YooKassaPaymentResponse;
    const confirmationUrl = payment.confirmation?.confirmation_url;
    if (!confirmationUrl) {
      throw new InternalServerErrorException(
        'ЮКасса не вернула URL подтверждения.',
      );
    }

    return {
      paymentId: payment.id,
      confirmationUrl,
      amount: payment.amount,
    };
  }

  /**
   * Обработка webhook от ЮКассы.
   * При `payment.succeeded` активирует Premium на 30 дней.
   */
  async handleWebhook(payload: YooKassaWebhookEvent) {
    const event = payload?.event ?? payload?.type;
    if (event !== 'payment.succeeded') {
      // Игнорируем другие события (payment.waiting_for_capture, refund и т.д.)
      return { handled: false, event };
    }

    const obj = payload.object;
    if (!obj?.metadata?.userId) {
      throw new BadRequestException('Missing userId in payment metadata');
    }

    const userId = Number(obj.metadata.userId);
    if (!Number.isFinite(userId) || userId < 1) {
      throw new BadRequestException('Invalid userId in metadata');
    }

    const now = new Date();
    const premiumUntil = new Date(now.getTime() + PREMIUM_DAYS * 24 * 60 * 60 * 1000);

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        isPremium: true,
        premiumUntil,
        boostTokens: 3,
        boostTokensRefreshedAt: now,
      },
    });

    console.log(
      `[PaymentsService] Premium activated for user ${userId} until ${premiumUntil.toISOString()} (payment ${obj.id})`,
    );

    return { handled: true, userId, premiumUntil };
  }

  /**
   * Отмена подписки. Premium остаётся до premiumUntil, но автопродление
   * отключается (в sandbox — просто помечаем; в production нужно отменить
   * рекуррентный платёж через API ЮКассы).
   */
  async cancelSubscription(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, isPremium: true, premiumUntil: true },
    });
    if (!user) throw new NotFoundException('User not found');
    if (!user.isPremium) {
      throw new BadRequestException('У вас нет активной подписки');
    }

    return {
      cancelled: true,
      premiumUntil: user.premiumUntil,
      message: 'Автопродление отменено. Premium действует до окончания оплаченного периода.',
    };
  }

  /**
   * Локальное подтверждение платежа — для localhost, где webhook от ЮКассы не доходит.
   * Активирует Premium на 30 дней для текущего пользователя.
   */
  async confirmLocalPayment(userId: number) {
    console.log(`[PaymentsService] confirmLocalPayment for userId=${userId}`);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, isPremium: true, premiumUntil: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const now = new Date();
    const premiumUntil = new Date(now.getTime() + PREMIUM_DAYS * 24 * 60 * 60 * 1000);

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        isPremium: true,
        premiumUntil,
        boostTokens: 3,
        boostTokensRefreshedAt: now,
      },
      select: {
        id: true,
        username: true,
        email: true,
        avatar: true,
        role: true,
        isBlocked: true,
        isPremium: true,
        premiumUntil: true,
        boostTokens: true,
        xp: true,
        level: true,
        selectedColorStyle: true,
        lastUsernameChange: true,
        selectedTheme: true,
      },
    });

    console.log(`[PaymentsService] Premium activated locally for user ${userId} until ${premiumUntil.toISOString()}`);

    return {
      activated: true,
      user: updated,
      premiumUntil,
      message: `Stellar Premium активирован на ${PREMIUM_DAYS} дней`,
    };
  }
}
