import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { isUserCurrentlyBlocked } from '../common/block-status';
import type { UserRole } from '@prisma/client';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.get<string>('JWT_SECRET', 'secret'),
    });
  }

  async validate(payload: {
    sub: number | string;
    email: string;
    username?: string;
    role?: UserRole;
  }) {
    const sub = Number(payload.sub);
    if (!Number.isFinite(sub)) throw new UnauthorizedException();

    const user = await this.prisma.user.findUnique({
      where: { id: sub },
      select: { id: true, email: true, username: true, role: true, isBlocked: true, blockedUntil: true },
    });
    if (!user) throw new UnauthorizedException();
    if (await isUserCurrentlyBlocked(this.prisma, user)) throw new UnauthorizedException();

    return {
      userId: user.id,
      id: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
    };
  }
}
