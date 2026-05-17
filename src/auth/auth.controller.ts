import {
  Controller,
  Post,
  Body,
  Get,
  Req,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import type { Request, Response } from 'express';
import { GoogleAuthUser } from './google.strategy';
import { GithubAuthUser } from './github.strategy';
import { YandexAuthUser } from './yandex.strategy';

type OAuthProvider = 'google' | 'github' | 'yandex';

@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private config: ConfigService,
  ) {}

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  // ─────────────── Google ───────────────

  @Get('google')
  @UseGuards(AuthGuard('google'))
  googleAuth() {
    return;
  }

  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  async googleAuthCallback(@Req() req: Request, @Res() res: Response) {
    const user = req.user as GoogleAuthUser | undefined;
    return this.completeOAuth(res, 'google', user);
  }

  // ─────────────── GitHub ───────────────

  @Get('github')
  @UseGuards(AuthGuard('github'))
  githubAuth() {
    return;
  }

  @Get('github/callback')
  @UseGuards(AuthGuard('github'))
  async githubAuthCallback(@Req() req: Request, @Res() res: Response) {
    const user = req.user as GithubAuthUser | undefined;
    return this.completeOAuth(res, 'github', user);
  }

  // ─────────────── Yandex ───────────────

  @Get('yandex')
  @UseGuards(AuthGuard('yandex'))
  yandexAuth() {
    return;
  }

  @Get('yandex/callback')
  @UseGuards(AuthGuard('yandex'))
  async yandexAuthCallback(@Req() req: Request, @Res() res: Response) {
    const user = req.user as YandexAuthUser | undefined;
    return this.completeOAuth(res, 'yandex', user);
  }

  // ─────────────── Common ───────────────

  private async completeOAuth(
    res: Response,
    provider: OAuthProvider,
    profile?: GoogleAuthUser | GithubAuthUser | YandexAuthUser,
  ) {
    if (!profile?.email) {
      const failUrl = this.buildFrontendAuthUrl({
        error: `${provider}_auth_failed`,
      });
      return res.redirect(failUrl);
    }

    try {
      const { token } = await this.authService.loginWithOAuthProfile(profile);
      const successUrl = this.buildFrontendAuthUrl({ token, provider });
      return res.redirect(successUrl);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'oauth_failed';
      const failUrl = this.buildFrontendAuthUrl({
        error: `${provider}_auth_failed`,
        reason: message,
      });
      return res.redirect(failUrl);
    }
  }

  private buildFrontendAuthUrl(params: Record<string, string>) {
    const frontendBase =
      this.config.get<string>('FRONTEND_URL') || 'http://localhost:3000';
    const url = new URL('/auth', frontendBase);
    Object.entries(params).forEach(([key, value]) =>
      url.searchParams.set(key, value),
    );
    return url.toString();
  }
}
