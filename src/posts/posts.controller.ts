import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { randomUUID } from 'crypto';
import { PostsService } from './posts.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { CurrentUserId } from '../auth/current-user-id.decorator';
import { CreatePostDto } from './dto/create-post.dto';
import { CreateCommentDto } from './dto/create-comment.dto';
import { VotePollDto } from './dto/vote-poll.dto';
import { RepostDto } from './dto/repost.dto';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';

const uploadsDir = join(process.cwd(), 'uploads');

type ReqWithUser = {
  user?: { userId?: number; id?: number };
};

@Controller('posts')
export class PostsController {
  constructor(private posts: PostsService) {}

  // Hard server-side ceiling (matches the Premium tier); per-tier limits
  // (file count, size, video access) are enforced in PostsService.assertUploadLimits.
  private static readonly postMediaInterceptor = FilesInterceptor('files', 10, {
    storage: diskStorage({
      destination: (_req, _file, cb) => {
        if (!existsSync(uploadsDir)) mkdirSync(uploadsDir, { recursive: true });
        cb(null, uploadsDir);
      },
      filename: (_req, file, cb) => {
        const ext = extname(file.originalname) || '.jpg';
        cb(null, `${randomUUID()}${ext}`);
      },
    }),
    limits: { fileSize: 30 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (!/^(image\/(jpeg|png|gif)|video\/(mp4|webm))$/.test(file.mimetype)) {
        cb(new Error('Only JPEG, PNG, GIF, MP4, WebM'), false);
        return;
      }
      cb(null, true);
    },
  });

  @Post()
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(PostsController.postMediaInterceptor)
  createPost(
    @CurrentUserId() userId: number,
    @Body() dto: CreatePostDto,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    return this.posts.createPost(userId, dto, files ?? []);
  }

  @Get()
  @UseGuards(OptionalJwtAuthGuard)
  getPosts(
    @Req() req: ReqWithUser,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('sortBy') sortBy?: string,
  ) {
    const userId = req.user?.userId ?? req.user?.id ?? 0;
    return this.posts.getPosts(
      userId,
      Number(page) || 1,
      Number(limit) || 20,
      sortBy,
    );
  }

  @Get('feed/subscriptions')
  @UseGuards(JwtAuthGuard)
  getSubscriptionsFeed(
    @CurrentUserId() userId: number,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.posts.getSubscriptionsFeed(
      userId,
      Number(page) || 1,
      Number(limit) || 20,
    );
  }

  @Get(':id/comments')
  @UseGuards(JwtAuthGuard)
  getPostComments(
    @CurrentUserId() userId: number,
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.posts.getPostComments(
      Number(id),
      userId,
      Number(page) || 1,
      Number(limit) || 20,
    );
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  getPost(
    @CurrentUserId() userId: number,
    @Param('id') id: string,
    @Query('commentsLimit') commentsLimit?: string,
    @Query('commentsSkip') commentsSkip?: string,
  ) {
    return this.posts.getPost(Number(id), userId, {
      commentsTake: Math.min(Number(commentsLimit) || 20, 100),
      commentsSkip: Number(commentsSkip) || 0,
    });
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  deletePost(@CurrentUserId() userId: number, @Param('id') id: string) {
    return this.posts.deletePost(Number(id), userId);
  }

  @Delete(':id/moderated')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'MODERATOR')
  deletePostModerated(@Param('id') id: string) {
    return this.posts.deletePostModerated(Number(id));
  }

  @Post(':id/like')
  @UseGuards(JwtAuthGuard)
  likePost(@CurrentUserId() userId: number, @Param('id') id: string) {
    return this.posts.likePost(Number(id), userId);
  }

  @Post(':id/comments')
  @UseGuards(JwtAuthGuard)
  addComment(
    @CurrentUserId() userId: number,
    @Param('id') id: string,
    @Body() dto: CreateCommentDto,
  ) {
    return this.posts.addComment(Number(id), userId, dto);
  }

  @Post(':id/poll/vote')
  @UseGuards(JwtAuthGuard)
  votePoll(
    @CurrentUserId() userId: number,
    @Param('id') id: string,
    @Body() dto: VotePollDto,
  ) {
    return this.posts.votePoll(Number(id), userId, dto.optionIndex);
  }

  @Post(':id/repost')
  @UseGuards(JwtAuthGuard)
  repost(
    @CurrentUserId() userId: number,
    @Param('id') id: string,
    @Body() dto: RepostDto,
  ) {
    return this.posts.createRepost(userId, Number(id), dto.content ?? '');
  }

  @Post(':id/boost')
  @UseGuards(JwtAuthGuard)
  boostPost(@CurrentUserId() userId: number, @Param('id') id: string) {
    return this.posts.boostPost(Number(id), userId);
  }

  @Delete('comments/:id')
  @UseGuards(JwtAuthGuard)
  deleteComment(@CurrentUserId() userId: number, @Param('id') id: string) {
    return this.posts.deleteComment(Number(id), userId);
  }
}
