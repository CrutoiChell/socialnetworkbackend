import {
  Body,
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { randomUUID } from 'crypto';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUserId } from '../auth/current-user-id.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CustomizeColorDto } from './dto/customize-color.dto';
import { ChangeUsernameDto } from './dto/change-username.dto';
import { SetThemeDto } from './dto/set-theme.dto';
import { UpdateBannerDto } from './dto/update-banner.dto';

const avatarsDir = join(process.cwd(), 'uploads', 'avatars');
const bannersDir = join(process.cwd(), 'uploads', 'banners');

function parseUserIdParam(id: string): number {
  if (id == null || String(id).trim() === '') {
    throw new NotFoundException('User not found');
  }
  const trimmed = String(id).trim();
  const n = Number(trimmed);
  if (
    !Number.isFinite(n) ||
    !Number.isInteger(n) ||
    n < 1 ||
    String(n) !== trimmed
  ) {
    throw new NotFoundException('User not found');
  }
  return n;
}

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private users: UsersService) {}

  @Get('me/social')
  getSocialBundle(@CurrentUserId() userId: number) {
    return this.users.getSocialBundle(userId);
  }

  @Get('me/friends')
  getFriends(@CurrentUserId() userId: number) {
    return this.users.getFriends(userId);
  }

  @Get('me/followers')
  getFollowers(@CurrentUserId() userId: number) {
    return this.users.getFollowers(userId);
  }

  @Get('me/following')
  getFollowing(@CurrentUserId() userId: number) {
    return this.users.getFollowing(userId);
  }

  @Get('me/liked-posts')
  getLikedPosts(
    @CurrentUserId() userId: number,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.users.getLikedPosts(userId, Number(page) || 1, Number(limit) || 20);
  }

  @Get('me')
  getMe(@CurrentUserId() userId: number) {
    return this.users.getUser(userId);
  }

  @Post('premium/activate')
  activatePremiumDemo(@CurrentUserId() userId: number) {
    return this.users.activatePremiumDemo(userId);
  }

  /** Premium-only: сохраняет выбранный стиль ника. */
  @Patch('profile/customize-color')
  customizeColor(
    @CurrentUserId() userId: number,
    @Body() dto: CustomizeColorDto,
  ) {
    const value = dto.colorStyle ?? null;
    return this.users.customizeColor(userId, value);
  }

  /** Смена @username, не чаще раза в 30 дней. */
  @Patch('profile/change-username')
  changeUsername(
    @CurrentUserId() userId: number,
    @Body() dto: ChangeUsernameDto,
  ) {
    return this.users.changeUsername(userId, dto.username);
  }

  /** Смена темы оформления. DEFAULT/NEBULA — всем, SUPERNOVA — только Premium. */
  @Patch('profile/theme')
  setTheme(
    @CurrentUserId() userId: number,
    @Body() dto: SetThemeDto,
  ) {
    return this.users.setTheme(userId, dto.theme);
  }

  @Post('me/avatar')
  @UseInterceptors(
    FileInterceptor('avatar', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          if (!existsSync(avatarsDir))
            mkdirSync(avatarsDir, { recursive: true });
          cb(null, avatarsDir);
        },
        filename: (_req, file, cb) => {
          const ext = extname(file.originalname) || '.jpg';
          cb(null, `${randomUUID()}${ext}`);
        },
      }),
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (!/^image\/(jpeg|png|gif|webp)$/.test(file.mimetype)) {
          cb(new Error('Only JPEG, PNG, GIF, WebP'), false);
          return;
        }
        cb(null, true);
      },
    }),
  )
  async uploadAvatar(
    @CurrentUserId() userId: number,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('No file (field name: avatar)');

    // GIF-аватарки — только для Premium-пользователей.
    if (file.mimetype === 'image/gif') {
      const user = await this.users.getUser(userId);
      const isPremiumActive =
        user.isPremium === true &&
        (user.premiumUntil == null || (user.premiumUntil as Date).getTime() > Date.now());
      if (!isPremiumActive) {
        throw new BadRequestException(
          'Анимированные GIF-аватары доступны только для пользователей Stellar Premium',
        );
      }
    }

    const avatarUrl = `/uploads/avatars/${file.filename}`;
    return this.users.updateAvatar(userId, avatarUrl);
  }

  @Post('me/banner')
  @UseInterceptors(
    FileInterceptor('banner', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          if (!existsSync(bannersDir))
            mkdirSync(bannersDir, { recursive: true });
          cb(null, bannersDir);
        },
        filename: (_req, file, cb) => {
          const ext = extname(file.originalname) || '.jpg';
          cb(null, `${randomUUID()}${ext}`);
        },
      }),
      limits: { fileSize: 10 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (!/^image\/(jpeg|png|gif|webp)$/.test(file.mimetype)) {
          cb(new Error('Only JPEG, PNG, GIF, WebP'), false);
          return;
        }
        cb(null, true);
      },
    }),
  )
  async uploadBanner(
    @CurrentUserId() userId: number,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('No file (field name: banner)');
    const bannerUrl = `/uploads/banners/${file.filename}`;
    return this.users.updateBanner(userId, bannerUrl);
  }

  @Patch('me/banner')
  setBannerByUrl(
    @CurrentUserId() userId: number,
    @Body() dto: UpdateBannerDto,
  ) {
    const value = dto.bannerUrl?.trim() ? dto.bannerUrl.trim() : null;
    return this.users.updateBanner(userId, value);
  }

  @Delete('me/banner')
  removeBanner(@CurrentUserId() userId: number) {
    return this.users.updateBanner(userId, null);
  }

  @Get(':id/relationship')
  getRelationshipStatus(
    @CurrentUserId() userId: number,
    @Param('id') id: string,
  ) {
    return this.users.getRelationshipStatus(userId, parseUserIdParam(id));
  }

  @Get(':id/posts')
  getUserPosts(
    @CurrentUserId() currentUserId: number,
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.users.getUserPosts(
      currentUserId,
      parseUserIdParam(id),
      Number(page) || 1,
      Number(limit) || 20,
    );
  }

  @Post(':id/subscribe')
  subscribe(@CurrentUserId() userId: number, @Param('id') id: string) {
    return this.users.subscribe(userId, parseUserIdParam(id));
  }

  @Post(':id/block')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'MODERATOR')
  blockUser(@CurrentUserId() userId: number, @Param('id') id: string) {
    return this.users.blockUser(parseUserIdParam(id), userId);
  }

  @Delete(':id/unsubscribe')
  unsubscribe(@CurrentUserId() userId: number, @Param('id') id: string) {
    return this.users.unsubscribe(userId, parseUserIdParam(id));
  }

  @Get(':id')
  async getUser(@CurrentUserId() currentUserId: number, @Param('id') id: string) {
    const targetId = parseUserIdParam(id);
    const profile = await this.users.getUser(targetId);
    // Приватность: email виден только владельцу аккаунта.
    if (targetId !== currentUserId) {
      const { email: _email, ...publicProfile } = profile as Record<string, unknown>;
      return publicProfile;
    }
    return profile;
  }
}
