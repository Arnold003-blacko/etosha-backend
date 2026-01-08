import { Controller, Post, Body } from '@nestjs/common';
import { AuthService } from './auth.service';

// Reuse your existing DTOs
import { CreateMemberDto } from '../members/dto/create-member.dto';
import { LoginMemberDto } from '../members/dto/login-member.dto';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('register')
  async register(@Body() body: CreateMemberDto) {
    const { firstName, lastName, email, password, city, country, address, phone } = body as any;
    const extra: any = {};
    if (city) extra.city = city;
    if (country) extra.country = country;
    if (address) extra.address = address;
    if (phone) extra.phone = phone;

    return this.authService.register(firstName, lastName, email, password, extra);
  }

  @Post('login')
  async login(@Body() body: LoginMemberDto) {
    return this.authService.login((body as any).email, (body as any).password);
  }
}
