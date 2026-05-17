import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUserId } from '../auth/current-user-id.decorator';

@Controller('payments')
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);

  constructor(private payments: PaymentsService) {
    this.logger.log(
      'PaymentsController initialized — routes: ' +
      'POST /payments/create-checkout, ' +
      'POST /payments/webhook, ' +
      'POST /payments/cancel-subscription, ' +
      'POST /payments/confirm-local-payment',
    );
  }

  /**
   * Создаёт платёжную сессию ЮКассы и возвращает URL для редиректа.
   * Требует авторизации (JWT).
   */
  @Post('create-checkout')
  @UseGuards(JwtAuthGuard)
  createCheckout(@CurrentUserId() userId: number) {
    this.logger.log(`[create-checkout] Попытка создания платежа для юзера: ${userId}`);
    return this.payments.createCheckout(userId);
  }

  /**
   * Webhook от ЮКассы. Не требует JWT — ЮКасса шлёт POST напрямую.
   */
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  handleWebhook(@Body() body: unknown) {
    this.logger.log(`[webhook] Получен вебхук от ЮКассы: ${JSON.stringify(body).slice(0, 300)}`);
    return this.payments.handleWebhook(body as never);
  }

  /**
   * Отмена подписки. Premium остаётся до premiumUntil.
   */
  @Post('cancel-subscription')
  @UseGuards(JwtAuthGuard)
  cancelSubscription(@CurrentUserId() userId: number) {
    this.logger.log(`[cancel-subscription] Запрос отмены подписки от юзера: ${userId}`);
    return this.payments.cancelSubscription(userId);
  }

  /**
   * Локальное подтверждение платежа (для localhost, где webhook от ЮКассы недоступен).
   * Фронтенд вызывает этот эндпоинт после возврата со страницы оплаты.
   * Активирует Premium на 30 дней для текущего авторизованного пользователя.
   */
  @Post('confirm-local-payment')
  @UseGuards(JwtAuthGuard)
  confirmLocalPayment(@CurrentUserId() userId: number) {
    this.logger.log(`[confirm-local-payment] Локальное подтверждение для юзера: ${userId}`);
    return this.payments.confirmLocalPayment(userId);
  }
}
