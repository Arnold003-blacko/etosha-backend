import { Controller, Post, Body } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';

// Reuse your existing DTOs
import { CreateMemberDto } from '../members/dto/create-member.dto';
import { LoginMemberDto } from '../members/dto/login-member.dto';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  // 🔒 Rate limit registration: 3 attempts per minute
  @Throttle({ medium: { limit: 3, ttl: 60000 } })
  @Post('register')
  async register(@Body() body: CreateMemberDto) {
    const {
      firstName,
      lastName,
      email,
      password,
      city,
      country,
      address,
      phone,
      nationalId,
      dateOfBirth,
      gender,
    } = body as any;

    const extra: any = {};
    if (city) extra.city = city;
    if (country) extra.country = country;
    if (address) extra.address = address;
    if (phone) extra.phone = phone;
    if (nationalId) extra.nationalId = nationalId;
    if (dateOfBirth) extra.dateOfBirth = new Date(dateOfBirth);
    if (gender) extra.gender = gender;

    return this.authService.register(
      firstName,
      lastName,
      email,
      password,
      extra,
    );
  }

  // 🔒 Rate limit login: 5 attempts per minute (prevents brute force)
  @Throttle({ medium: { limit: 5, ttl: 60000 } })
  @Post('login')
  async login(@Body() body: LoginMemberDto) {
    return this.authService.login((body as any).email, (body as any).password);
  }
}
