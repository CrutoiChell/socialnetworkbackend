import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Profile, Strategy } from 'passport-github2';

export type GithubAuthUser = {
  email: string;
  firstName?: string;
  lastName?: string;
  photo?: string;
};

type DoneFn = (error: unknown, user?: GithubAuthUser | false) => void;

@Injectable()
export class GithubStrategy extends PassportStrategy(Strategy, 'github') {
  constructor(private config: ConfigService) {
    const clientID = config.get<string>('GITHUB_CLIENT_ID') ?? '';
    const clientSecret = config.get<string>('GITHUB_CLIENT_SECRET') ?? '';
    const callbackURL =
      config.get<string>('GITHUB_CALLBACK_URL') ||
      'http://localhost:4000/auth/github/callback';

    if (!clientID || !clientSecret) {
      // Логируем, но не падаем при бутстрапе — иначе сервис не запустится в dev,
      // если у разработчика не настроен этот провайдер.
      console.warn(
        '[GithubStrategy] GITHUB_CLIENT_ID/GITHUB_CLIENT_SECRET are not set — endpoint /auth/github will fail.',
      );
    }

    super({
      clientID: clientID || 'unset',
      clientSecret: clientSecret || 'unset',
      callbackURL,
      scope: ['user:email'],
    });
  }

  validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
    done: DoneFn,
  ): void {
    // GitHub email может быть null, если приватный — попробуем достать из профиля
    // Проверяем несколько источников: emails массив, _json.email, _json.login + @users.noreply.github.com
    let email: string | null = null;
    
    // Попытка 1: массив emails
    if (profile.emails && profile.emails.length > 0) {
      email = profile.emails.find((e) => e.value)?.value?.trim().toLowerCase() ?? null;
    }
    
    // Попытка 2: _json.email (может быть доступен даже если emails пустой)
    if (!email && (profile as any)._json?.email) {
      email = String((profile as any)._json.email).trim().toLowerCase();
    }
    
    // Попытка 3: использовать username@users.noreply.github.com как fallback
    if (!email && profile.username) {
      email = `${profile.username}@users.noreply.github.com`.toLowerCase();
    }
    
    if (!email) {
      done(
        new UnauthorizedException(
          'GitHub account has no accessible email; разрешите доступ к email и попробуйте снова',
        ),
        false,
      );
      return;
    }

    // displayName у GitHub — например "John Smith"; разнесём на first/last по пробелу
    const display = (profile.displayName || profile.username || '').trim();
    const [firstName, ...rest] = display.split(/\s+/).filter(Boolean);
    const lastName = rest.join(' ') || undefined;

    const user: GithubAuthUser = {
      email,
      firstName: firstName || profile.username,
      lastName,
      photo: profile.photos?.[0]?.value,
    };
    done(null, user);
  }
}
