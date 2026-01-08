import {
  Controller,
  Post,
  Body,
  UseGuards,
  Get,
  Request,
  NotFoundException,
  Patch,
} from '@nestjs/common';
import { MembersService } from './members.service';
import { CreateMemberDto } from './dto/create-member.dto';
import { LoginMemberDto } from './dto/login-member.dto';
import { UpsertNextOfKinDto } from './dto/upsert-next-of-kin.dto';
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

  /* =========================
     NEXT OF KIN (MEMBER-SCOPED)
  ========================= */

  /**
   * GET /members/me/next-of-kin
   */
  @UseGuards(JwtAuthGuard)
  @Get('me/next-of-kin')
  getMyNextOfKin(@Request() req: any) {
    return this.membersService.getMyNextOfKin(req.user.id);
  }

  /**
   * PATCH /members/me/next-of-kin
   * Create or update next of kin
   */
  @UseGuards(JwtAuthGuard)
  @Patch('me/next-of-kin')
  upsertMyNextOfKin(
    @Request() req: any,
    @Body() dto: UpsertNextOfKinDto,
  ) {
    return this.membersService.upsertNextOfKin(
      req.user.id,
      dto,
    );
  }
}
