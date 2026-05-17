import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUserId } from '../auth/current-user-id.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BookmarksService } from './bookmarks.service';

@Controller('bookmarks')
@UseGuards(JwtAuthGuard)
export class BookmarksController {
  constructor(private bookmarks: BookmarksService) {}

  @Post(':postId')
  toggleBookmark(
    @CurrentUserId() userId: number,
    @Param('postId') postId: string,
  ) {
    return this.bookmarks.toggleBookmark(userId, Number(postId));
  }

  @Get()
  getBookmarks(
    @CurrentUserId() userId: number,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.bookmarks.getBookmarks(
      userId,
      Number(page) || 1,
      Number(limit) || 20,
    );
  }
}
