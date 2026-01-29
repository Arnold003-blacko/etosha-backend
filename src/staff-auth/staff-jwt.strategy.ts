import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { StaffAuthService, StaffJwtPayload } from './staff-auth.service';

@Injectable()
export class StaffJwtStrategy extends PassportStrategy(Strategy, 'staff-jwt') {
  constructor(private readonly staffAuthService: StaffAuthService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: process.env.STAFF_JWT_SECRET ?? 'replace_staff_secret_in_prod',
    });
  }

  async validate(payload: StaffJwtPayload) {
    const staff = await this.staffAuthService.validateStaff(payload.id);

    if (!staff || !staff.isActive || !staff.isApproved) {
      throw new UnauthorizedException('Invalid or inactive staff account');
    }

    // Attached to req.user for staff-protected routes
    return {
      id: staff.id,
      email: staff.email,
      level: staff.level,
      isSystemAdmin: staff.isSystemAdmin,
      staffType: staff.staffType,
    };
  }
}

