import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Req,
  ForbiddenException,
} from '@nestjs/common';
import { ClientsService } from './clients.service';
import { CreateMemberDto } from '../members/dto/create-member.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { ChangeClientPasswordDto } from './dto/change-password.dto';
import { StaffJwtGuard } from '../staff-auth/staff-jwt.guard';

@Controller('clients')
@UseGuards(StaffJwtGuard)
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  @Post()
  async create(@Body() createClientDto: CreateMemberDto, @Req() req: any) {
    if (!req.user?.isSystemAdmin) {
      throw new ForbiddenException('Only system administrator can create clients');
    }
    return this.clientsService.create(createClientDto);
  }

  @Get()
  async findAll(@Req() req: any) {
    if (!req.user?.isSystemAdmin) {
      throw new ForbiddenException('Only system administrator can list all clients');
    }
    return this.clientsService.findAll();
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @Req() req: any) {
    if (!req.user?.isSystemAdmin) {
      throw new ForbiddenException('Only system administrator can view client details');
    }
    return this.clientsService.findOne(id);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() updateClientDto: UpdateClientDto,
    @Req() req: any,
  ) {
    if (!req.user?.isSystemAdmin) {
      throw new ForbiddenException('Only system administrator can update clients');
    }
    return this.clientsService.update(id, updateClientDto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Req() req: any) {
    if (!req.user?.isSystemAdmin) {
      throw new ForbiddenException('Only system administrator can delete clients');
    }
    return this.clientsService.remove(id);
  }

  @Patch(':id/change-password')
  async changePassword(
    @Param('id') id: string,
    @Body() changePasswordDto: ChangeClientPasswordDto,
    @Req() req: any,
  ) {
    if (!req.user?.isSystemAdmin) {
      throw new ForbiddenException('Only system administrator can change client passwords');
    }
    return this.clientsService.changePassword(id, changePasswordDto);
  }
}
