import {
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Body,
  ParseIntPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { MessagesService } from './messages.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUserId } from '../auth/current-user-id.decorator';

@Controller('messages')
@UseGuards(JwtAuthGuard)
export class MessagesController {
  constructor(private messages: MessagesService) {}

  @Get('global')
  getGlobalMessages(@Query('limit') limit?: string) {
    return this.messages.getGlobalMessages(Number(limit) || 50);
  }

  @Get('conversations')
  getConversations(@CurrentUserId() userId: number) {
    return this.messages.getConversations(userId);
  }

  @Get('conversation/:userId')
  getConversation(
    @CurrentUserId() userId: number,
    @Param('userId') otherUserId: string,
    @Query('limit') limit?: string,
  ) {
    return this.messages.getConversation(
      userId,
      Number(otherUserId),
      Number(limit) || 50,
    );
  }

  /**
   * Модерация: удаление сообщения (любого — личного или из глобального чата).
   * Только ADMIN/MODERATOR. Шлёт WebSocket-событие `message:deleted` участникам.
   */
  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'MODERATOR')
  deleteMessage(
    @CurrentUserId() moderatorId: number,
    @Param('id', ParseIntPipe) id: number,
    @Query('scope') scope?: string,
  ) {
    const messageScope = scope === 'global' ? 'global' : 'private';
    return this.messages.deleteMessageByModerator(id, messageScope, moderatorId);
  }

  /**
   * Удаление своего сообщения (автор). Если роль ADMIN/MODERATOR — тоже разрешено.
   */
  @Delete(':id/own')
  deleteOwnMessage(
    @CurrentUserId() userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Query('scope') scope?: string,
  ) {
    const messageScope = scope === 'global' ? 'global' : 'private';
    return this.messages.deleteOwnMessage(id, messageScope, userId);
  }

  /**
   * Редактирование текста своего сообщения. Ставит isEdited=true, обновляет updatedAt.
   */
  @Patch(':id')
  editMessage(
    @CurrentUserId() userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { text: string; scope?: string },
  ) {
    const scope = body.scope === 'global' ? 'global' : 'private';
    return this.messages.editMessage(id, scope, userId, body.text);
  }
}
