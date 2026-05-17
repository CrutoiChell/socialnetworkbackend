import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
// passport-yandex не имеет официальных типов в DefinitelyTyped — берём через require
// и приводим к минимальному shape, достаточному для PassportStrategy.
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment
const { Strategy: YandexStrategyImpl } = require('passport-yandex');

type YandexStrategyOptions = {
  clientID: string;
  clientSecret: string;
  callbackURL: string;
};

type YandexProfile = {
  id: string;
  displayName?: string;
  username?: string;
  emails?: { value: string }[];
  photos?: { value: string }[];
  name?: { givenName?: string; familyName?: string };
  _json?: {
    default_email?: string;
    real_name?: string;
    first_name?: string;
    last_name?: string;
    default_avatar_id?: string;
  };
};

type YandexVerify = (
  accessToken: string,
  refreshToken: string,
  profile: YandexProfile,
  done: (err: unknown, user?: YandexAuthUser | false) => void,
) => void;

interface YandexStrategyCtor {
  new (options: YandexStrategyOptions, verify: YandexVerify): unknown;
}

const TypedYandexStrategy = YandexStrategyImpl as YandexStrategyCtor;

export type YandexAuthUser = {
  email: string;
  firstName?: string;
  lastName?: string;
  photo?: string;
};

@Injectable()
export class YandexStrategyProvider extends PassportStrategy(
  TypedYandexStrategy as unknown as new (...args: unknown[]) => {
    authenticate(req: unknown, options?: unknown): unknown;
  },
  'yandex',
) {
  constructor(private config: ConfigService) {
    const clientID = config.get<string>('YANDEX_CLIENT_ID') ?? '';
    const clientSecret = config.get<string>('YANDEX_CLIENT_SECRET') ?? '';
    const callbackURL =
      config.get<string>('YANDEX_CALLBACK_URL') ||
      'http://localhost:4000/auth/yandex/callback';

    if (!clientID || !clientSecret) {
      console.warn(
        '[YandexStrategy] YANDEX_CLIENT_ID/YANDEX_CLIENT_SECRET are not set — endpoint /auth/yandex will fail.',
      );
    }

    super({
      clientID: clientID || 'unset',
      clientSecret: clientSecret || 'unset',
      callbackURL,
    });
  }

  validate(
    _accessToken: string,
    _refreshToken: string,
    profile: YandexProfile,
    done: (err: unknown, user?: YandexAuthUser | false) => void,
  ): void {
    const email =
      profile.emails?.[0]?.value?.trim().toLowerCase() ??
      profile._json?.default_email?.trim().toLowerCase() ??
      null;
    if (!email) {
      done(new UnauthorizedException('Yandex account has no email'), false);
      return;
    }

    const firstName =
      profile.name?.givenName ?? profile._json?.first_name ?? profile.username;
    const lastName = profile.name?.familyName ?? profile._json?.last_name;
    const photo = profile.photos?.[0]?.value;

    const user: YandexAuthUser = {
      email,
      firstName,
      lastName,
      photo,
    };
    done(null, user);
  }
}
