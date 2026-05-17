import {
  Injectable,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { UserRole } from '@prisma/client';
import { XpService } from '../xp/xp.service';

type GoogleProfileData = {
  email: string;
  firstName?: string;
  lastName?: string;
  photo?: string;
};

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private xp: XpService,
  ) {}

  async register(dto: RegisterDto) {
    const email = dto.email.trim().toLowerCase();
    const username = dto.username.trim();
    const exists = await this.prisma.user.findFirst({
      where: { OR: [{ email }, { username }] },
    });
    if (exists) throw new ConflictException('Email or username already taken');

    const password = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.user.create({
      data: { email, username, password },
      select: {
        id: true,
        email: true,
        username: true,
        avatar: true,
        role: true,
        isBlocked: true,
        isPremium: true,
        premiumUntil: true,
        boostTokens: true,
        xp: true,
        level: true,
      },
    });
    await this.xp.awardDailyLoginXp(user.id);
    const refreshed = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: {
        id: true,
        email: true,
        username: true,
        avatar: true,
        role: true,
        isBlocked: true,
        isPremium: true,
        premiumUntil: true,
        boostTokens: true,
        xp: true,
        level: true,
      },
    });

    return {
      user: refreshed ?? user,
      token: this.sign(user.id, user.email, user.username, user.role),
    };
  }

  async login(dto: LoginDto) {
    const identifier = dto.email.trim();
    const user = identifier.includes('@')
      ? await this.prisma.user.findFirst({
          where: {
            email: { equals: identifier, mode: 'insensitive' },
          },
        })
      : await this.prisma.user.findUnique({
          where: { username: identifier },
        });
    if (!user) throw new UnauthorizedException('Invalid credentials');
    if (user.isBlocked) throw new UnauthorizedException('User is blocked');

    const valid = await bcrypt.compare(dto.password, user.password);
    if (!valid) throw new UnauthorizedException('Invalid credentials');
    await this.xp.awardDailyLoginXp(user.id);

    const refreshed = await this.prisma.user.findUnique({
      where: { id: user.id },
    });
    const { password: _password, ...result } = refreshed ?? user;
    return {
      user: result,
      token: this.sign(user.id, user.email, user.username, user.role),
    };
  }

  async loginWithGoogle(profile: GoogleProfileData) {
    return this.loginWithOAuthProfile(profile);
  }

  /**
   * Универсальный обработчик OAuth-профилей (Google / GitHub / Yandex).
   * Создаёт пользователя при первом входе с уникальным username и подтягивает аватар, если отсутствует.
   */
  async loginWithOAuthProfile(profile: GoogleProfileData) {
    const email = profile.email.trim().toLowerCase();
    let user = await this.prisma.user.findUnique({ where: { email } });

    if (!user) {
      const username = await this.generateUniqueUsername(profile);
      const randomPassword = randomBytes(32).toString('hex');
      const passwordHash = await bcrypt.hash(randomPassword, 12);

      user = await this.prisma.user.create({
        data: {
          email,
          username,
          password: passwordHash,
          avatar: profile.photo ?? null,
        },
      });
    } else if (!user.avatar && profile.photo) {
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: { avatar: profile.photo },
      });
    }
    if (user.isBlocked) throw new UnauthorizedException('User is blocked');
    await this.xp.awardDailyLoginXp(user.id);

    const refreshed = await this.prisma.user.findUnique({
      where: { id: user.id },
    });
    const { password: _password, ...result } = refreshed ?? user;
    return {
      user: result,
      token: this.sign(user.id, user.email, user.username, user.role),
    };
  }

  private async generateUniqueUsername(profile: GoogleProfileData) {
    const first = profile.firstName?.trim().toLowerCase() ?? '';
    const last = profile.lastName?.trim().toLowerCase() ?? '';
    const emailPrefix = profile.email.split('@')[0]?.toLowerCase() ?? 'user';
    const baseRaw = `${first}${last}` || emailPrefix || 'user';
    const base = baseRaw.replace(/[^a-z0-9_]+/gi, '').slice(0, 14) || 'user';

    for (let i = 0; i < 20; i += 1) {
      const suffix = randomBytes(3).toString('hex');
      const candidate = `${base}_${suffix}`.slice(0, 30);
      const existing = await this.prisma.user.findUnique({
        where: { username: candidate },
      });
      if (!existing) return candidate;
    }

    return `user_${randomBytes(6).toString('hex')}`.slice(0, 30);
  }

  private sign(userId: number, email: string, username: string, role: UserRole) {
    return this.jwt.sign({ sub: userId, email, username, role });
  }

}
