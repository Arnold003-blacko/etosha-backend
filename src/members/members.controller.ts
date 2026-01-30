import {
  Controller,
  Post,
  Body,
  UseGuards,
  Get,
  Request,
  NotFoundException,
} from '@nestjs/common';
import { MembersService } from './members.service';
import { CreateMemberDto } from './dto/create-member.dto';
import { LoginMemberDto } from './dto/login-member.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('members')
export class MembersController {
  constructor(private readonly membersService: MembersService) {}

  /* =========================
     AUTH
  ========================= */

  @Post('signup')
  signup(@Body() data: CreateMemberDto) {
    return this.membersService.signup(data);
  }

  @Post('login')
  login(@Body() data: LoginMemberDto) {
    return this.membersService.login(data);
  }

  /* =========================
     PROFILE
  ========================= */

  /**
   * GET /members/me
   */
  @UseGuards(JwtAuthGuard)
  @Get('me')
  async getMe(@Request() req: any) {
    const payload = req.user || {};

    const id = payload.id ?? payload.sub ?? payload.userId;
    if (id) {
      const user = await this.membersService.findById(id.toString());
      if (!user) throw new NotFoundException('User not found');
      return user;
    }

    if (payload.email) {
      const user = await this.membersService.findByEmail(payload.email);
      if (!user) throw new NotFoundException('User not found');
      return user;
    }

    throw new NotFoundException('User not found');
  }

}
