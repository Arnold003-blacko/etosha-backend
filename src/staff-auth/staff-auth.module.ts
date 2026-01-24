import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { PrismaModule } from '../prisma/prisma.module';
import { DashboardModule } from '../dashboard/dashboard.module';
import { StaffAuthService } from './staff-auth.service';
import { StaffAuthController } from './staff-auth.controller';
import { StaffJwtStrategy } from './staff-jwt.strategy';

@Module({
  imports: [
    PrismaModule,
    DashboardModule,
    PassportModule.register({ defaultStrategy: 'staff-jwt' }),
    JwtModule.register({
      secret: process.env.STAFF_JWT_SECRET ?? 'replace_staff_secret_in_prod',
      signOptions: { expiresIn: '1d' },
    }),
  ],
  controllers: [StaffAuthController],
  providers: [StaffAuthService, StaffJwtStrategy],
  exports: [StaffAuthService, PassportModule],
})
export class StaffAuthModule {}

