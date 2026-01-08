// src/auth/jwt.strategy.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthService } from './auth.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly authService: AuthService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: process.env.JWT_SECRET ?? 'replace_this_in_prod',
    });
  }

  async validate(payload: any) {
    // Expect `id` in JWT payload
    const member = await this.authService.validateMember(payload.id);

    if (!member) {
      // 🔒 Explicitly deny access
      throw new UnauthorizedException('Invalid or expired token');
    }

    // Attached to req.user
    return member;
  }
}
